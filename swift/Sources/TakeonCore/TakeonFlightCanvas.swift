#if canImport(SwiftUI)
import SwiftUI

/// The three textures a flight draw list places but does not describe. A host
/// that has its own planet art passes closures; the defaults paint a seeded
/// starfield and a lit disc in the destination's colours.
public struct TakeonFlightTextures {
    /// Destination colours, low ground to high ground ("#rrggbb").
    public var bodyColors: [String]
    /// Rim glow colour; nil for an airless body.
    public var atmosphere: String?
    public var sky: ((inout GraphicsContext, CGRect, UInt32) -> Void)?
    public var globe: ((inout GraphicsContext, CGPoint, Double, Double) -> Void)?
    public var limb: ((inout GraphicsContext, CGPoint, Double, Double) -> Void)?

    public init(bodyColors: [String] = ["#5d3a2a", "#9a5a3c", "#c98a5e", "#e2b98f"], atmosphere: String? = "#e8a070") {
        self.bodyColors = bodyColors
        self.atmosphere = atmosphere
    }
}

private func color(_ hex: String?, _ alpha: Double = 1, scale: Double = 1) -> Color {
    let c = takeonFlightRGB(hex, scale: scale)
    return Color(.sRGB, red: c.r, green: c.g, blue: c.b, opacity: alpha)
}

/// Paint one Go flight frame into a SwiftUI `GraphicsContext`, shape by shape,
/// following the same contract as the web painter (`packages/engine/src/flight/view.ts`).
public func takeonPaintFlight(_ draw: TakeonFlightDraw, in context: inout GraphicsContext, size: CGSize, textures: TakeonFlightTextures = TakeonFlightTextures()) {
    context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(color("#04060c")))
    for s in draw.shapes {
        var ctx = context
        ctx.opacity = max(0, min(1, s.a))
        let centre = CGPoint(x: s.x, y: s.y)
        switch s.k {
        case "sky":
            let rect = CGRect(x: s.x, y: s.y, width: s.rx, height: s.ry)
            if let sky = textures.sky { sky(&ctx, rect, draw.skySeed) } else { defaultSky(&ctx, rect, seed: draw.skySeed) }
        case "globe":
            if let globe = textures.globe { globe(&ctx, centre, s.rx, s.spin) } else { defaultDisc(&ctx, centre, s.rx, textures) }
        case "limb":
            if let limb = textures.limb { limb(&ctx, centre, s.rx, s.spin) } else { defaultDisc(&ctx, centre, s.rx, textures) }
        case "vignette":
            let r = Double(max(size.width, size.height)) * 0.75
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .radialGradient(
                Gradient(stops: [.init(color: color(s.fill, 0), location: Double(min(size.width, size.height)) * 0.25 / r), .init(color: color(s.fill, 1), location: 1)]),
                center: CGPoint(x: size.width / 2, y: size.height / 2), startRadius: 0, endRadius: r))
        case "glow":
            let r = max(0.5, s.rx)
            if s.add { ctx.blendMode = .plusLighter }
            let stops = s.stops.map { Gradient.Stop(color: color($0.c, $0.a), location: max(0, min(1, $0.at))) }
            ctx.fill(Path(ellipseIn: CGRect(x: s.x - r, y: s.y - r, width: r * 2, height: r * 2)),
                     with: .radialGradient(Gradient(stops: stops), center: centre, startRadius: 0, endRadius: r))
        case "line":
            var p = Path(); p.move(to: centre); p.addLine(to: CGPoint(x: s.x2, y: s.y2))
            ctx.stroke(p, with: .color(color(s.stroke)), lineWidth: max(0.1, s.w))
        case "text":
            ctx.draw(Text(s.text).font(.system(size: s.size > 0 ? s.size : 14, weight: .semibold)).foregroundColor(color(s.fill)),
                     at: centre, anchor: .bottom)
        case "ellipse", "poly":
            var path = Path()
            if s.k == "ellipse" {
                path.addEllipse(in: CGRect(x: -s.rx, y: -s.ry, width: s.rx * 2, height: s.ry * 2))
                path = path.applying(CGAffineTransform(rotationAngle: s.rot).concatenating(CGAffineTransform(translationX: s.x, y: s.y)))
            } else if s.pts.count >= 4 {
                path.move(to: CGPoint(x: s.pts[0], y: s.pts[1]))
                stride(from: 2, to: s.pts.count - 1, by: 2).forEach { path.addLine(to: CGPoint(x: s.pts[$0], y: s.pts[$0 + 1])) }
                if !s.open { path.closeSubpath() }
            }
            if let fill = s.fill {
                if let lit = s.lit, lit.count == 2 {
                    ctx.fill(path, with: .linearGradient(
                        Gradient(stops: [.init(color: color(fill, scale: 1.12), location: 0), .init(color: color(fill, scale: 0.92), location: 0.45), .init(color: color(fill, scale: 0.42), location: 1)]),
                        startPoint: CGPoint(x: s.x + lit[0], y: s.y + lit[1]), endPoint: CGPoint(x: s.x - lit[0], y: s.y - lit[1])))
                } else {
                    ctx.fill(path, with: .color(color(fill)))
                }
            }
            if let stroke = s.stroke { ctx.stroke(path, with: .color(color(stroke)), lineWidth: max(0.1, s.w)) }
        default:
            continue
        }
    }
}

private func defaultSky(_ ctx: inout GraphicsContext, _ rect: CGRect, seed: UInt32) {
    // Same generator family as the Go core (mulberry32), so the layout is stable per flight.
    var a = seed ^ 0x9e37
    func next() -> Double {
        a = a &+ 0x6d2b79f5
        var t = (a ^ (a >> 15)) &* (1 | a)
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        return Double(t ^ (t >> 14)) / 4294967296
    }
    for _ in 0..<420 {
        let x = rect.minX + next() * rect.width, y = rect.minY + next() * rect.height, m = next()
        let s = m > 0.97 ? 1.7 : m > 0.8 ? 1.1 : 0.7
        ctx.fill(Path(CGRect(x: x, y: y, width: s, height: s)), with: .color(Color(.sRGB, red: 0.9, green: 0.92, blue: 0.96, opacity: 0.35 + m * 0.6)))
    }
}

private func defaultDisc(_ ctx: inout GraphicsContext, _ c: CGPoint, _ r: Double, _ t: TakeonFlightTextures) {
    let rect = CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
    if let atmosphere = t.atmosphere {
        ctx.fill(Path(ellipseIn: rect.insetBy(dx: -r * 0.06, dy: -r * 0.06)), with: .radialGradient(
            Gradient(stops: [.init(color: color(atmosphere, 0.5), location: 0.9), .init(color: color(atmosphere, 0), location: 1)]),
            center: c, startRadius: 0, endRadius: r * 1.06))
    }
    // Lit from the upper left, like the craft and the web globe.
    let colors = t.bodyColors.isEmpty ? ["#888888"] : t.bodyColors
    ctx.fill(Path(ellipseIn: rect), with: .radialGradient(
        Gradient(colors: colors.reversed().map { color($0) } + [color(colors.first, scale: 0.25)]),
        center: CGPoint(x: c.x - r * 0.45, y: c.y - r * 0.45), startRadius: 0, endRadius: r * 1.9))
}

/// A SwiftUI view that runs a Go flight every display frame and paints it.
/// Drag to steer (Go maps the finger), tap the host's own buttons for boost and mark.
@available(iOS 17.0, macOS 14.0, *)
public struct TakeonFlightCanvas: View {
    private let step: (Double, CGSize) -> TakeonFlightDraw?
    private let touch: (Double, Double) -> Void
    private let release: () -> Void
    private let textures: TakeonFlightTextures
    @State private var last: Date?

    /// `step(dt, size)` advances the flight and returns its draw list; `touch(tx, ty)` holds a finger nudge.
    public init(textures: TakeonFlightTextures = TakeonFlightTextures(), step: @escaping (Double, CGSize) -> TakeonFlightDraw?,
                touch: @escaping (Double, Double) -> Void, release: @escaping () -> Void) {
        self.textures = textures; self.step = step; self.touch = touch; self.release = release
    }

    public var body: some View {
        GeometryReader { geo in
            TimelineView(.animation) { timeline in
                Canvas { context, size in
                    let now = timeline.date
                    let dt = last.map { min(0.1, now.timeIntervalSince($0)) } ?? 1.0 / 60
                    DispatchQueue.main.async { last = now }
                    if let draw = step(dt, size) { takeonPaintFlight(draw, in: &context, size: size, textures: textures) }
                }
            }
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { g in
                    let w = max(1, geo.size.width), h = max(1, geo.size.height)
                    touch(g.location.x / w * 2 - 1, 1 - g.location.y / h * 2)
                }
                .onEnded { _ in release() })
        }
        .accessibilityLabel("Space flight view")
    }
}
#endif
