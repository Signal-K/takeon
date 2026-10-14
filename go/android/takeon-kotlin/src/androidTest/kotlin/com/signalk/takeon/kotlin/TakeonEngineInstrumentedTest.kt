package com.signalk.takeon.kotlin

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Proves libgojni.so loads on-device and the Go engine steps, mines and reports mission progress. */
@RunWith(AndroidJUnit4::class)
class TakeonEngineInstrumentedTest {
    @Test fun loadsAndSteps() {
        val e = TakeonEngine(4212, "moon")
        val before = e.stateJson().getJSONObject("rover").getDouble("battery")
        assertTrue(e.order("move", 0) || e.order("move", 1) || e.order("move", 2) || e.order("move", 3))
        e.step(2.0)
        val st = e.stateJson()
        assertTrue("time advanced", st.getDouble("time") > 0.0)
        assertTrue("moving costs battery", st.getJSONObject("rover").getDouble("battery") < before)
    }

    @Test fun windowAndMineOrder() {
        val e = TakeonEngine(4212, "moon")
        val rover = e.stateJson().getJSONObject("rover").getJSONObject("pos")
        val (rx, ry) = rover.getInt("x") to rover.getInt("y")
        val w = e.window(rx - 6, ry - 6, 13, 13)
        assertEquals(169, w.heights.size)
        var target: Pair<Int, Int>? = null
        loop@ for (d in 2..5) for (dy in -d..d) for (dx in -d..d) {
            if (maxOf(Math.abs(dx), Math.abs(dy)) == d && w.height(rx + dx, ry + dy) >= 1) { target = (rx + dx) to (ry + dy); break@loop }
        }
        assertNotNull(target)
        val (tx, ty) = target!!
        val before = w.height(tx, ty)
        assertTrue(e.orderMine(tx, ty))
        repeat(600) { e.step(0.1) }
        assertTrue("mined column is lower", e.window(tx, ty, 1, 1).height(tx, ty) < before)
        assertEquals(3.0, e.missionProgress().objectives.first().target, 0.0)
    }
}
