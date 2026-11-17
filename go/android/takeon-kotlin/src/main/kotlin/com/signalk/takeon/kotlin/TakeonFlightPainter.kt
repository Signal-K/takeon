package com.signalk.takeon.kotlin

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import kotlin.math.max
import kotlin.math.min

/**
 * Paints a Go [FlightDraw] on an Android [Canvas], shape by shape, with the same contract as the web
 * painter (`packages/engine/src/flight/view.ts`) and SwiftUI (`TakeonFlightCanvas.swift`). Works from a
 * custom View's `onDraw` or Compose's `drawIntoCanvas { it.nativeCanvas }`.
 *
 * Draw lists are in the units the host passed to [TakeonFlight.draw]; pass [density] to map them to pixels
 * (lay out in dp, paint in px). Sky, globe and limb are host textures; override them for real planet art.
 */
open class TakeonFlightPainter(
    /** Destination colours, low ground to high ground. */
    private val bodyColors: List<String> = listOf("#5d3a2a", "#9a5a3c", "#c98a5e", "#e2b98f"),
    private val atmosphere: String? = "#e8a070",
) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()
    private val oval = RectF()
    private val matrix = Matrix()
    private val additive = PorterDuffXfermode(PorterDuff.Mode.ADD)

    fun paint(canvas: Canvas, draw: FlightDraw, density: Float = 1f) {
        canvas.save()
        canvas.scale(density, density)
        canvas.drawColor(parse("#04060c"))
        for (s in draw.shapes) shape(canvas, s, draw)
        canvas.restore()
    }

    private fun reset(alpha: Double) {
        paint.reset()
        paint.isAntiAlias = true
        paint.alpha = (255 * alpha.coerceIn(0.0, 1.0)).toInt()
    }

    private fun shape(canvas: Canvas, s: FlightShape, draw: FlightDraw) {
        val x = s.x.toFloat(); val y = s.y.toFloat()
        reset(s.a)
        when (s.k) {
            "sky" -> sky(canvas, RectF(x, y, x + s.rx.toFloat(), y + s.ry.toFloat()), draw.skySeed, s.a)
            "globe" -> globe(canvas, x, y, s.rx.toFloat(), s.spin, s.a)
            "limb" -> limb(canvas, x, y, s.rx.toFloat(), s.spin, s.a)
            "vignette" -> {
                val w = draw.width.toFloat(); val h = draw.height.toFloat(); val r = max(w, h) * 0.75f
                paint.shader = RadialGradient(w / 2, h / 2, r, intArrayOf(withAlpha(s.fill, 0.0), withAlpha(s.fill, s.a)),
                    floatArrayOf(min(w, h) * 0.25f / r, 1f), Shader.TileMode.CLAMP)
                canvas.drawRect(0f, 0f, w, h, paint)
            }
            "glow" -> {
                val r = max(0.5f, s.rx.toFloat())
                if (s.stops.size < 2) return
                paint.shader = RadialGradient(x, y, r, s.stops.map { withAlpha(it.color, it.alpha * s.a) }.toIntArray(),
                    s.stops.map { it.at.toFloat().coerceIn(0f, 1f) }.toFloatArray(), Shader.TileMode.CLAMP)
                paint.alpha = 255
                if (s.add) paint.xfermode = additive
                canvas.drawCircle(x, y, r, paint)
            }
            "line" -> {
                paint.style = Paint.Style.STROKE; paint.strokeWidth = max(0.1f, s.w.toFloat()); paint.color = withAlpha(s.stroke, s.a)
                canvas.drawLine(x, y, s.x2.toFloat(), s.y2.toFloat(), paint)
            }
            "text" -> {
                paint.color = withAlpha(s.fill, s.a); paint.textSize = (if (s.size > 0) s.size else 14.0).toFloat()
                paint.textAlign = Paint.Align.CENTER; paint.isFakeBoldText = true
                canvas.drawText(s.text, x, y, paint)
            }
            "ellipse", "poly" -> {
                path.reset()
                if (s.k == "ellipse") {
                    oval.set(x - s.rx.toFloat(), y - s.ry.toFloat(), x + s.rx.toFloat(), y + s.ry.toFloat())
                    path.addOval(oval, Path.Direction.CW)
                    // Rotate the path itself so lit gradients stay in screen space, like the other painters.
                    matrix.setRotate(Math.toDegrees(s.rot).toFloat(), x, y)
                    path.transform(matrix)
                } else if (s.pts.size >= 4) {
                    path.moveTo(s.pts[0].toFloat(), s.pts[1].toFloat())
                    var i = 2
                    while (i + 1 < s.pts.size) { path.lineTo(s.pts[i].toFloat(), s.pts[i + 1].toFloat()); i += 2 }
                    if (!s.open) path.close()
                }
                s.fill?.let { fill ->
                    paint.style = Paint.Style.FILL
                    val lit = s.lit
                    if (lit != null && lit.size == 2) {
                        paint.shader = LinearGradient((s.x + lit[0]).toFloat(), (s.y + lit[1]).toFloat(), (s.x - lit[0]).toFloat(), (s.y - lit[1]).toFloat(),
                            intArrayOf(scaled(fill, 1.12, s.a), scaled(fill, 0.92, s.a), scaled(fill, 0.42, s.a)), floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP)
                        paint.alpha = 255
                    } else paint.color = withAlpha(fill, s.a)
                    canvas.drawPath(path, paint)
                }
                s.stroke?.let { stroke ->
                    reset(s.a)
                    paint.style = Paint.Style.STROKE; paint.strokeWidth = max(0.1f, s.w.toFloat()); paint.color = withAlpha(stroke, s.a)
                    canvas.drawPath(path, paint)
                }
            }
        }
    }

    /** Starfield texture. The default uses the Go core's RNG family, seeded per flight. */
    protected open fun sky(canvas: Canvas, rect: RectF, seed: Long, alpha: Double) {
        var a = ((seed xor 0x9e37L) and 0xFFFFFFFFL).toInt()
        fun next(): Double {
            a += 0x6d2b79f5
            var t = (a xor (a ushr 15)) * (1 or a)
            t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
            return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL) / 4294967296.0
        }
        reset(alpha)
        repeat(420) {
            val x = rect.left + next() * rect.width(); val y = rect.top + next() * rect.height(); val m = next()
            val size = if (m > 0.97) 1.7f else if (m > 0.8) 1.1f else 0.7f
            paint.color = Color.argb((255 * (0.35 + m * 0.6) * alpha).toInt(), 230, 235, 245)
            canvas.drawRect(x.toFloat(), y.toFloat(), x.toFloat() + size, y.toFloat() + size, paint)
        }
    }

    /** Destination disc. Override to paint real planet art; [rotation] turns it. */
    protected open fun globe(canvas: Canvas, cx: Float, cy: Float, r: Float, rotation: Double, alpha: Double) = disc(canvas, cx, cy, r, alpha)

    /** Destination seen from orbit: the top of a huge disc centred below the view. */
    protected open fun limb(canvas: Canvas, cx: Float, cy: Float, r: Float, rotation: Double, alpha: Double) = disc(canvas, cx, cy, r, alpha)

    private fun disc(canvas: Canvas, cx: Float, cy: Float, r: Float, alpha: Double) {
        atmosphere?.let {
            reset(1.0)
            paint.shader = RadialGradient(cx, cy, r * 1.06f, intArrayOf(withAlpha(it, 0.5 * alpha), withAlpha(it, 0.0)), floatArrayOf(0.9f, 1f), Shader.TileMode.CLAMP)
            canvas.drawCircle(cx, cy, r * 1.06f, paint)
        }
        reset(1.0)
        val colors = bodyColors.ifEmpty { listOf("#888888") }
        // Lit from the upper left, like the craft.
        paint.shader = RadialGradient(cx - r * 0.45f, cy - r * 0.45f, r * 1.9f,
            (colors.reversed().map { withAlpha(it, alpha) } + scaled(colors.first(), 0.25, alpha)).toIntArray(), null, Shader.TileMode.CLAMP)
        canvas.drawCircle(cx, cy, r, paint)
    }

    private fun parse(hex: String?): Int {
        var h = (hex ?: "").removePrefix("#")
        if (h.length == 3) h = h.map { "$it$it" }.joinToString("")
        h = h.padEnd(6, '0').take(6)
        val n = h.toLongOrNull(16) ?: return Color.rgb(128, 128, 128)
        return Color.rgb(((n shr 16) and 255).toInt(), ((n shr 8) and 255).toInt(), (n and 255).toInt())
    }

    private fun withAlpha(hex: String?, alpha: Double): Int {
        val c = parse(hex)
        return Color.argb((255 * alpha.coerceIn(0.0, 1.0)).toInt(), Color.red(c), Color.green(c), Color.blue(c))
    }

    private fun scaled(hex: String, k: Double, alpha: Double): Int {
        val c = parse(hex)
        fun ch(v: Int) = min(255.0, v * k).toInt()
        return Color.argb((255 * alpha.coerceIn(0.0, 1.0)).toInt(), ch(Color.red(c)), ch(Color.green(c)), ch(Color.blue(c)))
    }
}
