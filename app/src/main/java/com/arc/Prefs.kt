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

    private fun edit(action: SharedPreferences.Editor.() -> Unit) {
        sp.edit().apply { action(); apply() }
    }

    var gasUrl: String by StringPref("gas_url", "")
    var sheetId: String by StringPref("sheet_id", "")
    var keepScreenAwake: Boolean by BoolPref("keep_screen_awake", false)
    var heartbeatIntervalMs: Long
        get() = sp.getLong("heartbeat_interval_ms", 180000L)
        set(v) { edit { putLong("heartbeat_interval_ms", v.coerceAtLeast(60000L)) } }

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

    /** ARCノード識別子。Gateway側の lease 対象識別に使用 */
    var workerId: String
        get() {
            val stored = sp.getString("worker_id", "") ?: ""
            if (stored.isEmpty()) {
                val generated = "arc-" + java.util.UUID.randomUUID().toString().replace("-", "").take(12)
                edit { putString("worker_id", generated) }
                return generated
            }
            return stored
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

    var chatGptInputSelector: String by StringPref("chatgpt_input", "#prompt-textarea")
    var chatGptSendSelector: String by StringPref("chatgpt_send", "button[data-testid*='send']")
    var chatGptResponseSelector: String by StringPref("chatgpt_resp", "div[data-message-author-role='assistant']")
    var chatGptUrl: String by StringPref("chatgpt_url", "https://chatgpt.com/")

    var copilotInputSelector: String by StringPref("copilot_input", "cib-text-input > #searchbox")
    var copilotSendSelector: String by StringPref("copilot_send", "#send-button")
    var copilotResponseSelector: String by StringPref("copilot_resp", "cib-message-group.response-message-group")
    var copilotUrl: String by StringPref("copilot_url", "https://www.bing.com/chat?q=Microsoft+Copilot&FORM=hpcodp")

    fun getUrlFor(target: String): String = when (target.lowercase()) {
        "gemini" -> geminiUrl
        "chatgpt" -> chatGptUrl
        "copilot" -> copilotUrl
        "full_browser", "mobile_browser" -> "https://bot.sannysoft.com/"
        else -> geminiUrl
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
            currentUrl.contains("gemini") -> geminiResponseSelector
            currentUrl.contains("chatgpt") -> chatGptResponseSelector
            currentUrl.contains("bing") || currentUrl.contains("copilot") -> copilotResponseSelector
            else -> "article"
        }
    }

    // --- 🧠 現場記憶 ---
    var contextHistory: String by StringPref("context_history", "[]")
    var summarizedContext: String by StringPref("summarized_context", "")

    fun addContext(q: String, a: String, isSuccess: Boolean = true) {
        try {
            val list = JSONArray(contextHistory)
            val item = JSONObject().apply {
                put("q", q); put("a", a.take(10000)); put("ts", System.currentTimeMillis())
                put("type", if (isSuccess) "SUCCESS" else "FAILURE")
            }
            list.put(item)
            val limit = 30
            val start = if (list.length() > limit) list.length() - limit else 0
            val newList = JSONArray()
            for (i in start until list.length()) newList.put(list.get(i))
            contextHistory = newList.toString()
        } catch (_: Exception) { }
    }

    fun clearContext() { contextHistory = "[]"; summarizedContext = "" }

    fun getFormattedContext(): String {
        if (summarizedContext.isNotEmpty()) return "\n【現場の記憶 (要約)】\n$summarizedContext\n"
        return try {
            val list = JSONArray(contextHistory)
            if (list.length() == 0) return ""
            val sb = StringBuilder("\n【現場の短期記憶（直近の経緯）】\n")
            val total = list.length()
            for (i in 0 until total) {
                val item = list.getJSONObject(i)
                val type = item.optString("type", "SUCCESS")
                val q = item.getString("q"); val a = item.getString("a")
                if (type == "FAILURE") sb.append("⚠️ 失敗の記録: $q -> $a\n")
                else if (total - i <= 5) sb.append("Q: ${q.take(100)}\nA: ${a.take(300)}\n---\n")
            }
            sb.toString()
        } catch (_: Exception) { "" }
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
        const val DEFAULT_JSON = """{"all_ai_mode":"summary","summary_prompt":"統合して：\n\n{CONTENT}","hallucination_tolerance":"normal","all_ai_delay_ms":1500}"""
    }
}
