package com.signalk.takeon.kotlin

import com.signalk.takeon.mobile.Flight
import com.signalk.takeon.mobile.Mobile
import org.json.JSONArray
import org.json.JSONObject

/** One colour stop of a radial glow. */
data class FlightStop(val at: Double, val color: String, val alpha: Double)

/**
 * One screen-space primitive from the Go core (`go/flight_draw.go`), in the view's units, y down.
 * Kinds: sky, globe, limb (host textures), ellipse, poly, line, glow, text, vignette.
 * [lit] = light at (x+lit[0], y+lit[1]) to dark at (x-lit[0], y-lit[1]): fill scaled 1.12, 0.92 at 0.45, 0.42 at 1.
 */
class FlightShape(
    val k: String,
    val x: Double, val y: Double, val x2: Double, val y2: Double,
    val rx: Double, val ry: Double, val rot: Double, val spin: Double,
    val pts: DoubleArray, val open: Boolean,
    val fill: String?, val stroke: String?, val w: Double, val a: Double,
    val lit: DoubleArray?, val stops: List<FlightStop>, val add: Boolean,
    val text: String, val size: Double,
) {
    companion object {
        fun parse(o: JSONObject): FlightShape {
            fun d(key: String) = o.optDouble(key, 0.0)
            fun s(key: String) = if (o.has(key)) o.getString(key) else null
            fun doubles(key: String) = o.optJSONArray(key)?.let { a -> DoubleArray(a.length()) { a.getDouble(it) } }
            val stops = o.optJSONArray("stops")?.let { a ->
                (0 until a.length()).map { i -> a.getJSONObject(i).let { FlightStop(it.optDouble("at", 0.0), it.getString("c"), it.optDouble("a", 0.0)) } }
            } ?: emptyList()
            return FlightShape(
                o.getString("k"), d("x"), d("y"), d("x2"), d("y2"), d("rx"), d("ry"), d("rot"), d("spin"),
                doubles("pts") ?: DoubleArray(0), o.optBoolean("open"), s("fill"), s("stroke"), d("w"), d("a"),
                doubles("lit"), stops, o.optBoolean("add"), o.optString("text"), d("size"),
            )
        }
    }
}

/** One frame of a flight, painted in order. */
class FlightDraw(val width: Double, val height: Double, val skySeed: Long, val orbitMix: Double, val shapes: List<FlightShape>) {
    companion object {
        fun parse(json: String): FlightDraw {
            val o = JSONObject(json)
            val a = o.getJSONArray("shapes")
            return FlightDraw(o.getDouble("width"), o.getDouble("height"), o.getLong("skySeed"), o.getDouble("orbitMix"),
                (0 until a.length()).map { FlightShape.parse(a.getJSONObject(it)) })
        }
    }
}

/** What a HUD shows about a flight, worded by the Go core. */
data class FlightHud(
    val phase: String, val percent: Int, val boosts: Int, val boostCharge: Double, val boosting: Boolean,
    val hull: Double, val hits: Int, val pickups: Int, val samples: Int, val laps: Int,
    val canMark: Boolean, val overhead: String?, val marked: Int, val sites: Int, val prompt: String,
) {
    companion object {
        fun parse(json: String): FlightHud = JSONObject(json).let {
            FlightHud(it.getString("phase"), it.getInt("percent"), it.getInt("boosts"), it.getDouble("boostCharge"), it.getBoolean("boosting"),
                it.getDouble("hull"), it.getInt("hits"), it.getInt("pickups"), it.getInt("samples"), it.getInt("laps"),
                it.getBoolean("canMark"), if (it.isNull("overhead")) null else it.getString("overhead"), it.getInt("marked"), it.getInt("sites"), it.getString("prompt"))
        }
    }
}

/** One event raised by a flight step (Go `takeon.FlightEvent`). */
data class FlightEvent(val kind: String, val detail: String, val amount: Double)

/**
 * A space flight run by the Go core (`mobile.Flight`). Rules, frame layout and HUD wording all come from
 * Go, so an Android host only feeds input, calls [step], paints [draw] with [TakeonFlightPainter] and shows
 * [hud]`.prompt`. NOT thread-safe: call it from one thread (normally the UI thread).
 */
class TakeonFlight private constructor(private val go: Flight) : AutoCloseable {
    /** Start a flight from a Go `takeon.FlightConfig` JSON object. */
    constructor(configJson: String) : this(Flight(configJson))

    companion object {
        /** Resume from a [snapshot] blob. */
        fun restore(snapshot: ByteArray) = TakeonFlight(Mobile.restoreFlight(snapshot))
    }

    /** Hold a nudge, each axis -1..1 (x right, y up). */
    fun steer(x: Double, y: Double) = go.steer(x, y)
    /** Hold the nudge for a finger at (tx, ty), each -1..1 from the middle of the view, x right and y up. */
    fun steerToward(tx: Double, ty: Double) = go.steerToward(tx, ty)
    /** Host-paced flights: where the trip clock is, 0..1. */
    fun setProgress(progress: Double) = go.setProgress(progress)
    fun boost(): Boolean = go.boost()
    fun mark(): Boolean = go.mark()

    /** How the craft looks in [draw] (Go `takeon.FlightCraftLook` JSON). */
    fun setCraftJson(lookJson: String) = go.setCraftJSON(lookJson)

    /** Advance [dtSeconds] and return the events raised. */
    fun step(dtSeconds: Double): List<FlightEvent> {
        val a: JSONArray = JSONObject(go.step(dtSeconds)).getJSONArray("events")
        return (0 until a.length()).map { i -> a.getJSONObject(i).let { FlightEvent(it.getString("kind"), it.optString("detail"), it.optDouble("amount", 0.0)) } }
    }

    /** Lay out the current moment for a [width] x [height] view; [dt] eases fades and shake. */
    fun draw(width: Double, height: Double, dt: Double): FlightDraw = FlightDraw.parse(go.drawJSON(width, height, dt))

    fun hud(): FlightHud = FlightHud.parse(go.hudJSON())

    fun snapshot(): ByteArray = go.snapshot()

    override fun close() { /* gomobile proxies are GC-managed; nothing to release */ }
}
