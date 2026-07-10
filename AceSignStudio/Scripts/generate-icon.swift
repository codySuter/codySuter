// Renders the app icon into an .iconset folder: the official Ace Hardware
// logo on a white rounded tile (falls back to a drawn badge if the brand
// asset is missing). Run by build-app.sh:
//   swift Scripts/generate-icon.swift <output.iconset>
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let brandLogo: NSImage? = {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()   // Scripts/
        .deletingLastPathComponent()   // package root
        .appendingPathComponent("BrandAssets/ace-hardware-2line-color.png")
    return NSImage(contentsOf: url)
}()

let variants: [(pixels: Int, name: String)] = [
    (16, "16x16"), (32, "16x16@2x"),
    (32, "32x32"), (64, "32x32@2x"),
    (128, "128x128"), (256, "128x128@2x"),
    (256, "256x256"), (512, "256x256@2x"),
    (512, "512x512"), (1024, "512x512@2x"),
]

// Ace brand red (PMS 186 C), matching Models.swift.
let aceRed = NSColor(calibratedRed: 227.0 / 255.0, green: 25.0 / 255.0, blue: 55.0 / 255.0, alpha: 1)

func drawIcon(pixels: Int) -> NSImage {
    let s = CGFloat(pixels)
    let image = NSImage(size: NSSize(width: s, height: s))
    image.lockFocus()

    let inset = s * 0.05
    let tile = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let path = NSBezierPath(roundedRect: tile, xRadius: s * 0.22, yRadius: s * 0.22)

    if let logo = brandLogo {
        NSColor.white.setFill()
        path.fill()
        NSColor(calibratedWhite: 0, alpha: 0.08).setStroke()
        path.lineWidth = max(1, s * 0.008)
        path.stroke()

        let logoSize = logo.size
        let maxW = s * 0.72
        let maxH = s * 0.60
        let scale = min(maxW / logoSize.width, maxH / logoSize.height)
        let w = logoSize.width * scale
        let h = logoSize.height * scale
        logo.draw(in: NSRect(x: (s - w) / 2, y: (s - h) / 2, width: w, height: h),
                  from: .zero, operation: .sourceOver, fraction: 1)
    } else {
        aceRed.setFill()
        path.fill()

        let baseFont = NSFont.systemFont(ofSize: s * 0.34, weight: .black)
        let aceFont = NSFontManager.shared.convert(baseFont, toHaveTrait: .italicFontMask)
        let ace = NSAttributedString(string: "Ace", attributes: [
            .font: aceFont,
            .foregroundColor: NSColor.white,
        ])
        let aceSize = ace.size()
        ace.draw(at: NSPoint(x: (s - aceSize.width) / 2, y: (s - aceSize.height) / 2 + s * 0.05))

        let strip = NSAttributedString(string: "SIGNS", attributes: [
            .font: NSFont.systemFont(ofSize: s * 0.085, weight: .bold),
            .foregroundColor: NSColor.white.withAlphaComponent(0.92),
            .kern: s * 0.03,
        ])
        let stripSize = strip.size()
        strip.draw(at: NSPoint(x: (s - stripSize.width) / 2, y: s * 0.20))
    }

    image.unlockFocus()
    return image
}

for variant in variants {
    let image = drawIcon(pixels: variant.pixels)
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:])
    else { continue }
    let url = URL(fileURLWithPath: outDir).appendingPathComponent("icon_\(variant.name).png")
    try? png.write(to: url)
}
print("iconset written to \(outDir)")
