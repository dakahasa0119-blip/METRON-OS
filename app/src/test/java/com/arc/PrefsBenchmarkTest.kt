package com.arc

import org.json.JSONArray
import org.junit.Test
import kotlin.system.measureTimeMillis

class PrefsBenchmarkTest {

    @Test
    fun benchmarkDirectVsCached() {
        val json = """
            [
                {"slot_id": "slot1", "target": "target1"},
                {"slot_id": "slot2", "target": "target2"},
                {"slot_id": "slot3", "target": "target3"},
                {"slot_id": "slot4", "target": "target4"},
                {"slot_id": "slot5", "target": "target5"}
            ]
        """.trimIndent()

        fun simulateDirect(target: String): String {
            return try {
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val id = obj.optString("slot_id", "")
                    if (id == target) {
                        return obj.optString("target", "")
                    }
                }
                ""
            } catch (_: Exception) { "" }
        }

        var cachedArr = JSONArray(json)
        fun simulateCached(target: String): String {
            return try {
                val arr = cachedArr
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val id = obj.optString("slot_id", "")
                    if (id == target) {
                        return obj.optString("target", "")
                    }
                }
                ""
            } catch (_: Exception) { "" }
        }

        // Warmup
        for (i in 0 until 1000) {
            simulateDirect("slot3")
            simulateCached("slot3")
        }

        // Measure Direct
        val timeDirect = measureTimeMillis {
            for (i in 0 until 10000) {
                simulateDirect("slot5")
                simulateDirect("slot2")
                simulateDirect("slot4")
            }
        }

        // Measure Cached
        val timeCached = measureTimeMillis {
            for (i in 0 until 10000) {
                simulateCached("slot5")
                simulateCached("slot2")
                simulateCached("slot4")
            }
        }

        println("BENCHMARK RESULT:")
        println("Direct parsing: ${timeDirect}ms for 30000 reads")
        println("Cached parsing: ${timeCached}ms for 30000 reads")
        println("Improvement: ${timeDirect - timeCached}ms (${(timeDirect - timeCached) * 100.0 / timeDirect}%)")
    }
}
