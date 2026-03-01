package com.arc

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Arc v9.0 設定管理クラス (Self-Evolution Enabled)
 */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("arc_settings", Context.MODE_PRIVATE)
    private val copilotMigrationDoneKey = "copilot_slot_claude_migrated_v1"

    private fun edit(action: SharedPreferences.Editor.() -> Unit) {
        sp.edit().apply { action(); apply() }
    }

    var gasUrl: String by StringPref("gas_url", "")
    var sheetId: String by StringPref("sheet_id", "")
    var keepScreenAwake: Boolean by BoolPref("keep_screen_awake", false)
    var runtimeMode: String by StringPref("runtime_mode", RUNTIME_MODE_INTERACTIVE)
    var bringToFrontOnExecution: Boolean by BoolPref("bring_to_front_on_execution", false)
    var compactCornerMode: Boolean by BoolPref("compact_corner_mode", true)
    var minimizeGuardEnabled: Boolean by BoolPref("minimize_guard_enabled", true)
    var headlessMode: Boolean by BoolPref("headless_mode", true)
    var consultGatewayEnabled: Boolean by BoolPref("consult_gateway_enabled", false)
    var heartbeatIntervalMs: Long
        get() = sp.getLong("heartbeat_interval_ms", 15000L)
        set(v) { edit { putLong("heartbeat_interval_ms", v.coerceIn(5000L, 120000L)) } }

    /** ローカル HTTP API 用の認証トークン。初回アクセス時に自動生成 */
    var authToken: String
        get() {
            val stored = sp.getString("auth_token", "") ?: ""
            if (stored.isEmpty()) {
                val generated = java.util.UUID.randomUUID().toString()
                edit { putString("auth_token", generated) }
                return generated
            }
            return stored
        }
        set(v) { edit { putString("auth_token", v) } }

    /** ARCノード識別子。Gateway側の lease 対象識別に使用（Gatewayからの自動付与） */
    var workerId: String
        get() {
            return sp.getString("worker_id", "") ?: ""
        }
        set(v) { edit { putString("worker_id", v) } }

    // --- 🧬 拡張: 動的システムコード (Gatewayから更新可能) ---
    var dynamicCoreJs: String by StringPref("dynamic_core_js", "")

    // --- 🎭 偽装情報 ---
    var pcUserAgent: String by StringPref("pc_user_agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    var mobileUserAgent: String by StringPref("mobile_user_agent", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36")

    // --- 🔒 DOMロックスイッチ ---
    var isGeminiLocked: Boolean by BoolPref("is_gemini_locked", false)
    var isChatGptLocked: Boolean by BoolPref("is_gpt_locked", false)
    var isCopilotLocked: Boolean by BoolPref("is_copilot_locked", false)

    // --- 各AIのセレクタとURL ---
    var geminiInputSelector: String by StringPref("gemini_input", "div[contenteditable='true'][role='textbox']")
    var geminiSendSelector: String by StringPref("gemini_send", "button[aria-label*='送信']")
    var geminiResponseSelector: String by StringPref("gemini_resp", "article")
    var geminiUrl: String by StringPref("gemini_url", "https://gemini.google.com/")

    var chatGptInputSelector: String by StringPref(
        "chatgpt_input",
        "#prompt-textarea, textarea[placeholder*='Message'], textarea[data-id='root'], div[contenteditable='true'][role='textbox']"
    )
    var chatGptSendSelector: String by StringPref("chatgpt_send", "button[data-testid*='send']")
    var chatGptResponseSelector: String by StringPref("chatgpt_resp", "div[data-message-author-role='assistant']")
    var chatGptUrl: String by StringPref("chatgpt_url", "https://chatgpt.com/")

    var copilotInputSelector: String by StringPref("copilot_input", "div[contenteditable='true'][role='textbox'], div[contenteditable='true']")
    var copilotSendSelector: String by StringPref("copilot_send", "button[aria-label*='Send' i], button[data-testid*='send' i], button[type='submit']")
    var copilotResponseSelector: String by StringPref("copilot_resp", "div[data-testid*='assistant'], article, .prose")
    var copilotUrl: String by StringPref("copilot_url", "https://claude.ai/")
    var gatewaySlotRegistryJson: String by StringPref("gateway_slot_registry_json", "[]")

    fun normalizedRuntimeMode(): String {
        val m = runtimeMode.trim().lowercase()
        return when (m) {
            RUNTIME_MODE_AUTONOMOUS -> RUNTIME_MODE_AUTONOMOUS
            else -> RUNTIME_MODE_INTERACTIVE
        }
    }

    fun shouldForceForegroundForGatewayTask(): Boolean {
        return normalizedRuntimeMode() == RUNTIME_MODE_AUTONOMOUS || bringToFrontOnExecution
    }

    fun shouldKeepScreenAwakeNow(): Boolean {
        return keepScreenAwake || normalizedRuntimeMode() == RUNTIME_MODE_AUTONOMOUS
    }

    fun runStartupMigrations(): List<String> {
        val notes = mutableListOf<String>()
        if (migrateCopilotSlotToClaudeIfNeeded()) {
            notes += "copilot_slot_to_claude"
        }
        val rawRegistry = gatewaySlotRegistryJson.trim()
        if (rawRegistry.isBlank() || rawRegistry == "[]") {
            syncLegacyTargetsToSlotRegistry()
            notes += "slot_registry_seeded_from_legacy"
        }
        applySlotRegistryToLegacyTargets()
        return notes
    }

    fun getUrlFor(target: String): String = when (target.lowercase()) {
        "gemini" -> geminiUrl
        "chatgpt" -> chatGptUrl
        "copilot" -> normalizeCopilotUrl(copilotUrl)
        "full_browser", "mobile_browser" -> "https://bot.sannysoft.com/"
        else -> geminiUrl
    }

    fun resolveTargetForSlot(slotId: String?, fallbackTarget: String = ""): String {
        val sid = normalizeSlotId(slotId)
        val fallback = normalizeTarget(fallbackTarget)
        if (sid.isBlank()) return fallback.ifBlank { "gemini" }
        if (sid == "chatgpt" || sid == "gemini" || sid == "copilot" || sid == "claude") {
            return normalizeTarget(sid).ifBlank { fallback.ifBlank { "gemini" } }
        }
        return try {
            val arr = JSONArray(gatewaySlotRegistryJson)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val id = normalizeSlotId(obj.optString("slot_id", ""))
                if (id != sid) continue
                val t = normalizeTarget(obj.optString("target", ""))
                if (t.isNotBlank()) return t
            }
            fallback.ifBlank { "gemini" }
        } catch (_: Exception) {
            fallback.ifBlank { "gemini" }
        }
    }

    fun upsertGatewaySlotBinding(slotId: String?, target: String?, enabled: Boolean? = null) {
        upsertGatewaySlotBinding(slotId, target, enabled, null, null, null, null)
    }

    fun upsertGatewaySlotBinding(
        slotId: String?,
        target: String?,
        enabled: Boolean? = null,
        url: String? = null,
        inputSelector: String? = null,
        sendSelector: String? = null,
        responseSelector: String? = null
    ) {
        val sid = normalizeSlotId(slotId)
        val t = normalizeTarget(target)
        if (sid.isBlank() || t.isBlank()) return
        try {
            val arr = JSONArray(gatewaySlotRegistryJson)
            var idx = -1
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                if (normalizeSlotId(obj.optString("slot_id", "")) == sid) {
                    idx = i
                    break
                }
            }
            val next = if (idx >= 0) arr.optJSONObject(idx) ?: JSONObject() else JSONObject()
            next.put("slot_id", sid)
            next.put("target", t)
            if (enabled != null) next.put("enabled", enabled)
            if (!url.isNullOrBlank()) next.put("url", url.take(400))
            if (!inputSelector.isNullOrBlank()) next.put("input_selector", inputSelector.take(240))
            if (!sendSelector.isNullOrBlank()) next.put("send_selector", sendSelector.take(240))
            if (!responseSelector.isNullOrBlank()) next.put("response_selector", responseSelector.take(240))
            if (idx >= 0) arr.put(idx, next) else arr.put(next)
            gatewaySlotRegistryJson = arr.toString()
        } catch (_: Exception) {
            gatewaySlotRegistryJson = JSONArray().put(
                JSONObject().apply {
                    put("slot_id", sid)
                    put("target", t)
                    if (enabled != null) put("enabled", enabled)
                    if (!url.isNullOrBlank()) put("url", url.take(400))
                    if (!inputSelector.isNullOrBlank()) put("input_selector", inputSelector.take(240))
                    if (!sendSelector.isNullOrBlank()) put("send_selector", sendSelector.take(240))
                    if (!responseSelector.isNullOrBlank()) put("response_selector", responseSelector.take(240))
                }
            ).toString()
        }
    }

    fun resolveUrlForSlot(slotId: String?, fallbackTarget: String): String {
        val sid = normalizeSlotId(slotId)
        val target = resolveTargetForSlot(sid, fallbackTarget)
        if (sid.isBlank()) return getUrlFor(target)
        return try {
            val arr = JSONArray(gatewaySlotRegistryJson)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                if (normalizeSlotId(obj.optString("slot_id", "")) != sid) continue
                val customUrl = obj.optString("url", "").trim()
                if (customUrl.isNotBlank()) return customUrl
                break
            }
            getUrlFor(target)
        } catch (_: Exception) {
            getUrlFor(target)
        }
    }

    fun resolveSelectorsForSlot(slotId: String?, fallbackTarget: String): Pair<String, String> {
        val sid = normalizeSlotId(slotId)
        val target = resolveTargetForSlot(sid, fallbackTarget)
        val defaultPair = getSelectorsFor(target)
        if (sid.isBlank()) return defaultPair
        return try {
            val arr = JSONArray(gatewaySlotRegistryJson)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                if (normalizeSlotId(obj.optString("slot_id", "")) != sid) continue
                val input = obj.optString("input_selector", "").trim()
                val send = obj.optString("send_selector", "").trim()
                return (if (input.isNotBlank()) input else defaultPair.first) to
                    (if (send.isNotBlank()) send else defaultPair.second)
            }
            defaultPair
        } catch (_: Exception) {
            defaultPair
        }
    }

    fun syncLegacyTargetsToSlotRegistry() {
        upsertGatewaySlotBinding(
            slotId = "chatgpt",
            target = "chatgpt",
            url = chatGptUrl,
            inputSelector = chatGptInputSelector,
            sendSelector = chatGptSendSelector,
            responseSelector = chatGptResponseSelector
        )
        upsertGatewaySlotBinding(
            slotId = "gemini",
            target = "gemini",
            url = geminiUrl,
            inputSelector = geminiInputSelector,
            sendSelector = geminiSendSelector,
            responseSelector = geminiResponseSelector
        )
        upsertGatewaySlotBinding(
            slotId = "claude",
            target = "copilot",
            url = copilotUrl,
            inputSelector = copilotInputSelector,
            sendSelector = copilotSendSelector,
            responseSelector = copilotResponseSelector
        )
    }

    fun applySlotRegistryToLegacyTargets() {
        try {
            val arr = JSONArray(gatewaySlotRegistryJson)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val sid = normalizeSlotId(obj.optString("slot_id", ""))
                when (sid) {
                    "chatgpt" -> {
                        val u = obj.optString("url", "").trim()
                        val input = obj.optString("input_selector", "").trim()
                        val send = obj.optString("send_selector", "").trim()
                        val resp = obj.optString("response_selector", "").trim()
                        if (u.isNotBlank()) chatGptUrl = u
                        if (input.isNotBlank()) chatGptInputSelector = input
                        if (send.isNotBlank()) chatGptSendSelector = send
                        if (resp.isNotBlank()) chatGptResponseSelector = resp
                    }
                    "gemini" -> {
                        val u = obj.optString("url", "").trim()
                        val input = obj.optString("input_selector", "").trim()
                        val send = obj.optString("send_selector", "").trim()
                        val resp = obj.optString("response_selector", "").trim()
                        if (u.isNotBlank()) geminiUrl = u
                        if (input.isNotBlank()) geminiInputSelector = input
                        if (send.isNotBlank()) geminiSendSelector = send
                        if (resp.isNotBlank()) geminiResponseSelector = resp
                    }
                    "copilot", "claude" -> {
                        val u = obj.optString("url", "").trim()
                        val input = obj.optString("input_selector", "").trim()
                        val send = obj.optString("send_selector", "").trim()
                        val resp = obj.optString("response_selector", "").trim()
                        if (u.isNotBlank()) copilotUrl = u
                        if (input.isNotBlank()) copilotInputSelector = input
                        if (send.isNotBlank()) copilotSendSelector = send
                        if (resp.isNotBlank()) copilotResponseSelector = resp
                    }
                }
            }
        } catch (_: Exception) {
        }
    }

    private fun normalizeSlotId(raw: String?): String {
        val n = raw.orEmpty()
            .trim()
            .lowercase()
            .replace(Regex("[^a-z0-9_-]"), "")
            .take(40)
        return if (n == "copilot") "claude" else n
    }

    private fun normalizeTarget(raw: String?): String {
        return when (raw.orEmpty().trim().lowercase()) {
            "claude" -> "copilot"
            "chatgpt", "gemini", "copilot" -> raw.orEmpty().trim().lowercase().let { if (it == "claude") "copilot" else it }
            else -> ""
        }
    }

    private fun normalizeCopilotUrl(raw: String): String {
        val u = raw.trim()
        if (u.isBlank()) return "https://claude.ai/"
        val lower = u.lowercase()
        if (lower.contains("claude.ai")) return "https://claude.ai/"
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) return "https://claude.ai/"
        return u
    }

    private fun migrateCopilotSlotToClaudeIfNeeded(): Boolean {
        val alreadyDone = sp.getBoolean(copilotMigrationDoneKey, false)
        val url = (sp.getString("copilot_url", "") ?: "").trim()
        val input = (sp.getString("copilot_input", "") ?: "").trim()
        val send = (sp.getString("copilot_send", "") ?: "").trim()
        val resp = (sp.getString("copilot_resp", "") ?: "").trim()

        if (alreadyDone) return false

        val urlLower = url.lowercase()
        val legacyUrl = urlLower.contains("bing.com/chat") ||
            urlLower.contains("copilot.microsoft.com") ||
            urlLower.contains("microsoft+copilot")
        val legacyInput = input.equals("#userInput", ignoreCase = true) ||
            input.equals("cib-text-input > #searchbox", ignoreCase = true)
        val legacySend = send.equals("button[name=\"intent\"]", ignoreCase = true) ||
            send.equals("#send-button", ignoreCase = true)
        val legacyResp = resp.equals("article.article.page.no-article-survey", ignoreCase = true) ||
            resp.equals("cib-message-group.response-message-group", ignoreCase = true)
        val shouldMigrate = url.isBlank() || legacyUrl || legacyInput || legacySend || legacyResp

        if (!shouldMigrate) {
            // 既に手動で新しい値に更新済みなら、以後の自動上書きを避ける。
            if (urlLower.contains("claude.ai")) {
                edit { putBoolean(copilotMigrationDoneKey, true) }
            }
            return false
        }

        edit {
            putString("copilot_url", "https://claude.ai/")
            putString("copilot_input", "div[contenteditable='true'][role='textbox'], div[contenteditable='true']")
            putString("copilot_send", "button[aria-label*='Send' i], button[data-testid*='send' i], button[type='submit']")
            putString("copilot_resp", "div[data-testid*='assistant'], article, .prose")
            putBoolean(copilotMigrationDoneKey, true)
        }
        return true
    }

    fun getSelectorsFor(target: String): Pair<String, String> = when (target.lowercase()) {
        "gemini" -> geminiInputSelector to geminiSendSelector
        "chatgpt" -> chatGptInputSelector to chatGptSendSelector
        "copilot" -> copilotInputSelector to copilotSendSelector
        else -> "" to ""
    }

    fun updateSelectorFor(target: String, newSelector: String) {
        if (newSelector.isBlank() || newSelector.length < 2) return
        when (target.lowercase()) {
            "gemini" -> if (!isGeminiLocked) geminiResponseSelector = newSelector
            "chatgpt" -> if (!isChatGptLocked) chatGptResponseSelector = newSelector
            "copilot" -> if (!isCopilotLocked) copilotResponseSelector = newSelector
        }
    }

    fun getResponseSelectorFor(currentUrl: String): String {
        return when {
            currentUrl.contains("gemini") -> sanitizeResponseSelector("gemini", geminiResponseSelector)
            currentUrl.contains("chatgpt") -> sanitizeResponseSelector("chatgpt", chatGptResponseSelector)
            currentUrl.contains("bing") || currentUrl.contains("copilot") || currentUrl.contains("claude.ai") -> sanitizeResponseSelector("copilot", copilotResponseSelector)
            else -> "article, [data-message-author-role='assistant'], .markdown, .model-response-text"
        }
    }

    private fun sanitizeResponseSelector(target: String, raw: String): String {
        val sel = raw.trim()
        val fallback = when (target) {
            "chatgpt" -> "[data-message-author-role='assistant'], article, .markdown"
            "gemini" -> "article, .markdown, [data-message-author-role='assistant']"
            "copilot" -> "div[data-testid*='assistant'], article, .prose"
            else -> "article, [data-message-author-role='assistant'], .markdown, .model-response-text"
        }
        if (sel.isBlank()) return fallback

        // 固定ターンや過度に脆いクラス指定は実運用で壊れやすいため回避する
        val lowerSel = sel.lowercase()
        if (lowerSel.contains("conversation-turn-1")) return fallback
        if (target == "gemini" && lowerSel.contains("markdown-main-panel")) return fallback
        if (sel.length > 160) return fallback
        return sel
    }

    // --- 🧠 現場記憶 ---
    var contextHistory: String by StringPref("context_history", "[]")
    var summarizedContext: String by StringPref("summarized_context", "")
    var timingHistory: String by StringPref("timing_history", "[]")
    var botThresholdsJson: String by StringPref("bot_thresholds_json", "")

    data class TimingStats(
        val avgMs: Long,
        val p90Ms: Long,
        val stdMs: Long,
        val samples: Int,
        val latestTs: Long
    )

    data class BotThresholds(
        val blocked: Int = 60,
        val interstitial: Int = 24,
        val updatedAt: Long = 0L
    )

    fun getBotThresholds(): BotThresholds {
        return try {
            val raw = botThresholdsJson.trim()
            if (raw.isBlank()) return BotThresholds()
            val obj = JSONObject(raw)
            val blocked = obj.optInt("blocked", 60).coerceIn(40, 90)
            val interstitial = obj.optInt("interstitial", 24).coerceIn(10, 55)
            val adjustedInterstitial = interstitial.coerceAtMost((blocked - 5).coerceAtLeast(10))
            BotThresholds(
                blocked = blocked,
                interstitial = adjustedInterstitial,
                updatedAt = obj.optLong("updated_at", 0L)
            )
        } catch (_: Exception) {
            BotThresholds()
        }
    }

    fun adjustBotThresholds(
        deltaBlocked: Int = 0,
        deltaInterstitial: Int = 0
    ): BotThresholds {
        val cur = getBotThresholds()
        val blocked = (cur.blocked + deltaBlocked).coerceIn(40, 90)
        val interstitial = (cur.interstitial + deltaInterstitial)
            .coerceIn(10, 55)
            .coerceAtMost((blocked - 5).coerceAtLeast(10))
        val next = BotThresholds(
            blocked = blocked,
            interstitial = interstitial,
            updatedAt = System.currentTimeMillis()
        )
        botThresholdsJson = JSONObject().apply {
            put("blocked", next.blocked)
            put("interstitial", next.interstitial)
            put("updated_at", next.updatedAt)
        }.toString()
        return next
    }

    fun addTimingSample(
        key: String,
        elapsedMs: Long,
        success: Boolean,
        errorType: String = "",
        maxItems: Int = 320
    ) {
        if (key.isBlank() || elapsedMs <= 0L) return
        try {
            val list = JSONArray(timingHistory)
            val now = System.currentTimeMillis()
            val item = JSONObject().apply {
                put("k", key.take(80))
                put("elapsed_ms", elapsedMs.coerceIn(200L, 600_000L))
                put("success", success)
                put("ts", now)
                if (errorType.isNotBlank()) put("error_type", errorType.take(80))
            }
            list.put(item)
            val start = (list.length() - maxItems.coerceAtLeast(80)).coerceAtLeast(0)
            val trimmed = JSONArray()
            for (i in start until list.length()) trimmed.put(list.get(i))
            timingHistory = trimmed.toString()
        } catch (_: Exception) { }
    }

    fun getTimingStats(
        key: String,
        lookbackMs: Long = 24 * 60 * 60_000L,
        minSamples: Int = 3,
        successOnly: Boolean = true
    ): TimingStats? {
        if (key.isBlank()) return null
        return try {
            val list = JSONArray(timingHistory)
            if (list.length() == 0) return null
            val now = System.currentTimeMillis()
            val samples = mutableListOf<Long>()
            var latestTs = 0L
            for (i in 0 until list.length()) {
                val it = list.optJSONObject(i) ?: continue
                if (it.optString("k", "") != key) continue
                if (successOnly && !it.optBoolean("success", false)) continue
                val ts = it.optLong("ts", 0L)
                if (ts <= 0L || now - ts > lookbackMs) continue
                val elapsed = it.optLong("elapsed_ms", 0L)
                if (elapsed <= 0L) continue
                samples += elapsed
                if (ts > latestTs) latestTs = ts
            }
            if (samples.size < minSamples) return null
            samples.sort()
            val avg = samples.sum().toDouble() / samples.size.toDouble()
            val p90Index = ((samples.size - 1) * 0.90).toInt().coerceIn(0, samples.lastIndex)
            val p90 = samples[p90Index].toDouble()
            val variance = samples
                .map { (it.toDouble() - avg) * (it.toDouble() - avg) }
                .sum() / samples.size.toDouble()
            val std = kotlin.math.sqrt(variance)
            TimingStats(
                avgMs = avg.toLong().coerceAtLeast(1L),
                p90Ms = p90.toLong().coerceAtLeast(1L),
                stdMs = std.toLong().coerceAtLeast(0L),
                samples = samples.size,
                latestTs = latestTs
            )
        } catch (_: Exception) {
            null
        }
    }

    fun addContext(
        q: String,
        a: String,
        isSuccess: Boolean = true,
        target: String = "",
        sessionId: String = ""
    ) {
        try {
            val list = JSONArray(contextHistory)
            val now = System.currentTimeMillis()
            val qNorm = q.trim()
            val aNorm = a.trim().take(10000)
            if (qNorm.isBlank() && aNorm.isBlank()) return

            // 連続同一の重複記録を抑止する
            val recentWindowMs = 120_000L
            val recentStart = (list.length() - 8).coerceAtLeast(0)
            for (i in recentStart until list.length()) {
                val it = list.optJSONObject(i) ?: continue
                val ts = it.optLong("ts", 0L)
                if (ts <= 0L || now - ts > recentWindowMs) continue
                val qOld = it.optString("q", "").trim()
                val aOld = it.optString("a", "").trim()
                if (qOld == qNorm && aOld == aNorm) return
            }

            // 同一セッションで同種失敗が連発するケースは1件に圧縮し repeat_count を増やす
            if (!isSuccess && sessionId.isNotBlank()) {
                val signature = extractFailureSignature(aNorm)
                if (signature.isNotBlank()) {
                    val mergeWindowMs = 15 * 60_000L
                    val scanStart = (list.length() - 20).coerceAtLeast(0)
                    for (i in list.length() - 1 downTo scanStart) {
                        val it = list.optJSONObject(i) ?: continue
                        if (it.optString("type", "") != "FAILURE") continue
                        if (it.optString("session_id", "") != sessionId) continue
                        val ts = it.optLong("ts", 0L)
                        if (ts <= 0L || now - ts > mergeWindowMs) continue
                        val oldSig = extractFailureSignature(it.optString("a", ""))
                        if (oldSig != signature) continue
                        it.put("a", aNorm)
                        it.put("ts", now)
                        it.put("last_ts", now)
                        val prevCount = it.optInt("repeat_count", 1).coerceAtLeast(1)
                        it.put("repeat_count", prevCount + 1)
                        contextHistory = list.toString()
                        return
                    }
                }
            }

            val item = JSONObject().apply {
                put("q", qNorm)
                put("a", aNorm)
                put("ts", now)
                put("type", if (isSuccess) "SUCCESS" else "FAILURE")
                put("repeat_count", 1)
                put("first_ts", now)
                put("last_ts", now)
                if (target.isNotBlank()) put("target", target.lowercase())
                if (sessionId.isNotBlank()) put("session_id", sessionId)
            }
            list.put(item)
            val limit = 80
            val start = if (list.length() > limit) list.length() - limit else 0
            val newList = JSONArray()
            for (i in start until list.length()) newList.put(list.get(i))
            contextHistory = newList.toString()
            compactContextHistory(limit)
        } catch (_: Exception) { }
    }

    fun clearContext() { contextHistory = "[]"; summarizedContext = "" }

    fun getFormattedContext(includeFailures: Boolean = true, maxSuccess: Int = 5): String {
        return getContextForPrompt(
            prompt = "",
            includeFailures = includeFailures,
            maxItems = maxSuccess + if (includeFailures) 2 else 0,
            maxChars = 1200
        )
    }

    fun getContextForPrompt(
        prompt: String,
        includeFailures: Boolean = true,
        maxItems: Int = 6,
        maxChars: Int = 1400
    ): String {
        if (summarizedContext.isNotEmpty()) return "\n【現場の記憶 (要約)】\n$summarizedContext\n"
        return try {
            val list = JSONArray(contextHistory)
            if (list.length() == 0) return ""
            val now = System.currentTimeMillis()
            val promptTokens = tokenize(prompt)

            data class Ranked(
                val score: Double,
                val ts: Long,
                val type: String,
                val q: String,
                val a: String,
                val target: String,
                val repeatCount: Int
            )
            val ranked = mutableListOf<Ranked>()

            for (i in 0 until list.length()) {
                val item = list.optJSONObject(i) ?: continue
                val type = item.optString("type", "SUCCESS")
                if (!includeFailures && type == "FAILURE") continue
                val q = item.optString("q", "")
                val a = item.optString("a", "")
                if (q.isBlank() && a.isBlank()) continue
                val ts = item.optLong("ts", 0L)
                val ageMs = if (ts > 0L) (now - ts).coerceAtLeast(0L) else Long.MAX_VALUE
                val recency = when {
                    ageMs <= 60_000L -> 4.0
                    ageMs <= 5 * 60_000L -> 3.0
                    ageMs <= 30 * 60_000L -> 2.0
                    ageMs <= 6 * 60 * 60_000L -> 1.0
                    else -> 0.3
                }
                val itemTokens = tokenize("$q $a")
                val overlap = if (promptTokens.isEmpty() || itemTokens.isEmpty()) 0.0
                else promptTokens.intersect(itemTokens).size.toDouble()
                val typeBonus = if (type == "SUCCESS") 0.6 else -0.2
                val score = overlap * 2.2 + recency + typeBonus
                ranked.add(
                    Ranked(
                        score = score,
                        ts = ts,
                        type = type,
                        q = q,
                        a = a,
                        target = item.optString("target", ""),
                        repeatCount = item.optInt("repeat_count", 1).coerceAtLeast(1)
                    )
                )
            }

            val sorted = ranked
                .sortedWith(compareByDescending<Ranked> { it.score }.thenByDescending { it.ts })
                .take(maxItems.coerceAtLeast(1))

            if (sorted.isEmpty()) return ""
            val sb = StringBuilder("\n【現場の短期記憶（関連順）】\n")
            var used = sb.length
            for (r in sorted) {
                val prefix = if (r.type == "FAILURE") "⚠️" else "•"
                val targetPart = if (r.target.isNotBlank()) " [${r.target}]" else ""
                val lineQ = "${prefix}${targetPart} Q: ${r.q.take(120)}\n"
                val repeatPart = if (r.type == "FAILURE" && r.repeatCount > 1) " (x${r.repeatCount})" else ""
                val lineA = "A: ${r.a.take(360)}$repeatPart\n"
                val block = lineQ + lineA + "---\n"
                if (used + block.length > maxChars.coerceAtLeast(400)) break
                sb.append(block)
                used += block.length
            }
            sb.toString()
        } catch (_: Exception) { "" }
    }

    private fun extractFailureSignature(text: String): String {
        val m = Regex("""ERROR:\s*([A-Z0-9_:-]+)""").find(text)
        return m?.groupValues?.getOrNull(1)?.trim()?.uppercase() ?: ""
    }

    fun compactContextHistory(maxItems: Int = 80) {
        try {
            val src = JSONArray(contextHistory)
            if (src.length() <= 1) return

            val merged = JSONArray()
            val failureIndexByKey = mutableMapOf<String, Int>()
            val mergeWindowMs = 15 * 60_000L

            fun putNormalized(dst: JSONObject, q: String, a: String, ts: Long, type: String, target: String, sessionId: String, repeat: Int, firstTs: Long, lastTs: Long) {
                dst.put("q", q)
                dst.put("a", a)
                dst.put("ts", ts)
                dst.put("type", type)
                dst.put("repeat_count", repeat.coerceAtLeast(1))
                dst.put("first_ts", if (firstTs > 0L) firstTs else ts)
                dst.put("last_ts", if (lastTs > 0L) lastTs else ts)
                if (target.isNotBlank()) dst.put("target", target)
                if (sessionId.isNotBlank()) dst.put("session_id", sessionId)
            }

            for (i in 0 until src.length()) {
                val it = src.optJSONObject(i) ?: continue
                val q = it.optString("q", "").trim()
                val a = it.optString("a", "").trim().take(10000)
                val ts = it.optLong("ts", 0L).takeIf { v -> v > 0L } ?: System.currentTimeMillis()
                val type = it.optString("type", "SUCCESS").ifBlank { "SUCCESS" }
                val target = it.optString("target", "").lowercase().trim()
                val sessionId = it.optString("session_id", "").trim()
                val repeat = it.optInt("repeat_count", 1).coerceAtLeast(1)
                val firstTs = it.optLong("first_ts", ts)
                val lastTs = it.optLong("last_ts", ts)
                if (q.isBlank() && a.isBlank()) continue

                if (type == "FAILURE" && sessionId.isNotBlank()) {
                    val sig = extractFailureSignature(a)
                    if (sig.isNotBlank()) {
                        val key = "$sessionId|$sig"
                        val oldIdx = failureIndexByKey[key]
                        if (oldIdx != null && oldIdx >= 0 && oldIdx < merged.length()) {
                            val prev = merged.optJSONObject(oldIdx)
                            if (prev != null) {
                                val prevLastTs = prev.optLong("last_ts", prev.optLong("ts", 0L))
                                if (prevLastTs > 0L && (ts - prevLastTs) in 0..mergeWindowMs) {
                                    val newRepeat = prev.optInt("repeat_count", 1).coerceAtLeast(1) + repeat
                                    prev.put("a", a)
                                    prev.put("ts", ts)
                                    prev.put("last_ts", maxOf(prevLastTs, lastTs, ts))
                                    prev.put("first_ts", minOf(prev.optLong("first_ts", ts), firstTs))
                                    prev.put("repeat_count", newRepeat)
                                    if (target.isNotBlank()) prev.put("target", target)
                                    continue
                                }
                            }
                        }
                        val dst = JSONObject()
                        putNormalized(dst, q, a, ts, type, target, sessionId, repeat, firstTs, lastTs)
                        merged.put(dst)
                        failureIndexByKey[key] = merged.length() - 1
                        continue
                    }
                }

                val dst = JSONObject()
                putNormalized(dst, q, a, ts, type, target, sessionId, repeat, firstTs, lastTs)
                merged.put(dst)
            }

            val keep = JSONArray()
            val start = (merged.length() - maxItems.coerceAtLeast(20)).coerceAtLeast(0)
            for (i in start until merged.length()) keep.put(merged.get(i))
            contextHistory = keep.toString()
        } catch (_: Exception) { }
    }

    private fun tokenize(text: String): Set<String> {
        val normalized = text.lowercase()
            .replace(Regex("https?://\\S+"), " ")
            .replace(Regex("[^\\p{L}\\p{N}_]+"), " ")
            .trim()
        if (normalized.isBlank()) return emptySet()
        val stop = setOf("the", "and", "for", "with", "that", "this", "from", "only", "into", "を", "に", "は", "が", "と", "で", "の")
        return normalized
            .split(Regex("\\s+"))
            .asSequence()
            .map { it.trim() }
            .filter { it.length >= 2 && it !in stop }
            .take(64)
            .toSet()
    }

    // --- プロフィール設定 ---
    var selectedSlotIndex: Int
        get() = sp.getInt("selected_slot_index", 0)
        set(v) { edit { putInt("selected_slot_index", v) } }
    var profileSlot1: String by StringPref("profile_slot_1", DEFAULT_JSON)
    var profileSlot2: String by StringPref("profile_slot_2", DEFAULT_JSON)
    var profileSlot3: String by StringPref("profile_slot_3", DEFAULT_JSON)
    var allAiMode: String by StringPref("all_ai_mode", "summary")
    var summaryPrompt: String by StringPref("summary_prompt", "")
    var hallucinationTolerance: String by StringPref("hallucination_tolerance", "normal")
    var allAiDelayMs: Long
        get() = sp.getLong("all_ai_delay", 1500)
        set(v) { edit { putLong("all_ai_delay", v) } }

    fun applyProfile() {
        val json = when (selectedSlotIndex) { 0 -> profileSlot1; 1 -> profileSlot2; else -> profileSlot3 }
        try { 
            val obj = JSONObject(json)
            allAiMode = obj.optString("all_ai_mode", "summary")
            summaryPrompt = obj.optString("summary_prompt", "")
            hallucinationTolerance = obj.optString("hallucination_tolerance", "normal")
            allAiDelayMs = obj.optLong("all_ai_delay_ms", 1500) 
        } catch (_: Exception) { }
    }

    private inner class StringPref(val key: String, val def: String) {
        operator fun getValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>): String = sp.getString(key, def) ?: def
        operator fun setValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>, value: String) { edit { putString(key, value) } }
    }
    private inner class BoolPref(val key: String, val def: Boolean) {
        operator fun getValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>): Boolean = sp.getBoolean(key, def)
        operator fun setValue(thisRef: Any?, property: kotlin.reflect.KProperty<*>, value: Boolean) { edit { putBoolean(key, value) } }
    }
    companion object {
        const val RUNTIME_MODE_INTERACTIVE = "interactive"
        const val RUNTIME_MODE_AUTONOMOUS = "autonomous"
        const val DEFAULT_JSON = """{"all_ai_mode":"summary","summary_prompt":"統合して：\n\n{CONTENT}","hallucination_tolerance":"normal","all_ai_delay_ms":1500}"""
    }
}
