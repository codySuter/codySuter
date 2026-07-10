import SwiftUI
import AppKit
import CoreText

/// The Ace brand font. Per the brand guidelines, Roboto is "used in ALL
/// communications and is the main font" — so signs render in Roboto
/// Black/Bold/Medium/Regular. The faces are embedded (RobotoFontData.swift,
/// Apache License 2.0), written to Application Support on first launch, and
/// registered with CoreText for this process. If anything about that fails,
/// signs fall back to the system font so the app never breaks.
enum AceFont {
    enum Weight: String {
        case black = "Roboto-Black"
        case bold = "Roboto-Bold"
        case medium = "Roboto-Medium"
        case regular = "Roboto-Regular"
    }

    private static var didAttemptRegistration = false

    static func registerFonts() {
        guard !didAttemptRegistration else { return }
        didAttemptRegistration = true

        let fm = FileManager.default
        guard let support = try? fm.url(for: .applicationSupportDirectory,
                                        in: .userDomainMask,
                                        appropriateFor: nil,
                                        create: true) else { return }
        let dir = support.appendingPathComponent("Ace Sign Studio/Fonts", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)

        let faces: [(file: String, base64: String)] = [
            ("Roboto-Black.ttf", RobotoFontData.blackBase64),
            ("Roboto-Bold.ttf", RobotoFontData.boldBase64),
            ("Roboto-Medium.ttf", RobotoFontData.mediumBase64),
            ("Roboto-Regular.ttf", RobotoFontData.regularBase64),
        ]

        var urls: [URL] = []
        for face in faces {
            let url = dir.appendingPathComponent(face.file)
            if !fm.fileExists(atPath: url.path), let data = Data(base64Encoded: face.base64) {
                try? data.write(to: url)
            }
            if fm.fileExists(atPath: url.path) {
                urls.append(url)
            }
        }
        guard !urls.isEmpty else { return }
        // Already-registered faces (e.g. Roboto installed system-wide) fail
        // individually and harmlessly — the name still resolves.
        CTFontManagerRegisterFontURLs(urls as CFArray, .process, true, nil)
    }

    /// Roboto at an exact point size, falling back to the system font.
    static func font(size: CGFloat, weight: Weight) -> Font {
        if NSFont(name: weight.rawValue, size: size) != nil {
            return .custom(weight.rawValue, fixedSize: size)
        }
        let systemWeight: Font.Weight
        switch weight {
        case .black: systemWeight = .black
        case .bold: systemWeight = .bold
        case .medium: systemWeight = .medium
        case .regular: systemWeight = .regular
        }
        return .system(size: size, weight: systemWeight)
    }
}
