// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "AceSignStudio",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "AceSignStudio",
            path: "Sources/AceSignStudio"
        )
    ]
)
