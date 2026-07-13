import SwiftUI
import AppKit
import PDFKit
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
// SwiftUI content is layer-backed; NSHostingView.dataWithPDF / printing an
// NSHostingView directly yields BLANK pages. ImageRenderer (macOS 13+) is the
// supported way to rasterize/vectorize SwiftUI, and we print the resulting
// vector PDF through PDFKit — both render reliably, photos included.

@MainActor
enum SignRenderer {
    /// One composed page ready to render.
    struct Page {
        let view: AnyView
        let size: CGSize
    }

    /// Single-page vector PDF of a SwiftUI view at an exact point size.
    static func pdfData(for view: AnyView, size: CGSize) -> Data {
        let data = NSMutableData()
        let renderer = ImageRenderer(content: view.frame(width: size.width, height: size.height))
        renderer.proposedSize = ProposedViewSize(width: size.width, height: size.height)
        renderer.render { contentSize, renderInContext in
            let boxSize = contentSize == .zero ? size : contentSize
            var box = CGRect(origin: .zero, size: boxSize)
            guard let consumer = CGDataConsumer(data: data as CFMutableData),
                  let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else { return }
            ctx.beginPDFPage(nil)
            renderInContext(ctx)
            ctx.endPDFPage()
            ctx.closePDF()
        }
        return data as Data
    }

    /// Multi-page vector PDF from several composed pages (the print queue).
    /// Each single-page PDF is merged with PDFKit, which handles mixed sizes.
    static func batchPDFData(pages: [Page]) -> Data {
        let merged = PDFDocument()
        for page in pages {
            let single = pdfData(for: page.view, size: page.size)
            if let doc = PDFDocument(data: single), let pdfPage = doc.page(at: 0) {
                merged.insert(pdfPage, at: merged.pageCount)
            }
        }
        return merged.dataRepresentation() ?? Data()
    }
}

// MARK: - Printing / exporting

@MainActor
enum PrintController {
    // -- single sign --------------------------------------------------------
    static func printSign(spec: SignSpec, paper: PaperOption, multiUp: Bool, cutMarks: Bool) {
        printSigns(specs: [spec], paper: paper, multiUp: multiUp, cutMarks: cutMarks)
    }

    static func exportPDF(spec: SignSpec, paper: PaperOption, multiUp: Bool, cutMarks: Bool) {
        exportPDF(specs: [spec], paper: paper, multiUp: multiUp, cutMarks: cutMarks,
                  suggestedName: suggestedFileName(spec: spec))
    }

    // -- batch / queue ------------------------------------------------------
    static func printSigns(specs: [SignSpec], paper: PaperOption, multiUp: Bool, cutMarks: Bool) {
        let pages = composedPages(specs: specs, paper: paper, multiUp: multiUp, cutMarks: cutMarks)
        guard !pages.isEmpty else { return }
        let data = SignRenderer.batchPDFData(pages: pages)
        printPDF(data: data, pageSize: pages[0].size, jobName: "Ace Signs (\(pages.count))")
    }

    static func exportPDF(specs: [SignSpec], paper: PaperOption, multiUp: Bool, cutMarks: Bool,
                          suggestedName: String) {
        let pages = composedPages(specs: specs, paper: paper, multiUp: multiUp, cutMarks: cutMarks)
        guard !pages.isEmpty else { return }
        let data = SignRenderer.batchPDFData(pages: pages)

        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            do {
                try data.write(to: url)
            } catch {
                NSAlert(error: error).runModal()
            }
        }
    }

    // -- helpers ------------------------------------------------------------
    private static func composedPages(specs: [SignSpec], paper: PaperOption,
                                      multiUp: Bool, cutMarks: Bool) -> [SignRenderer.Page] {
        specs.map { spec in
            let sheet = SheetComposer.compose(signSize: spec.sizePoints, paper: paper, multiUp: multiUp)
            return SignRenderer.Page(
                view: SheetComposer.pageView(spec: spec, sheet: sheet, cutMarks: cutMarks),
                size: sheet.pageSize)
        }
    }

    private static func printPDF(data: Data, pageSize: CGSize, jobName: String) {
        guard let document = PDFDocument(data: data), document.pageCount > 0 else {
            NSAlert(error: NSError(domain: "AceSignStudio", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Couldn't prepare the sign for printing. Try Export PDF instead."
            ])).runModal()
            return
        }
        let info = NSPrintInfo()
        info.paperSize = pageSize
        info.orientation = pageSize.width > pageSize.height ? .landscape : .portrait
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.horizontalPagination = .fit
        info.verticalPagination = .fit
        info.jobDisposition = .spool

        guard let operation = document.printOperation(for: info, scalingMode: .pageScaleNone,
                                                       autoRotate: false) else { return }
        operation.jobTitle = jobName
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
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
