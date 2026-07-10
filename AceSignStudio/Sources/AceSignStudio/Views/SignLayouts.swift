import SwiftUI
import AppKit

// The sign is designed in points at its real physical size (72 pt = 1 inch).
// Every font/spacing value is multiplied by `u`, a scale unit derived from the
// sign's short side, so all layouts work at any sign size. New formats: add a
// case to SignLayoutKind and a branch here.

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

    private var u: CGFloat { min(spec.sizePoints.width, spec.sizePoints.height) / 252 }

    var body: some View {
        if spec.isWide { wideBody } else { tallBody }
    }

    private var wideBody: some View {
        VStack(alignment: .leading, spacing: 4 * u) {
            HStack(alignment: .top, spacing: 10 * u) {
                AceBadgeView(logo: spec.customLogo, u: u)
                SignTitleBlock(spec: spec, isPreview: isPreview, u: u, lineLimit: 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .center, spacing: 12 * u) {
                ProductPhotoView(image: spec.image, showPlaceholder: isPreview, u: u)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                PriceBlock(price: spec.priceText, was: spec.wasPriceText,
                           unit: spec.unitSuffix, u: u,
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
                           placeholderWhenEmpty: isPreview)
                Spacer(minLength: 0)
            }
            SignFooter(sku: spec.sku, footer: spec.footerText, u: u)
        }
        .padding(EdgeInsets(top: 12 * u, leading: 14 * u, bottom: 10 * u, trailing: 14 * u))
    }
}

// MARK: - Sale format

struct SaleSignLayout: View {
    let spec: SignSpec
    let isPreview: Bool

    private var u: CGFloat { min(spec.sizePoints.width, spec.sizePoints.height) / 252 }

    var body: some View {
        Group {
            if spec.isWide { wideBody } else { tallBody }
        }
        .overlay(Rectangle().strokeBorder(Color.aceRed, lineWidth: 4 * u))
    }

    private var wideBody: some View {
        VStack(alignment: .leading, spacing: 4 * u) {
            HStack(alignment: .top, spacing: 10 * u) {
                AceBadgeView(logo: spec.customLogo, u: u)
                SignTitleBlock(spec: spec, isPreview: isPreview, u: u, lineLimit: 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                SaleBurst(u: u)
            }
            HStack(alignment: .center, spacing: 12 * u) {
                ProductPhotoView(image: spec.image, showPlaceholder: isPreview, u: u)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                PriceBlock(price: spec.priceText, was: spec.wasPriceText,
                           unit: spec.unitSuffix, u: u,
                           placeholderWhenEmpty: isPreview)
                    .layoutPriority(1)
            }
            .frame(maxHeight: .infinity)
            SignFooter(sku: spec.sku, footer: spec.footerText, u: u)
        }
        .padding(EdgeInsets(top: 14 * u, leading: 16 * u, bottom: 12 * u, trailing: 16 * u))
    }

    private var tallBody: some View {
        VStack(alignment: .leading, spacing: 5 * u) {
            HStack(alignment: .top) {
                AceBadgeView(logo: spec.customLogo, u: u)
                Spacer(minLength: 0)
                SaleBurst(u: u)
            }
            SignTitleBlock(spec: spec, isPreview: isPreview, u: u, lineLimit: 3)
            ProductPhotoView(image: spec.image, showPlaceholder: isPreview, u: u)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack {
                Spacer(minLength: 0)
                PriceBlock(price: spec.priceText, was: spec.wasPriceText,
                           unit: spec.unitSuffix, u: u, alignment: .center,
                           placeholderWhenEmpty: isPreview)
                Spacer(minLength: 0)
            }
            SignFooter(sku: spec.sku, footer: spec.footerText, u: u)
        }
        .padding(EdgeInsets(top: 14 * u, leading: 16 * u, bottom: 12 * u, trailing: 16 * u))
    }
}

// MARK: - Shared building blocks

/// The Ace brand mark. Uses the store's own logo file when one is set in
/// Settings; otherwise draws a clean built-in Ace badge.
struct AceBadgeView: View {
    let logo: NSImage?
    let u: CGFloat

    var body: some View {
        if let logo {
            Image(nsImage: logo)
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
                .font(.system(size: 20 * u, weight: .bold))
                .foregroundColor(spec.productName.isEmpty ? Color.black.opacity(0.25) : .black)
                .lineLimit(lineLimit)
                .minimumScaleFactor(0.55)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            if !spec.detailLine.isEmpty {
                Text(spec.detailLine)
                    .font(.system(size: 11.5 * u, weight: .medium))
                    .foregroundColor(Color.black.opacity(0.6))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }
}

/// Big retail-style price: superscript dollar sign and cents in Ace red,
/// optional strikethrough "was" price and unit suffix.
struct PriceBlock: View {
    let price: String
    let was: String
    let unit: String
    let u: CGFloat
    var alignment: HorizontalAlignment = .trailing
    var placeholderWhenEmpty = false

    var body: some View {
        VStack(alignment: alignment, spacing: 0) {
            if let wasDisplay = PriceFormatter.display(was) {
                Text("Reg. \(wasDisplay)")
                    .font(.system(size: 13 * u, weight: .semibold))
                    .strikethrough(true, color: Color.black.opacity(0.45))
                    .foregroundColor(Color.black.opacity(0.55))
                    .padding(.bottom, 2 * u)
            }
            priceBody
            if !unit.isEmpty {
                Text(unit)
                    .font(.system(size: 13 * u, weight: .semibold))
                    .foregroundColor(Color.black.opacity(0.6))
            }
        }
    }

    @ViewBuilder
    private var priceBody: some View {
        if let parts = PriceFormatter.parts(from: price) {
            HStack(alignment: .top, spacing: 1 * u) {
                Text("$")
                    .font(.system(size: 28 * u, weight: .heavy))
                    .padding(.top, 8 * u)
                Text(parts.dollars)
                    .font(.system(size: 84 * u, weight: .black))
                    .kerning(-1.5 * u)
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                Text(parts.cents)
                    .font(.system(size: 30 * u, weight: .heavy))
                    .padding(.top, 8 * u)
            }
            .foregroundColor(.aceRed)
        } else if !price.trimmingCharacters(in: .whitespaces).isEmpty {
            // Free-form price text ("2 for $5", "25% off"…)
            Text(price)
                .font(.system(size: 40 * u, weight: .black))
                .foregroundColor(.aceRed)
                .lineLimit(2)
                .minimumScaleFactor(0.4)
                .multilineTextAlignment(.center)
        } else if placeholderWhenEmpty {
            Text("$ —.—")
                .font(.system(size: 50 * u, weight: .black))
                .foregroundColor(Color.aceRed.opacity(0.2))
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
                    .fill(Color.black.opacity(0.12))
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
                .font(.system(size: 9.5 * u, weight: .medium))
                .foregroundColor(Color.black.opacity(0.5))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
        }
    }
}

struct SaleBurst: View {
    let u: CGFloat

    var body: some View {
        Text("SALE")
            .font(.system(size: 20 * u, weight: .black))
            .italic()
            .foregroundColor(.white)
            .padding(.horizontal, 10 * u)
            .padding(.vertical, 4 * u)
            .background(RoundedRectangle(cornerRadius: 6 * u).fill(Color.aceRed))
            .rotationEffect(.degrees(-3))
    }
}
