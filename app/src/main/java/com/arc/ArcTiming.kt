package com.arc

data class TimingModel(var emaMs: Double = 0.0, var samples: Int = 0)

data class RuntimeTiming(
    val timeoutMs: Long,
    val noProgressMs: Long,
    val sampleCount: Int = 0,
    val avgMs: Long = 0L,
    val p90Ms: Long = 0L
)

object ArcTiming {
    fun isDriveReferencePrompt(prompt: String): Boolean {
        val p = prompt.lowercase()
        val marks = listOf(
            "docs.google.com/spreadsheets",
            "drive.google.com",
            "@google",
            "google drive",
            "spreadsheet",
            "sheet",
            "スプレッドシート",
            "シート参照"
        )
        return marks.any { p.contains(it) }
    }

    private fun baseTimeoutMsFor(target: String, prompt: String): Long {
        if (isDriveReferencePrompt(prompt)) {
            return when (target.lowercase()) {
                "gemini" -> 150_000L
                else -> 120_000L
            }
        }
        return 45_000L
    }

    private fun baseNoProgressMsFor(target: String, prompt: String): Long {
        if (isDriveReferencePrompt(prompt)) {
            return when (target.lowercase()) {
                "gemini" -> 95_000L
                else -> 70_000L
            }
        }
        return 28_000L
    }

    fun timingKey(target: String, prompt: String): String {
        val mode = if (isDriveReferencePrompt(prompt)) "drive" else "normal"
        return "${target.lowercase()}:$mode"
    }

    fun recordAttemptTiming(
        target: String,
        prompt: String,
        elapsedMs: Long,
        success: Boolean,
        timingModels: MutableMap<String, TimingModel>,
        prefs: Prefs
    ) {
        if (elapsedMs <= 0L) return
        val key = timingKey(target, prompt)
        val m = timingModels.getOrPut(key) { TimingModel() }
        val x = elapsedMs.toDouble()
        if (m.samples <= 0) {
            m.emaMs = x
            m.samples = 1
            return
        }
        val alpha = if (success) 0.25 else 0.12
        m.emaMs = m.emaMs * (1.0 - alpha) + x * alpha
        m.samples += 1
        prefs.addTimingSample(
            key = key,
            elapsedMs = elapsedMs,
            success = success
        )
    }

    fun runtimeTimingFor(
        target: String,
        prompt: String,
        timingModels: Map<String, TimingModel>,
        prefs: Prefs
    ): RuntimeTiming {
        val key = timingKey(target, prompt)
        val baseTimeout = baseTimeoutMsFor(target, prompt)
        val baseNoProgress = baseNoProgressMsFor(target, prompt)
        var timeout = baseTimeout
        var noProgress = baseNoProgress

        val hist = prefs.getTimingStats(
            key = key,
            lookbackMs = 12 * 60 * 60_000L,
            minSamples = 3,
            successOnly = true
        )
        var sampleCount = 0
        var avgMs = 0L
        var p90Ms = 0L
        if (hist != null) {
            sampleCount = hist.samples
            avgMs = hist.avgMs
            p90Ms = hist.p90Ms
            val histTimeout = (hist.p90Ms + (hist.stdMs * 2).coerceAtLeast(5_000L))
                .coerceIn(35_000L, 240_000L)
            val histNoProgress = ((hist.avgMs * 0.58) + hist.stdMs)
                .toLong()
                .coerceIn(15_000L, (histTimeout - 5_000L).coerceAtLeast(15_000L))
            timeout = maxOf(timeout, histTimeout)
            noProgress = maxOf(noProgress, histNoProgress)
        }

        val model = timingModels[key]
        if (model != null && model.samples >= 2) {
            val emaTimeout = (model.emaMs * 1.85).toLong().coerceIn(35_000L, 240_000L)
            val emaNoProgress = (model.emaMs * 0.62).toLong().coerceIn(15_000L, (emaTimeout - 5_000L).coerceAtLeast(15_000L))
            timeout = maxOf(timeout, emaTimeout)
            noProgress = maxOf(noProgress, emaNoProgress)
        }

        if (isDriveReferencePrompt(prompt)) {
            timeout = timeout.coerceAtLeast(90_000L)
            noProgress = noProgress.coerceAtLeast(45_000L)
        }
        noProgress = noProgress.coerceAtMost((timeout - 5_000L).coerceAtLeast(15_000L))
        return RuntimeTiming(
            timeoutMs = timeout,
            noProgressMs = noProgress,
            sampleCount = sampleCount,
            avgMs = avgMs,
            p90Ms = p90Ms
        )
    }

    fun dynamicNoProgressLimitMs(
        target: String,
        prompt: String,
        baseMs: Long,
        elapsedMs: Long,
        generating: Boolean,
        assistantLen: Int,
        timeoutMs: Long,
        timingModels: Map<String, TimingModel>
    ): Long {
        var limit = baseMs
        val model = timingModels[timingKey(target, prompt)]
        if (model != null && model.samples >= 2) {
            val emaBased = (model.emaMs * 0.70).toLong().coerceAtLeast(15_000L)
            limit = maxOf(limit, emaBased)
        }

        if (generating || assistantLen > 0) {
            val longCap = (timeoutMs - 5_000L).coerceAtLeast(limit)
            limit = minOf(longCap, limit + 25_000L)
        } else if (elapsedMs >= 20_000L) {
            val coldCut = if (isDriveReferencePrompt(prompt)) 45_000L else 22_000L
            limit = minOf(limit, coldCut)
        }
        return limit
    }
}
