import SwiftUI
import AppKit
import UniformTypeIdentifiers

@MainActor
final class AppState: ObservableObject {
    static let shared = AppState()

    // MARK: Product fields (all editable — lookup fills them, the user can correct them)
    @Published var sku = ""
    @Published var productName = ""
    @Published var detailLine = ""
    @Published var priceText = ""
    @Published var wasPriceText = ""
    @Published var unitSuffix = ""
    @Published var productImage: NSImage?
    @Published var productPageURL: URL?

    // MARK: Sign configuration
    @Published var signSize: SignSize = .standardHolder
    @Published var customWidth: Double = 5.5
    @Published var customHeight: Double = 3.5
    @Published var orientation: SignOrientation = .landscape
    @Published var layout: SignLayoutKind = .standard

    // MARK: Print configuration
    @Published var paper: PaperOption = .letter
    @Published var multiUp = false
    @Published var cutMarks = true

    // MARK: Lookup state
    @Published var isLookingUp = false
    @Published var lookupError: String?
    @Published var priceCandidates: [PriceCandidate] = []
    @Published var diagnostics: [DiagnosticEntry] = []
    @Published var showDiagnostics = false
    @Published var focusSKURequested = false

    private let lookupService = AceLookupService()

    // MARK: Derived

    /// Final sign dimensions in points, orientation applied.
    var signPointSize: CGSize {
        if signSize.isCustom {
            return CGSize(width: max(customWidth, 0.5) * 72, height: max(customHeight, 0.5) * 72)
        }
        let wide = CGSize(width: signSize.width * 72, height: signSize.height * 72)
        return orientation == .landscape
            ? wide
            : CGSize(width: wide.height, height: wide.width)
    }

    func currentSpec() -> SignSpec {
        let defaults = UserDefaults.standard
        let showFooter = defaults.bool(forKey: Prefs.showFooter)
        let storeName = defaults.string(forKey: Prefs.storeName) ?? ""
        var logo: NSImage?
        if let path = defaults.string(forKey: Prefs.logoPath), !path.isEmpty {
            logo = NSImage(contentsOfFile: path)
        }
        return SignSpec(
            productName: productName,
            detailLine: detailLine,
            priceText: priceText,
            wasPriceText: wasPriceText,
            unitSuffix: unitSuffix,
            sku: sku.trimmingCharacters(in: .whitespacesAndNewlines),
            footerText: showFooter && !storeName.isEmpty ? storeName : nil,
            image: productImage,
            customLogo: logo,
            layout: layout,
            sizePoints: signPointSize
        )
    }

    var diagnosticsText: String {
        diagnostics
            .map { "\($0.ok ? "[ok]  " : "[fail]") \($0.title) — \($0.detail)" }
            .joined(separator: "\n")
    }

    // MARK: Lookup

    func runLookup() {
        let query = sku.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, !isLookingUp else { return }
        isLookingUp = true
        lookupError = nil
        priceCandidates = []
        diagnostics = []

        Task {
            let storeCode = UserDefaults.standard.string(forKey: Prefs.storeCode) ?? "12180"
            let outcome = await self.lookupService.lookup(sku: query, storeCode: storeCode)

            self.diagnostics = outcome.diagnostics
            if let name = outcome.productName, !name.isEmpty { self.productName = name }
            if let detail = outcome.detailLine, !detail.isEmpty { self.detailLine = detail }
            if let price = outcome.priceText { self.priceText = price }
            self.wasPriceText = outcome.wasPriceText ?? self.wasPriceText
            self.priceCandidates = outcome.priceCandidates
            self.productPageURL = outcome.productPageURL

            if let imageURL = outcome.imageURL {
                if let image = await self.lookupService.fetchImage(from: imageURL) {
                    self.productImage = image
                    self.diagnostics.append(DiagnosticEntry(
                        title: "Photo downloaded",
                        detail: imageURL.absoluteString, ok: true))
                } else {
                    self.diagnostics.append(DiagnosticEntry(
                        title: "Photo download failed",
                        detail: imageURL.absoluteString, ok: false))
                }
            }

            if outcome.productName == nil && outcome.priceText == nil {
                self.lookupError = outcome.errorSummary
                    ?? "No product data found for \(query). Fill the sign in manually, or open Diagnostics to see what happened."
            }
            self.isLookingUp = false
        }
    }

    func applyCandidate(_ candidate: PriceCandidate) {
        priceText = candidate.value
    }

    func openProductPage() {
        if let url = productPageURL {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: Photo actions

    func pasteImage() {
        if let image = NSImage(pasteboard: .general) {
            productImage = image
        }
    }

    func chooseImageFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.message = "Choose a product photo"
        if panel.runModal() == .OK, let url = panel.url, let image = NSImage(contentsOf: url) {
            productImage = image
        }
    }

    func clearImage() {
        productImage = nil
    }

    /// Shared drop handler (used by the preview pane and photo well).
    func handleImageDrop(_ providers: [NSItemProvider]) -> Bool {
        for provider in providers {
            if provider.canLoadObject(ofClass: NSImage.self) {
                _ = provider.loadObject(ofClass: NSImage.self) { object, _ in
                    if let image = object as? NSImage {
                        Task { @MainActor in AppState.shared.productImage = image }
                    }
                }
                return true
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                    var url: URL?
                    if let data = item as? Data {
                        url = URL(dataRepresentation: data, relativeTo: nil)
                    } else if let itemURL = item as? URL {
                        url = itemURL
                    }
                    if let fileURL = url, let image = NSImage(contentsOf: fileURL) {
                        Task { @MainActor in AppState.shared.productImage = image }
                    }
                }
                return true
            }
        }
        return false
    }

    // MARK: Output

    func requestPrint() {
        PrintController.printSign(spec: currentSpec(), paper: paper, multiUp: multiUp, cutMarks: cutMarks)
    }

    func requestExportPDF() {
        PrintController.exportPDF(spec: currentSpec(), paper: paper, multiUp: multiUp, cutMarks: cutMarks)
    }
}
