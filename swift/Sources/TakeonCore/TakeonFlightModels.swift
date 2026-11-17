import Foundation

// Space flight data from the Go core (`go/flight_draw.go`). These are plain
// value types: the Go runtime decides every position, size, fade and draw
// order, and a SwiftUI host only paints `TakeonFlightDraw.shapes` in order.

/// One colour stop of a radial glow.
public struct TakeonFlightStop: Codable, Equatable, Sendable {
    public var at: Double
    public var c: String
    public var a: Double
}

/// One screen-space primitive (points, y down). Absent numbers are 0.
/// Kinds: sky, globe, limb (host textures), ellipse, poly, line, glow, text, vignette.
public struct TakeonFlightShape: Decodable, Equatable, Sendable {
    public var k: String
    public var x = 0.0, y = 0.0, x2 = 0.0, y2 = 0.0
    public var rx = 0.0, ry = 0.0, rot = 0.0, spin = 0.0
    public var pts: [Double] = []
    public var open = false
    public var fill: String?
    public var stroke: String?
    public var w = 0.0
    public var a = 0.0
    /// Lit from (x+lit[0], y+lit[1]) to dark at (x-lit[0], y-lit[1]): fill scaled 1.12, 0.92 at 0.45, 0.42 at 1.
    public var lit: [Double]?
    public var stops: [TakeonFlightStop] = []
    public var add = false
    public var text = ""
    public var size = 0.0

    enum CodingKeys: String, CodingKey { case k, x, y, x2, y2, rx, ry, rot, spin, pts, open, fill, stroke, w, a, lit, stops, add, text, size }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func d(_ key: CodingKeys) throws -> Double { try c.decodeIfPresent(Double.self, forKey: key) ?? 0 }
        k = try c.decode(String.self, forKey: .k)
        x = try d(.x); y = try d(.y); x2 = try d(.x2); y2 = try d(.y2)
        rx = try d(.rx); ry = try d(.ry); rot = try d(.rot); spin = try d(.spin)
        w = try d(.w); a = try d(.a); size = try d(.size)
        pts = try c.decodeIfPresent([Double].self, forKey: .pts) ?? []
        open = try c.decodeIfPresent(Bool.self, forKey: .open) ?? false
        fill = try c.decodeIfPresent(String.self, forKey: .fill)
        stroke = try c.decodeIfPresent(String.self, forKey: .stroke)
        lit = try c.decodeIfPresent([Double].self, forKey: .lit)
        stops = try c.decodeIfPresent([TakeonFlightStop].self, forKey: .stops) ?? []
        add = try c.decodeIfPresent(Bool.self, forKey: .add) ?? false
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
    }
}

/// One frame of a flight, painted in order.
public struct TakeonFlightDraw: Decodable, Equatable, Sendable {
    public var width: Double
    public var height: Double
    /// Seed for the host's starfield, so every host paints the same sky layout.
    public var skySeed: UInt32
    /// 0 corridor view ... 1 orbit view.
    public var orbitMix: Double
    public var shapes: [TakeonFlightShape]
}

/// What a HUD shows about a flight, worded by the Go core.
public struct TakeonFlightHUD: Decodable, Equatable, Sendable {
    public var phase: String
    public var percent: Int
    public var boosts: Int
    public var boostCharge: Double
    public var boosting: Bool
    public var hull: Double
    public var hits: Int
    public var pickups: Int
    public var samples: Int
    public var laps: Int
    public var canMark: Bool
    public var overhead: String?
    public var marked: Int
    public var sites: Int
    public var prompt: String
}

/// One event raised by a flight step (Go `takeon.FlightEvent`).
public struct TakeonFlightEvent: Decodable, Equatable, Sendable {
    public var kind: String
    public var detail: String?
    public var amount: Double?
}

/// A vehicle as a lathe: sections tail first (Go `takeon.FlightCraftLook`).
public struct TakeonFlightCraftLook: Codable, Equatable, Sendable {
    public struct Section: Codable, Equatable, Sendable {
        public var id: String
        public var length: Double
        public var r0: Double
        public var r1: Double
        public var color: String
        public var band: String?
        public init(id: String, length: Double, r0: Double, r1: Double, color: String, band: String? = nil) {
            self.id = id; self.length = length; self.r0 = r0; self.r1 = r1; self.color = color; self.band = band
        }
    }
    public struct Fins: Codable, Equatable, Sendable {
        public var count: Int, span: Double, length: Double, color: String
        public init(count: Int, span: Double, length: Double, color: String) { self.count = count; self.span = span; self.length = length; self.color = color }
    }
    public struct Boosters: Codable, Equatable, Sendable {
        public var count: Int, radius: Double, length: Double, color: String
        public init(count: Int, radius: Double, length: Double, color: String) { self.count = count; self.radius = radius; self.length = length; self.color = color }
    }
    public var sections: [Section]
    public var fins: Fins?
    public var boosters: Boosters?
    public var plume: String?
    public var scale: Double?
    public init(sections: [Section], fins: Fins? = nil, boosters: Boosters? = nil, plume: String? = nil, scale: Double? = nil) {
        self.sections = sections; self.fins = fins; self.boosters = boosters; self.plume = plume; self.scale = scale
    }
}

/// Parses "#rgb" or "#rrggbb" into 0...1 components; anything else is mid grey.
public func takeonFlightRGB(_ hex: String?, scale k: Double = 1) -> (r: Double, g: Double, b: Double) {
    var h = (hex ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
    while h.count < 6 { h += "0" }
    guard let n = UInt32(h.prefix(6), radix: 16) else { return (0.5, 0.5, 0.5) }
    func ch(_ v: UInt32) -> Double { min(1, Double(v & 255) / 255 * k) }
    return (ch(n >> 16), ch(n >> 8), ch(n))
}
