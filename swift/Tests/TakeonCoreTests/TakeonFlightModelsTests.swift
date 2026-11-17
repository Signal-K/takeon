import XCTest
@testable import TakeonCore

/// Decodes a frame the Go core wrote (`flight-frame.json`), so the Swift models
/// stay in step with `go/flight_draw.go` even where the Go framework is absent.
final class TakeonFlightModelsTests: XCTestCase {
    func testDecodesAGoFlightFrame() throws {
        struct Fixture: Decodable { var draw: TakeonFlightDraw; var hud: TakeonFlightHUD }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "flight-frame", withExtension: "json", subdirectory: "Fixtures"))
        let f = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        XCTAssertEqual(f.draw.width, 390)
        XCTAssertEqual(f.draw.shapes.first?.k, "sky")
        XCTAssertEqual(f.draw.shapes.filter { $0.k == "globe" }.count, 1)
        XCTAssertTrue(f.draw.shapes.contains { $0.k == "ellipse" && $0.lit != nil })
        XCTAssertTrue(f.draw.shapes.contains { $0.k == "glow" && $0.add })
        XCTAssertFalse(f.hud.prompt.isEmpty)
        let rgb = takeonFlightRGB("#ff8000")
        XCTAssertEqual(rgb.r, 1); XCTAssertEqual(rgb.b, 0)
    }
}
