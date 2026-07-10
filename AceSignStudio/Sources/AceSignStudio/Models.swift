import SwiftUI
import AppKit

// MARK: - Sign sizes

/// A physical sign size. Presets are defined with width >= height (landscape
/// reference); orientation is applied separately. Adding a new size to
/// `presets` is all that's needed to support a new sign holder.
struct SignSize: Identifiable, Hashable {
    let id: String
    let name: String
    let width: Double   // inches
    let height: Double  // inches

    static let presets: [SignSize] = [
        SignSize(id: "5.5x3.5", name: "Sign Holder — 5½ × 3½ in", width: 5.5, height: 3.5),
        SignSize(id: "5x3",     name: "Shelf Card — 5 × 3 in",    width: 5.0, height: 3.0),
        SignSize(id: "6x4",     name: "Card — 6 × 4 in",          width: 6.0, height: 4.0),
        SignSize(id: "7x5",     name: "Card — 7 × 5 in",          width: 7.0, height: 5.0),
        SignSize(id: "11x7",    name: "Counter Sign — 11 × 7 in", width: 11.0, height: 7.0),
        SignSize(id: "11x8.5",  name: "Full Page — 11 × 8½ in",   width: 11.0, height: 8.5),
        SignSize(id: "custom",  name: "Custom…",                  width: 5.5, height: 3.5),
    ]

    static let standardHolder = presets[0]

    var isCustom: Bool { id == "custom" }
}

enum SignOrientation: String, CaseIterable, Identifiable {
    case landscape
    case portrait

    var id: String { rawValue }
    var label: String {
        switch self {
        case .landscape: return "Wide"
        case .portrait:  return "Tall"
        }
    }
}

// MARK: - Sign formats (layouts)

/// A sign layout format. New formats plug in here plus a view case in
/// `SignRootView` — everything else (preview, print, PDF) picks them up.
enum SignLayoutKind: String, CaseIterable, Identifiable {
    case standard
    case sale

    var id: String { rawValue }
    var label: String {
        switch self {
        case .standard: return "Standard"
        case .sale:     return "Sale"
        }
    }
}

// MARK: - Paper for printing

enum PaperOption: String, CaseIterable, Identifiable {
    case letter
    case a4
    case sixByFour
    case exactSign

    var id: String { rawValue }

    var label: String {
        switch self {
        case .letter:    return "US Letter (8½ × 11)"
        case .a4:        return "A4"
        case .sixByFour: return "6 × 4 in Card"
        case .exactSign: return "Exact Sign Size"
        }
    }

    /// Page size in points (72 pt per inch). Letter/A4 are portrait; the
    /// 6×4 card is landscape to match a wide sign.
    func sizePoints(signSize: CGSize) -> CGSize {
        switch self {
        case .letter:    return CGSize(width: 612, height: 792)
        case .a4:        return CGSize(width: 595, height: 842)
        case .sixByFour: return CGSize(width: 432, height: 288)
        case .exactSign: return signSize
        }
    }
}

// MARK: - Render spec

/// Immutable snapshot of everything needed to draw one sign. The preview,
/// printer, and PDF exporter all consume this same value.
struct SignSpec {
    var productName: String
    var detailLine: String
    var priceText: String
    var wasPriceText: String
    var unitSuffix: String
    var sku: String
    var footerText: String?     // nil hides the footer bar entirely
    var image: NSImage?
    var customLogo: NSImage?
    var layout: SignLayoutKind
    var sizePoints: CGSize

    var isWide: Bool { sizePoints.width >= sizePoints.height }
}

// MARK: - Price formatting

enum PriceFormatter {
    struct Parts {
        var dollars: String
        var cents: String
    }

    /// "12.99", "$12.99", "1,299.00" -> dollars "12"/"1299", cents "99".
    static func parts(from text: String) -> Parts? {
        let cleaned = text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: "")
        guard !cleaned.isEmpty, let value = Double(cleaned), value >= 0 else { return nil }
        let cents = Int((value * 100).rounded())
        return Parts(dollars: String(cents / 100), cents: String(format: "%02d", cents % 100))
    }

    static func display(_ text: String) -> String? {
        guard let p = parts(from: text) else { return nil }
        return "$\(p.dollars).\(p.cents)"
    }
}

// MARK: - Lookup support types

struct PriceCandidate: Identifiable, Hashable {
    let id = UUID()
    let value: String   // "12.99"
    let source: String  // human-readable origin, e.g. "JSON-LD" or "product.storePrice"
}

struct DiagnosticEntry: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let ok: Bool
}

// MARK: - Preferences

enum Prefs {
    static let storeCode = "storeCode"
    static let storeName = "storeName"
    static let showFooter = "showFooter"
    static let logoPath = "logoPath"

    static func registerDefaults() {
        UserDefaults.standard.register(defaults: [
            storeCode: "12180",
            storeName: "Snyder's Ace Hardware • Media, PA",
            showFooter: true,
        ])
    }
}

// MARK: - Shared colors

extension Color {
    /// Ace brand red (≈ PMS 186).
    static let aceRed = Color(red: 0.784, green: 0.063, blue: 0.180)
}

// MARK: - Small helpers

func formatInches(_ v: Double) -> String {
    if v.rounded() == v { return String(Int(v)) }
    return String(format: "%.2f", v)
        .replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
        .replacingOccurrences(of: "\\.$", with: "", options: .regularExpression)
}
