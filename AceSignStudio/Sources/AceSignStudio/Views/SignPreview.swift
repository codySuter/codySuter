import SwiftUI
import UniformTypeIdentifiers

/// Live, exact-scale preview of the sign, centered on a printing-table
/// background. Accepts image drops (product photos from Finder or a browser).
struct SignPreview: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        GeometryReader { geo in
            let spec = state.currentSpec()
            let size = spec.sizePoints
            let scale = min(
                max((geo.size.width - 64) / size.width, 0.05),
                max((geo.size.height - 96) / size.height, 0.05),
                2.5
            )

            VStack(spacing: 14) {
                ZStack {
                    Rectangle()
                        .fill(Color.white)
                        .shadow(color: .black.opacity(0.25), radius: 14, x: 0, y: 6)
                    SignRootView(spec: spec, isPreview: true)
                        .scaleEffect(scale, anchor: .center)
                }
                .frame(width: size.width * scale, height: size.height * scale)

                Text(caption(for: spec))
                    .font(.callout)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color(nsColor: .underPageBackgroundColor))
        .onDrop(of: [.image, .fileURL], isTargeted: $state.previewDropTargeted) { providers in
            state.handleImageDrop(providers)
        }
        .overlay(
            Group {
                if state.previewDropTargeted {
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(Color.accentColor, lineWidth: 3)
                        .padding(8)
                }
            }
        )
    }

    private func caption(for spec: SignSpec) -> String {
        let w = formatInches(Double(spec.sizePoints.width / 72))
        let h = formatInches(Double(spec.sizePoints.height / 72))
        var text = "\(w) × \(h) in — \(state.layout.label) format"
        if state.paper != .exactSign, state.multiUp {
            let sheet = SheetComposer.compose(signSize: spec.sizePoints, paper: state.paper, multiUp: true)
            text += " • \(sheet.cells.count) per sheet"
        }
        return text
    }
}
