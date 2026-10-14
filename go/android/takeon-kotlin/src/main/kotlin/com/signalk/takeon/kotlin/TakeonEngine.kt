package com.signalk.takeon.kotlin

import com.signalk.takeon.mobile.Engine
import org.json.JSONArray
import org.json.JSONObject

/** One event raised by `step` (Go `takeon.Event`). */
data class TakeonEvent(val kind: String, val x: Int, val y: Int, val detail: String, val amount: Double)

/** Terrain rectangle (Go `takeon.WindowView`): row-major, y outer. Heights are top voxel z (-1 = void). */
data class TakeonTerrainWindow(
    val x: Int, val y: Int, val w: Int, val h: Int, val size: Int,
    val heights: IntArray, val mats: IntArray, val ore: IntArray,
) {
    fun height(tx: Int, ty: Int): Int =
        if (tx < x || ty < y || tx >= x + w || ty >= y + h) -1 else heights[(ty - y) * w + (tx - x)]
}

data class TakeonObjective(val kind: String, val label: String, val target: Double, val current: Double, val complete: Boolean)
data class TakeonMissionProgress(val missionId: String, val name: String, val objectives: List<TakeonObjective>, val complete: Boolean)

/**
 * Kotlin wrapper over the gomobile `takeon.aar` (`com.signalk.takeon.mobile.Engine`), mirroring the
 * iOS `TakeonEngine` protocol. NOT thread-safe: the Go engine is not goroutine-safe, so call it
 * from one thread (or serialise externally).
 */
class TakeonEngine private constructor(private val go: Engine) : AutoCloseable {
    constructor(seed: Long, bodyId: String) : this(Engine(seed and 0xFFFF_FFFFL, bodyId))

    fun loadWorld(bodyId: String, seed: Long) = go.loadWorld(bodyId, seed and 0xFFFF_FFFFL)

    /** Advance by [dtSeconds] (fixed 0.1 s ticks inside) and return the events raised. */
    fun step(dtSeconds: Double): List<TakeonEvent> {
        val a = JSONArray(go.step(dtSeconds))
        return (0 until a.length()).map { i ->
            a.getJSONObject(i).let { TakeonEvent(it.getString("kind"), it.optInt("x"), it.optInt("y"), it.optString("detail"), it.optDouble("amount", 0.0)) }
        }
    }

    /** "move" (arg = direction 0..3) or "drill". */
    fun order(kind: String, arg: Int = 0): Boolean = go.order(kind, arg.toLong())

    /** Autopilot: drive next to (x, y), face it and mine it down. */
    fun orderMine(x: Int, y: Int): Boolean = x in 0..0xFFFF && y in 0..0xFFFF && go.orderMine(x.toLong(), y.toLong())
    fun cancelOrder() = go.cancelOrder()
    fun bank(): Boolean = go.bank()

    fun stateJson(): JSONObject = JSONObject(go.stateJSON())
    fun snapshot(): ByteArray = go.snapshot()
    fun restore(blob: ByteArray) = go.restore(blob)

    fun missionProgress(): TakeonMissionProgress {
        val p = JSONObject(go.missionJSON()).getJSONObject("progress")
        val os = p.getJSONArray("objectives")
        return TakeonMissionProgress(
            p.getString("missionId"), p.getString("name"),
            (0 until os.length()).map { i ->
                os.getJSONObject(i).let { TakeonObjective(it.getString("kind"), it.getString("label"), it.getDouble("target"), it.getDouble("current"), it.getBoolean("complete")) }
            },
            p.getBoolean("complete"),
        )
    }

    fun window(x: Int, y: Int, w: Int, h: Int): TakeonTerrainWindow {
        val o = JSONObject(go.windowJSON(x.toLong(), y.toLong(), w.toLong(), h.toLong()))
        fun ints(k: String) = o.getJSONArray(k).let { a -> IntArray(a.length()) { a.getInt(it) } }
        return TakeonTerrainWindow(o.getInt("x"), o.getInt("y"), o.getInt("w"), o.getInt("h"), o.getInt("size"), ints("heights"), ints("mats"), ints("ore"))
    }

    override fun close() { /* gomobile proxies are GC-managed; nothing to release */ }
}
