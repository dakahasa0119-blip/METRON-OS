package com.arc

import org.json.JSONObject

enum class BotDecision {
    CLEAR,
    INTERSTITIAL,
    BOT_BLOCKED
}

enum class RecoveryAction {
    RETRY,
    CLICK_UNBLOCK,
    REFRESH,
    WAIT,
    ESCALATE
}

data class RecoveryDecision(
    val action: RecoveryAction,
    val note: String = "",
    val signal: BotSignal? = null
)

data class BotSignal(
    val decision: BotDecision,
    val confidence: Int,
    val mark: String = "",
    val evidences: List<String> = emptyList(),
    val source: String = "unknown"
) {
    fun detailString(): String {
        val ev = if (evidences.isEmpty()) "" else evidences.joinToString(",")
        return "decision=${decision.name};confidence=$confidence;mark=$mark;source=$source;evidence=$ev"
    }
}

object BotDetectionEngine {
    private val geminiGenericStrongTokens = setOf(
        "network error",
        "temporarily unavailable",
        "problem generating response",
        "something went wrong"
    )

    private val hardMarks = setOf(
        "iframe_challenge",
        "robot_checkbox",
        "captcha_widget",
        "text_challenge",
        "challenge_url_detected",
        "cloudflare_challenge_persistent"
    )

    private val hardTokens = setOf(
        "captcha",
        "recaptcha",
        "turnstile",
        "cloudflare",
        "challenge.cloudflare.com",
        "i am not a robot",
        "verify you are human",
        "verify you are not a robot",
        "human verification",
        "私はロボットではありません",
        "ロボットではありません"
    )

    private val softTokens = setOf(
        "interstitial",
        "blocked",
        "verify",
        "challenge",
        "security"
    )

    private val allTokensRegex = Regex(
        (hardMarks + hardTokens + softTokens).joinToString("|") { Regex.escape(it) }
    )

    fun fromDomScan(blocked: Boolean, mark: String?, url: String? = null): BotSignal {
        if (!blocked) return BotSignal(decision = BotDecision.CLEAR, confidence = 0, mark = "none", source = "dom")
        return classify(detail = mark.orEmpty(), type = "DOM_SCAN", url = url, source = "dom")
    }

    fun fromError(type: String?, data: String?, url: String? = null): BotSignal {
        val merged = buildString {
            if (!type.isNullOrBlank()) append(type).append(' ')
            if (!data.isNullOrBlank()) append(data)
        }.trim()
        return classify(detail = merged, type = type.orEmpty(), url = url, source = "error")
    }

    fun applyThresholds(
        signal: BotSignal,
        blockedThreshold: Int = 60,
        interstitialThreshold: Int = 24
    ): BotSignal {
        val blocked = blockedThreshold.coerceIn(40, 90)
        val interstitial = interstitialThreshold.coerceIn(10, (blocked - 5).coerceAtLeast(10))
        val decision = when {
            signal.confidence >= blocked -> BotDecision.BOT_BLOCKED
            signal.confidence >= interstitial -> BotDecision.INTERSTITIAL
            else -> BotDecision.CLEAR
        }
        return signal.copy(decision = decision)
    }

    fun classifyGeminiErrorType(marker: String?): String? {
        val m = marker?.trim().orEmpty()
        if (m.isBlank()) return null
        val lower = m.lowercase()
        val codeMatch = Regex("""(?:code[:_]|gemini_fail_)(\d+)""", RegexOption.IGNORE_CASE)
            .find(lower)
            ?.groupValues
            ?.getOrNull(1)
            ?.trim()
        if (!codeMatch.isNullOrBlank()) return "GEMINI_FAIL_$codeMatch"
        if (lower.startsWith("generic:")) {
            val payload = lower.removePrefix("generic:").trim()
            if (geminiGenericStrongTokens.any { payload.contains(it) }) {
                return "GEMINI_FAIL_GENERIC"
            }
            return null
        }
        return null
    }

    fun isLoginRequiredUrl(target: String, url: String?): Boolean {
        val u = url?.lowercase()?.trim().orEmpty()
        if (u.isBlank()) return false
        return when (target.lowercase()) {
            "gemini" ->
                u.contains("accounts.google.com") ||
                    u.contains("myaccount.google.com") ||
                    u.contains("servicelogin")
            "chatgpt" ->
                u.contains("auth.openai.com") ||
                    u.contains("chatgpt.com/auth")
            "copilot" ->
                u.contains("claude.ai/login") && !u.contains("app-google-auth")
            else -> false
        }
    }

    fun decideRecoveryAction(
        advice: String,
        url: String? = null,
        blockedThreshold: Int = 60,
        interstitialThreshold: Int = 24
    ): RecoveryDecision {
        val raw = advice.trim()
        if (raw.isBlank()) return RecoveryDecision(RecoveryAction.RETRY, note = "empty_advice")

        try {
            val obj = JSONObject(raw)
            val action = normalizeAction(obj.optString("action", ""))
            if (action != null) {
                return RecoveryDecision(
                    action = action,
                    note = obj.optString("note", "json").ifBlank { "json" }
                )
            }
        } catch (_: Exception) { }

        val botSignal = applyThresholds(
            signal = fromError(type = "ARC_SCREEN_DECISION", data = raw, url = url),
            blockedThreshold = blockedThreshold,
            interstitialThreshold = interstitialThreshold
        )
        if (botSignal.decision == BotDecision.BOT_BLOCKED) {
            return RecoveryDecision(
                action = RecoveryAction.ESCALATE,
                note = "blocked:${botSignal.mark.take(36)}",
                signal = botSignal
            )
        }

        val lower = raw.lowercase()
        return when {
            lower.contains("cookie") || lower.contains("consent") || lower.contains("同意") ->
                RecoveryDecision(RecoveryAction.CLICK_UNBLOCK, note = "consent")
            lower.contains("refresh") || lower.contains("reload") || lower.contains("再読み込み") ->
                RecoveryDecision(RecoveryAction.REFRESH, note = "refresh")
            lower.contains("switch") && (lower.contains("gemini") || lower.contains("chatgpt") || lower.contains("copilot")) ->
                RecoveryDecision(RecoveryAction.RETRY, note = "target_switch_blocked")
            lower.contains("login") || lower.contains("認証") ->
                RecoveryDecision(RecoveryAction.ESCALATE, note = "blocked")
            lower.contains("wait") || lower.contains("待機") ->
                RecoveryDecision(RecoveryAction.WAIT, note = "wait")
            else ->
                RecoveryDecision(RecoveryAction.RETRY, note = "fallback")
        }
    }

    private fun normalizeAction(raw: String): RecoveryAction? {
        return when (raw.trim().uppercase()) {
            "RETRY" -> RecoveryAction.RETRY
            "CLICK_UNBLOCK" -> RecoveryAction.CLICK_UNBLOCK
            "REFRESH" -> RecoveryAction.REFRESH
            "WAIT" -> RecoveryAction.WAIT
            "ESCALATE" -> RecoveryAction.ESCALATE
            else -> null
        }
    }

    private fun classify(detail: String, type: String, url: String?, source: String): BotSignal {
        val normalized = detail.lowercase()
        val evidences = mutableListOf<String>()
        var score = 0

        if (allTokensRegex.containsMatchIn(normalized)) {
            for (mark in hardMarks) {
                if (normalized.contains(mark)) {
                    evidences += "hard_mark:$mark"
                    score += 60
                }
            }
            for (token in hardTokens) {
                if (normalized.contains(token)) {
                    evidences += "hard_token:$token"
                    score += 25
                }
            }
            for (token in softTokens) {
                if (normalized.contains(token)) {
                    evidences += "soft_token:$token"
                    score += 8
                }
            }
        }

        val u = url?.lowercase().orEmpty()
        if (u.contains("challenge.cloudflare.com") || u.contains("/cdn-cgi/challenge-platform")) {
            evidences += "url:challenge"
            score += 35
        }

        val confidence = score.coerceAtMost(100)
        val decision = when {
            confidence >= 60 -> BotDecision.BOT_BLOCKED
            confidence >= 24 -> BotDecision.INTERSTITIAL
            else -> BotDecision.CLEAR
        }
        val mark = if (detail.isNotBlank()) detail.take(160) else type.take(160)
        return BotSignal(decision = decision, confidence = confidence, mark = mark, evidences = evidences.distinct(), source = source)
    }
}
