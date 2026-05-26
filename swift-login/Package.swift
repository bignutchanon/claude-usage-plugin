// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ClaudeUsageLogin",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "ClaudeUsageLogin",
            path: "Sources/ClaudeUsageLogin"
        )
    ]
)
