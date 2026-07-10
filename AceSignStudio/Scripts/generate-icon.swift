// Renders the app icon (red Ace-style badge) into an .iconset folder.
// Run by build-app.sh:  swift Scripts/generate-icon.swift <output.iconset>
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let variants: [(pixels: Int, name: String)] = [
    (16, "16x16"), (32, "16x16@2x"),
    (32, "32x32"), (64, "32x32@2x"),
    (128, "128x128"), (256, "128x128@2x"),
    (256, "256x256"), (512, "256x256@2x"),
    (512, "512x512"), (1024, "512x512@2x"),
]

func drawIcon(pixels: Int) -> NSImage {
    let s = CGFloat(pixels)
    let image = NSImage(size: NSSize(width: s, height: s))
    image.lockFocus()

    // Rounded red tile
    let inset = s * 0.05
    let tile = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let path = NSBezierPath(roundedRect: tile, xRadius: s * 0.22, yRadius: s * 0.22)
    NSColor(calibratedRed: 0.784, green: 0.063, blue: 0.180, alpha: 1).setFill()
    path.fill()

    // Subtle top highlight
    let highlight = NSBezierPath(roundedRect: NSRect(x: inset, y: s * 0.52, width: s - 2 * inset, height: s * 0.43),
                                 xRadius: s * 0.20, yRadius: s * 0.20)
    NSColor.white.withAlphaComponent(0.08).setFill()
    highlight.fill()

    // "Ace" wordmark
    let baseFont = NSFont.systemFont(ofSize: s * 0.34, weight: .black)
    let aceFont = NSFontManager.shared.convert(baseFont, toHaveTrait: .italicFontMask)
    let ace = NSAttributedString(string: "Ace", attributes: [
        .font: aceFont,
        .foregroundColor: NSColor.white,
    ])
    let aceSize = ace.size()
    ace.draw(at: NSPoint(x: (s - aceSize.width) / 2, y: (s - aceSize.height) / 2 + s * 0.05))

    // "SIGNS" strip
    let strip = NSAttributedString(string: "SIGNS", attributes: [
        .font: NSFont.systemFont(ofSize: s * 0.085, weight: .bold),
        .foregroundColor: NSColor.white.withAlphaComponent(0.92),
        .kern: s * 0.03,
    ])
    let stripSize = strip.size()
    strip.draw(at: NSPoint(x: (s - stripSize.width) / 2, y: s * 0.20))

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
