import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - Sheet composition
// Lays signs out on the chosen paper: a single centered sign, or as many as
// fit (optionally rotating them 90° when that packs more per sheet), with
// print-shop-style cut marks.

struct SheetLayout {
    let pageSize: CGSize
    let cells: [CGRect]
    let rotated: Bool
    let scale: CGFloat
}

enum SheetComposer {
    static func compose(signSize: CGSize, paper: PaperOption, multiUp: Bool) -> SheetLayout {
        let page = paper.sizePoints(signSize: signSize)
        if paper == .exactSign {
            return SheetLayout(pageSize: signSize,
                               cells: [CGRect(origin: .zero, size: signSize)],
                               rotated: false, scale: 1)
        }

        let margin: CGFloat = 18   // 0.25 in — inside most printers' printable area
        let gap: CGFloat = 16

        func fitCount(_ w: CGFloat, _ h: CGFloat) -> (cols: Int, rows: Int) {
            let cols = Int(((page.width - 2 * margin + gap) / (w + gap)).rounded(.down))
            let rows = Int(((page.height - 2 * margin + gap) / (h + gap)).rounded(.down))
            return (max(cols, 0), max(rows, 0))
        }

        let normal = fitCount(signSize.width, signSize.height)
        let turned = fitCount(signSize.height, signSize.width)

        var rotated = false
        var cols = 1
        var rows = 1
        if multiUp {
            rotated = turned.cols * turned.rows > normal.cols * normal.rows
            (cols, rows) = rotated ? turned : normal
            if cols * rows == 0 {
                rotated = false
                cols = 1
                rows = 1
            }
        }

        let cellBaseW = rotated ? signSize.height : signSize.width
        let cellBaseH = rotated ? signSize.width : signSize.height

        // Shrink only when a single sign is bigger than the printable area.
        let scale = min(1,
                        (page.width - 2 * margin) / cellBaseW,
                        (page.height - 2 * margin) / cellBaseH)
        let w = cellBaseW * scale
        let h = cellBaseH * scale

        let totalW = CGFloat(cols) * w + CGFloat(cols - 1) * gap
        let totalH = CGFloat(rows) * h + CGFloat(rows - 1) * gap
        let x0 = (page.width - totalW) / 2
        let y0 = (page.height - totalH) / 2

        var cells: [CGRect] = []
        for row in 0..<rows {
            for col in 0..<cols {
                cells.append(CGRect(x: x0 + CGFloat(col) * (w + gap),
                                    y: y0 + CGFloat(row) * (h + gap),
                                    width: w, height: h))
            }
        }
        return SheetLayout(pageSize: page, cells: cells, rotated: rotated, scale: scale)
    }

    static func pageView(spec: SignSpec, sheet: SheetLayout, cutMarks: Bool) -> AnyView {
        let showMarks = cutMarks && sheet.pageSize != spec.sizePoints
        return AnyView(
            ZStack(alignment: .topLeading) {
                Color.white
                ForEach(0..<sheet.cells.count, id: \.self) { index in
                    let cell = sheet.cells[index]
                    signCell(spec: spec, rotated: sheet.rotated, scale: sheet.scale)
                        .frame(width: cell.width, height: cell.height)
                        .position(x: cell.midX, y: cell.midY)
                }
                if showMarks {
                    CutMarks(cells: sheet.cells)
                        .stroke(Color.black.opacity(0.7), lineWidth: 0.5)
                }
            }
            .frame(width: sheet.pageSize.width, height: sheet.pageSize.height)
            .environment(\.colorScheme, .light)
        )
    }

    @ViewBuilder
    private static func signCell(spec: SignSpec, rotated: Bool, scale: CGFloat) -> some View {
        if rotated {
            SignRootView(spec: spec)
                .rotationEffect(.degrees(90))
                .scaleEffect(scale)
        } else {
            SignRootView(spec: spec)
                .scaleEffect(scale)
        }
    }
}

struct CutMarks: Shape {
    let cells: [CGRect]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let length: CGFloat = 10
        let inset: CGFloat = 3
        for cell in cells {
            for x in [cell.minX, cell.maxX] {
                path.move(to: CGPoint(x: x, y: cell.minY - inset))
                path.addLine(to: CGPoint(x: x, y: cell.minY - inset - length))
                path.move(to: CGPoint(x: x, y: cell.maxY + inset))
                path.addLine(to: CGPoint(x: x, y: cell.maxY + inset + length))
            }
            for y in [cell.minY, cell.maxY] {
                path.move(to: CGPoint(x: cell.minX - inset, y: y))
                path.addLine(to: CGPoint(x: cell.minX - inset - length, y: y))
                path.move(to: CGPoint(x: cell.maxX + inset, y: y))
                path.addLine(to: CGPoint(x: cell.maxX + inset + length, y: y))
            }
        }
        return path
    }
}

// MARK: - Rendering to PDF

@MainActor
enum SignRenderer {
    /// Vector PDF of a SwiftUI view at an exact point size.
    static func pdfData(for view: AnyView, size: CGSize) -> Data {
        let hosting = NSHostingView(rootView: view)
        hosting.frame = CGRect(origin: .zero, size: size)

        // Back the view with an (invisible) window so AppKit lays it out.
        let window = NSWindow(contentRect: CGRect(origin: .zero, size: size),
                              styleMask: [.borderless],
                              backing: .buffered,
                              defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()

        return hosting.dataWithPDF(inside: hosting.bounds)
    }
}

// MARK: - Printing / exporting

@MainActor
enum PrintController {
    static func printSign(spec: SignSpec, paper: PaperOption, multiUp: Bool, cutMarks: Bool) {
        let sheet = SheetComposer.compose(signSize: spec.sizePoints, paper: paper, multiUp: multiUp)
        let page = SheetComposer.pageView(spec: spec, sheet: sheet, cutMarks: cutMarks)

        let info = NSPrintInfo()
        info.orientation = sheet.pageSize.width > sheet.pageSize.height ? .landscape : .portrait
        info.paperSize = sheet.pageSize
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.horizontalPagination = .clip
        info.verticalPagination = .clip
        info.isHorizontallyCentered = true
        info.isVerticallyCentered = true
        info.scalingFactor = 1.0

        let hosting = NSHostingView(rootView: page)
        hosting.frame = CGRect(origin: .zero, size: sheet.pageSize)
        hosting.layoutSubtreeIfNeeded()

        let operation = NSPrintOperation(view: hosting, printInfo: info)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
    }

    static func exportPDF(spec: SignSpec, paper: PaperOption, multiUp: Bool, cutMarks: Bool) {
        let sheet = SheetComposer.compose(signSize: spec.sizePoints, paper: paper, multiUp: multiUp)
        let page = SheetComposer.pageView(spec: spec, sheet: sheet, cutMarks: cutMarks)
        let data = SignRenderer.pdfData(for: page, size: sheet.pageSize)

        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = suggestedFileName(spec: spec)
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            do {
                try data.write(to: url)
            } catch {
                NSAlert(error: error).runModal()
            }
        }
    }

    private static func suggestedFileName(spec: SignSpec) -> String {
        var base = "Sign"
        if !spec.sku.isEmpty {
            base += " \(spec.sku)"
        } else if !spec.productName.isEmpty {
            base += " " + String(spec.productName.prefix(30))
        }
        return base + ".pdf"
    }
}
