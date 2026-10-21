package com.arc

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

class ArcBotManager(
    private val web: WebViewManager,
    private val prefs: Prefs,
    private val emitStatus: (String) -> Unit
) {
    data class BotEvent(
        val confidence: Int,
        val atMs: Long
    )
    val pendingBotEvents = mutableMapOf<String, BotEvent>()

    fun isLoginRequiredUrl(target: String, url: String): Boolean {
        return BotDetectionEngine.isLoginRequiredUrl(target, url)
    }

    fun isBotBlocked(type: String, data: String?): Boolean {
        val raw = BotDetectionEngine.fromError(
            type = type,
            data = data,
            url = web.currentUrl()
        )
        val t = prefs.getBotThresholds()
        val signal = BotDetectionEngine.applyThresholds(raw, t.blocked, t.interstitial)
        return signal.decision == BotDecision.BOT_BLOCKED
    }

    fun extractConfidence(detail: String?): Int {
        if (detail.isNullOrBlank()) return 0
        return Regex("""confidence=(\d+)""")
            .find(detail)
            ?.groupValues
            ?.getOrNull(1)
            ?.toIntOrNull()
            ?.coerceIn(0, 100)
            ?: 0
    }

    fun rememberBotEvent(qid: String?, detail: String?) {
        if (qid.isNullOrBlank()) return
        pendingBotEvents[qid] = BotEvent(
            confidence = extractConfidence(detail),
            atMs = System.currentTimeMillis()
        )
    }

    fun tuneBotThresholdOnSuccess(qid: String?) {
        if (qid.isNullOrBlank()) return
        val ev = pendingBotEvents.remove(qid) ?: return
        val age = System.currentTimeMillis() - ev.atMs
        if (age > 120_000L) return
        val next = prefs.adjustBotThresholds(
            deltaBlocked = if (ev.confidence >= 60) 1 else 0,
            deltaInterstitial = 0
        )
        emitStatus("BOT_AUTOTUNE success blocked=${next.blocked} interstitial=${next.interstitial}")
    }

    fun tuneBotThresholdOnFailure(qid: String?, type: String, data: String?) {
        if (qid.isNullOrBlank()) return
        val ev = pendingBotEvents.remove(qid) ?: return
        if (!type.contains("BOT_BLOCKED", ignoreCase = true) && !isBotBlocked(type, data)) return
        if (System.currentTimeMillis() - ev.atMs > 180_000L) return
        val next = prefs.adjustBotThresholds(
            deltaBlocked = -1,
            deltaInterstitial = -1
        )
        emitStatus("BOT_AUTOTUNE fail blocked=${next.blocked} interstitial=${next.interstitial}")
    }

    suspend fun detectBotWallQuick(): BotSignal {
        val d = CompletableDeferred<BotSignal>()
        web.detectBotWall { signal ->
            if (!d.isCompleted) d.complete(signal)
        }
        return withTimeoutOrNull(1500) { d.await() }
            ?: BotSignal(decision = BotDecision.CLEAR, confidence = 0, mark = "timeout", source = "arc_timeout")
    }
}
