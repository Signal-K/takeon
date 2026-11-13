// swift-tools-version: 6.0
import Foundation
import PackageDescription

// This binary is built from this checkout's go/mobile, just like browser/Node
// WASM and the Kotlin AAR. Build it with go/scripts/build.sh ios before use.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let framework = "go/dist/Takeon.xcframework"
let available = FileManager.default.fileExists(atPath: root.appendingPathComponent(framework).path)
var targets: [Target] = [
    .target(name: "TakeonCore", dependencies: available ? ["Takeon"] : [], path: "swift/Sources/TakeonCore"),
    .testTarget(name: "TakeonCoreTests", dependencies: ["TakeonCore"], path: "swift/Tests/TakeonCoreTests", resources: [.copy("Fixtures")]),
]
if available { targets.append(.binaryTarget(name: "Takeon", path: framework)) }
let package = Package(
    name: "takeon", platforms: [.iOS(.v17)],
    products: [.library(name: "TakeonCore", targets: ["TakeonCore"])],
    targets: targets
)
