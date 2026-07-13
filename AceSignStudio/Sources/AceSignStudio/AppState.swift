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
    @Published var showDetailLine = true   // brand/model line under the name

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
    // Lives here instead of @State in SignPreview: @State is macro-backed in
    // newer SDKs and the macro plugin is missing from CLT-only installs.
    @Published var previewDropTargeted = false

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
        let rawSKU = sku.trimmingCharacters(in: .whitespacesAndNewlines)
        // Never print a pasted URL or a search phrase in the sign footer.
        let footerSKU = (rawSKU.lowercased().hasPrefix("http") || rawSKU.contains(where: \.isWhitespace))
            ? "" : rawSKU
        return SignSpec(
            productName: productName,
            detailLine: showDetailLine ? detailLine : "",
            priceText: priceText,
            wasPriceText: wasPriceText,
            unitSuffix: unitSuffix,
            sku: footerSKU,
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
            if outcome.productName != nil || outcome.priceText != nil {
                // A product was found: the was-price must reflect THIS
                // product, never linger from the previous lookup.
                self.wasPriceText = outcome.wasPriceText ?? ""
            } else if let was = outcome.wasPriceText {
                self.wasPriceText = was
            }
            self.priceCandidates = outcome.priceCandidates
            self.productPageURL = outcome.productPageURL
            // If the user pasted a URL or searched by name, swap in the
            // site's item number so the sign footer prints something useful.
            // A typed numeric SKU is kept — that's their shelf number.
            let typedLooksLikeItemNumber = query.count >= 4 && query.allSatisfy(\.isNumber)
            if let itemNumber = outcome.resolvedItemNumber, !typedLooksLikeItemNumber {
                self.sku = itemNumber
            }

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

    // MARK: Output (single sign)

    func requestPrint() {
        PrintController.printSign(spec: currentSpec(), paper: paper, multiUp: multiUp, cutMarks: cutMarks)
    }

    func requestExportPDF() {
        PrintController.exportPDF(spec: currentSpec(), paper: paper, multiUp: multiUp, cutMarks: cutMarks)
    }

    // MARK: Print queue (batch)

    @Published var queue: [QueuedSign] = []

    var canOutputQueue: Bool { !queue.isEmpty }

    /// Snapshots the current sign (all fields + photo) into the queue.
    func addCurrentToQueue() {
        let spec = currentSpec()
        let title: String
        if !spec.productName.isEmpty {
            title = spec.productName
        } else if !spec.sku.isEmpty {
            title = "SKU \(spec.sku)"
        } else {
            title = "Untitled sign"
        }
        let subtitle = PriceFormatter.display(spec.priceText) ?? spec.priceText
        queue.append(QueuedSign(spec: spec, title: title, subtitle: subtitle, thumbnail: productImage))
    }

    func removeFromQueue(_ id: QueuedSign.ID) {
        queue.removeAll { $0.id == id }
    }

    func clearQueue() {
        queue.removeAll()
    }

    func printQueue() {
        guard canOutputQueue else { return }
        PrintController.printQueue(specs: queue.map(\.spec), paper: paper, cutMarks: cutMarks)
    }

    func exportQueuePDF() {
        guard canOutputQueue else { return }
        PrintController.exportQueue(specs: queue.map(\.spec), paper: paper,
                                    cutMarks: cutMarks, suggestedName: "Ace Signs (\(queue.count)).pdf")
    }

    /// How many queued signs fit per sheet, and how many sheets that is —
    /// gang-run packs distinct signs together to save paper.
    var queuePerPage: Int {
        guard let first = queue.first else { return 0 }
        return SheetComposer.gangPerPage(signSize: first.spec.sizePoints, paper: paper)
    }

    var queuePageCount: Int {
        let per = queuePerPage
        guard per > 0 else { return 0 }
        return (queue.count + per - 1) / per
    }

    var queuePlanDescription: String {
        guard !queue.isEmpty else { return "" }
        let n = queue.count
        if paper == .exactSign {
            return "\(n) sign\(n == 1 ? "" : "s") · one per page"
        }
        return "\(n) sign\(n == 1 ? "" : "s") · \(queuePerPage) per sheet · \(queuePageCount) sheet\(queuePageCount == 1 ? "" : "s") to print"
    }
}

/// One snapshotted sign in the print queue. The spec is a value copy, so
/// later edits to the live sign don't change what's already queued.
struct QueuedSign: Identifiable {
    let id = UUID()
    let spec: SignSpec
    let title: String
    let subtitle: String
    let thumbnail: NSImage?
}
