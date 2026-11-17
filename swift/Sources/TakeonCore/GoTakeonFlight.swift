#if canImport(Takeon)
import Foundation
import Takeon

/// A space flight run by the Go core (`mobile.Flight`). The rules, the layout of
/// every frame and the HUD wording all come from Go, so this class is the whole
/// iOS integration: feed input, call `step`, then paint `draw` with
/// `TakeonFlightCanvas` and show `hud().prompt`.
/// NOT thread-safe: use it from one actor (normally the main actor).
public final class GoTakeonFlight {
    private let flight: MobileFlight

    /// Start a flight from a Go `takeon.FlightConfig` JSON object.
    public init(configJSON: String) throws {
        var err: NSError?
        guard let f = MobileNewFlight(configJSON, &err) else {
            throw err ?? TakeonEngineError.runtime("MobileNewFlight returned nil")
        }
        flight = f
    }

    /// Resume from a `snapshot()` blob.
    public init(snapshot: Data) throws {
        var err: NSError?
        guard let f = MobileRestoreFlight(snapshot, &err) else {
            throw err ?? TakeonEngineError.runtime("MobileRestoreFlight returned nil")
        }
        flight = f
    }

    private static func call(_ body: (NSErrorPointer) throws -> String) throws -> String {
        var err: NSError?
        let out = try body(&err)
        if let err { throw err }
        return out
    }

    /// Hold a nudge, each axis -1...1 (x right, y up).
    public func steer(x: Double, y: Double) { flight.steer(x, y: y) }
    /// Hold the nudge for a finger at (tx, ty), each -1...1 from the middle of the view, x right and y up.
    public func steerToward(tx: Double, ty: Double) { flight.steerToward(tx, ty: ty) }
    /// Host-paced flights: where the trip clock is, 0...1.
    public func setProgress(_ progress: Double) { flight.setProgress(progress) }
    @discardableResult public func boost() -> Bool { flight.boost() }
    @discardableResult public func mark() -> Bool { flight.mark() }

    /// How the craft looks in `draw`.
    public func setCraft(_ look: TakeonFlightCraftLook) throws {
        try flight.setCraftJSON(String(decoding: try JSONEncoder().encode(look), as: UTF8.self))
    }

    /// Advance `dt` seconds and return the events raised.
    @discardableResult public func step(_ dt: Double) throws -> [TakeonFlightEvent] {
        struct Frame: Decodable { var events: [TakeonFlightEvent] }
        let json = try Self.call { try flight.step(dt, error: $0) }
        return try JSONDecoder().decode(Frame.self, from: Data(json.utf8)).events
    }

    /// Lay out the current moment for a view of `size` points; `dt` eases fades and shake.
    public func draw(width: Double, height: Double, dt: Double) throws -> TakeonFlightDraw {
        let json = try Self.call { try flight.drawJSON(width, h: height, dt: dt, error: $0) }
        return try JSONDecoder().decode(TakeonFlightDraw.self, from: Data(json.utf8))
    }

    public func hud() throws -> TakeonFlightHUD {
        let json = try Self.call { try flight.hudJSON($0) }
        return try JSONDecoder().decode(TakeonFlightHUD.self, from: Data(json.utf8))
    }

    public func snapshot() throws -> Data { try flight.snapshot() }
}
#endif
