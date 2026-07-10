import SwiftUI
import AppKit

// The sign is designed in points at its real physical size (72 pt = 1 inch).
// Every font/spacing value is multiplied by `u`, a scale unit derived from the
// sign's short side, so all layouts work at any sign size. New formats: add a
// case to SignLayoutKind and a branch here.
//
// Visual language follows the Ace Brand Guidelines: Roboto type, the primary
// palette at 100% (never tinted), and the official pricepoint formats (white
// price on a red chip, black SALE tag, black "REG." chip — guidelines p73).

/// Renders one sign at exact physical size. Used by the live preview, the
/// printer, and the PDF exporter, so what you see is exactly what prints.
struct SignRootView: View {
    let spec: SignSpec
    var isPreview = false

    var body: some View {
        Group {
            switch spec.layout {
            case .standard:
                StandardSignLayout(spec: spec, isPreview: isPreview)
            case .sale:
                SaleSignLayout(spec: spec, isPreview: isPreview)
            }
        }
        .frame(width: spec.sizePoints.width, height: spec.sizePoints.height)
        .background(Color.white)
        .environment(\.colorScheme, .light)
        .clipped()
    }
}

// MARK: - Standard format

struct StandardSignLayout: View {
    let spec: SignSpec
    let isPreview: Bool
    var priceStyle: PriceBlock.Style = .plain

    private var u: CGFloat { min(spec.sizePoints.width, spec.sizePoints.height) / 252 }

    var body: some View {
        if spec.isWide { wideBody } else { tallBody }
    }

    private var wideBody: some View {
        VStack(alignment: .leading, spacing: 4 * u) {
            HStack(alignment: .top, spacing: 12 * u) {
                AceBadgeView(logo: spec.customLogo, u: u)
                SignTitleBlock(spec: spec, isPreview: isPreview, u: u, lineLimit: 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .center, spacing: 12 * u) {
                ProductPhotoView(image: spec.image, showPlaceholder: isPreview, u: u)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                PriceBlock(price: spec.priceText, was: spec.wasPriceText,
                           unit: spec.unitSuffix, u: u,
                           style: priceStyle,
                           placeholderWhenEmpty: isPreview)
                    .layoutPriority(1)
            }
            .frame(maxHeight: .infinity)
            SignFooter(sku: spec.sku, footer: spec.footerText, u: u)
        }
        .padding(EdgeInsets(top: 12 * u, leading: 14 * u, bottom: 10 * u, trailing: 14 * u))
    }

    private var tallBody: some View {
        VStack(alignment: .leading, spacing: 5 * u) {
            AceBadgeView(logo: spec.customLogo, u: u)
            SignTitleBlock(spec: spec, isPreview: isPreview, u: u, lineLimit: 3)
            ProductPhotoView(image: spec.image, showPlaceholder: isPreview, u: u)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack {
                Spacer(minLength: 0)
                PriceBlock(price: spec.priceText, was: spec.wasPriceText,
                           unit: spec.unitSuffix, u: u, alignment: .center,
                           style: priceStyle,
                           placeholderWhenEmpty: isPreview)
                Spacer(minLength: 0)
            }
            SignFooter(sku: spec.sku, footer: spec.footerText, u: u)
        }
        .padding(EdgeInsets(top: 12 * u, leading: 14 * u, bottom: 10 * u, trailing: 14 * u))
    }
}

// MARK: - Sale format
// Same structure as Standard, with the official promo pricepoint treatment.

struct SaleSignLayout: View {
    let spec: SignSpec
    let isPreview: Bool

    var body: some View {
        StandardSignLayout(spec: spec, isPreview: isPreview, priceStyle: .salePoint)
    }
}

// MARK: - Shared building blocks

/// The Ace brand mark: a custom logo from Settings if set, otherwise the
/// embedded official Ace Hardware logo (stacked two-line wordmark — the
/// preferred lockup), with a drawn badge as last resort.
struct AceBadgeView: View {
    let logo: NSImage?
    let u: CGFloat

    var body: some View {
        if let image = logo ?? AceBrand.logo {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(height: 56 * u)
                .frame(maxWidth: 150 * u, alignment: .leading)
        } else {
            RoundedRectangle(cornerRadius: 10 * u)
                .fill(Color.aceRed)
                .frame(width: 56 * u, height: 56 * u)
                .overlay(
                    VStack(spacing: 1 * u) {
                        Text("Ace")
                            .font(.system(size: 26 * u, weight: .black, design: .serif))
                            .italic()
                        Text("HARDWARE")
                            .font(.system(size: 6 * u, weight: .bold))
                            .tracking(1.1 * u)
                    }
                    .foregroundColor(.white)
                )
        }
    }
}

struct SignTitleBlock: View {
    let spec: SignSpec
    let isPreview: Bool
    let u: CGFloat
    let lineLimit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2 * u) {
            Text(spec.productName.isEmpty ? (isPreview ? "Product name" : " ") : spec.productName)
                .font(AceFont.font(size: 20 * u, weight: .bold))
                .foregroundColor(spec.productName.isEmpty ? Color.black.opacity(0.25) : .black)
                .lineLimit(lineLimit)
                .minimumScaleFactor(0.55)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            if !spec.detailLine.isEmpty {
                Text(spec.detailLine)
                    .font(AceFont.font(size: 11.5 * u, weight: .medium))
                    .foregroundColor(.aceCoolGray)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }
}

/// Price display in the two official styles:
/// - `.plain` — big Ace-red price for everyday signs
/// - `.salePoint` — the guideline promo format: black SALE tag, white price
///   on a red chip with superscript cents and the unit under them, and a
///   black "REG. $x.xx" chip when a was-price is provided.
struct PriceBlock: View {
    enum Style {
        case plain
        case salePoint
    }

    let price: String
    let was: String
    let unit: String
    let u: CGFloat
    var alignment: HorizontalAlignment = .trailing
    var style: Style = .plain
    var placeholderWhenEmpty = false

    var body: some View {
        VStack(alignment: alignment, spacing: 3 * u) {
            if style == .salePoint {
                SaleTag(u: u)
                PricePointChip(price: price, unit: unit, u: u,
                               placeholderWhenEmpty: placeholderWhenEmpty)
                RegPriceChip(was: was, u: u)
            } else {
                plainPrice
                if !unit.isEmpty {
                    Text(unit)
                        .font(AceFont.font(size: 13 * u, weight: .medium))
                        .foregroundColor(.aceCoolGray)
                }
                RegPriceChip(was: was, u: u)
            }
        }
    }

    @ViewBuilder
    private var plainPrice: some View {
        if let parts = PriceFormatter.parts(from: price) {
            HStack(alignment: .top, spacing: 1 * u) {
                Text("$")
                    .font(AceFont.font(size: 28 * u, weight: .black))
                    .padding(.top, 8 * u)
                Text(parts.dollars)
                    .font(AceFont.font(size: 84 * u, weight: .black))
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                Text(parts.cents)
                    .font(AceFont.font(size: 30 * u, weight: .black))
                    .padding(.top, 8 * u)
            }
            .foregroundColor(.aceRed)
        } else if !price.trimmingCharacters(in: .whitespaces).isEmpty {
            // Free-form price text ("2 for $5", "25% off"…)
            Text(price)
                .font(AceFont.font(size: 40 * u, weight: .black))
                .foregroundColor(.aceRed)
                .lineLimit(2)
                .minimumScaleFactor(0.4)
                .multilineTextAlignment(.center)
        } else if placeholderWhenEmpty {
            Text("$ —.—")
                .font(AceFont.font(size: 50 * u, weight: .black))
                .foregroundColor(Color.aceRed.opacity(0.2))
        }
    }
}

/// The official Ace pricepoint: white price on a solid Ace-red chip, dollar
/// sign and cents superscript, unit ("each", "/ft"…) tucked under the cents.
struct PricePointChip: View {
    let price: String
    let unit: String
    let u: CGFloat
    var placeholderWhenEmpty = false

    var body: some View {
        let trimmed = price.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty || placeholderWhenEmpty {
            chipContent(for: trimmed.isEmpty ? "0.00" : trimmed)
                .foregroundColor(.white)
                .padding(.horizontal, 10 * u)
                .padding(.vertical, 6 * u)
                .background(Rectangle().fill(Color.aceRed))
                .opacity(trimmed.isEmpty ? 0.35 : 1)
        }
    }

    @ViewBuilder
    private func chipContent(for text: String) -> some View {
        if let parts = PriceFormatter.parts(from: text) {
            HStack(alignment: .top, spacing: 1.5 * u) {
                Text("$")
                    .font(AceFont.font(size: 26 * u, weight: .black))
                    .padding(.top, 6 * u)
                Text(parts.dollars)
                    .font(AceFont.font(size: 68 * u, weight: .black))
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                VStack(alignment: .leading, spacing: 0) {
                    Text(parts.cents)
                        .font(AceFont.font(size: 26 * u, weight: .black))
                    if !unit.isEmpty {
                        Text(unit)
                            .font(AceFont.font(size: 9.5 * u, weight: .medium))
                    }
                }
                .padding(.top, 6 * u)
            }
        } else {
            Text(text)
                .font(AceFont.font(size: 34 * u, weight: .black))
                .lineLimit(2)
                .minimumScaleFactor(0.4)
                .multilineTextAlignment(.center)
        }
    }
}

/// Black "SALE" tag that sits above the pricepoint (guidelines p73).
struct SaleTag: View {
    let u: CGFloat
    var text = "SALE"

    var body: some View {
        Text(text)
            .font(AceFont.font(size: 15 * u, weight: .black))
            .foregroundColor(.white)
            .padding(.horizontal, 8 * u)
            .padding(.vertical, 2.5 * u)
            .background(Rectangle().fill(Color.black))
    }
}

/// Black "REG. $x.xx" chip with superscript cents (guidelines p73).
/// Renders nothing when no was-price is set.
struct RegPriceChip: View {
    let was: String
    let u: CGFloat

    var body: some View {
        if let parts = PriceFormatter.parts(from: was) {
            HStack(alignment: .top, spacing: 0.5 * u) {
                Text("REG. $\(parts.dollars)")
                    .font(AceFont.font(size: 10.5 * u, weight: .bold))
                Text(parts.cents)
                    .font(AceFont.font(size: 7 * u, weight: .bold))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 6 * u)
            .padding(.vertical, 2.5 * u)
            .background(Rectangle().fill(Color.black))
        }
    }
}

struct ProductPhotoView: View {
    let image: NSImage?
    let showPlaceholder: Bool
    let u: CGFloat

    var body: some View {
        if let image {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
        } else if showPlaceholder {
            RoundedRectangle(cornerRadius: 6 * u)
                .strokeBorder(Color.black.opacity(0.15), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                .overlay(
                    VStack(spacing: 4 * u) {
                        Image(systemName: "photo")
                            .font(.system(size: 22 * u))
                        Text("Photo appears here")
                            .font(.system(size: 10 * u))
                    }
                    .foregroundColor(Color.black.opacity(0.3))
                )
        } else {
            Color.clear
        }
    }
}

struct SignFooter: View {
    let sku: String
    let footer: String?
    let u: CGFloat

    var body: some View {
        if !sku.isEmpty || (footer?.isEmpty == false) {
            VStack(spacing: 4 * u) {
                Rectangle()
                    .fill(Color.aceHairline)
                    .frame(height: max(1, u))
                HStack(spacing: 8 * u) {
                    if !sku.isEmpty {
                        Text("SKU \(sku)")
                    }
                    Spacer(minLength: 0)
                    if let footer, !footer.isEmpty {
                        Text(footer)
                    }
                }
                .font(AceFont.font(size: 9.5 * u, weight: .regular))
                .foregroundColor(.aceCoolGray)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
        }
    }
}
