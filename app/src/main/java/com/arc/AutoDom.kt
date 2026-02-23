package com.arc

import org.json.JSONObject
import android.util.Log

/**
 * サイトのDOM構造とメタ情報を解析し、自律的な意志決定を支援する (v8.6 - Meta Enabled)
 */
object AutoDom {
    private const val DEBOUNCE_THRESHOLD = 2
    private const val DEBOUNCE_TTL_MS = 120_000L
    private data class SelectorCandidate(val value: String, val hits: Int, val ts: Long)
    private val candidateCache = mutableMapOf<String, SelectorCandidate>()

    private fun isStableSelector(selector: String): Boolean {
        if (selector.isBlank() || selector == "null") return false
        if (selector.length < 2 || selector.length > 180) return false
        val lowered = selector.lowercase()
        if (lowered == "html" || lowered == "body") return false
        if (selector.contains("\n")) return false
        if (!Regex("""^[a-zA-Z0-9#.\[\]_\-="'*:() >+~,$]+$""").matches(selector)) return false
        return true
    }

    private fun shouldCommit(target: AiTarget, field: String, selector: String): Boolean {
        val now = System.currentTimeMillis()
        val key = "${target.name}:$field"
        synchronized(candidateCache) {
            val prev = candidateCache[key]
            if (prev == null || prev.value != selector || now - prev.ts > DEBOUNCE_TTL_MS) {
                candidateCache[key] = SelectorCandidate(selector, 1, now)
                return false
            }
            val nextHits = prev.hits + 1
            candidateCache[key] = SelectorCandidate(selector, nextHits, now)
            if (nextHits >= DEBOUNCE_THRESHOLD) {
                candidateCache.remove(key)
                return true
            }
            return false
        }
    }

    private fun resolveTarget(obj: JSONObject, fallback: AiTarget): AiTarget {
        val meta = obj.optJSONObject("meta")
        val engine = meta?.optString("engine", "")?.lowercase().orEmpty()
        val url = meta?.optString("url", "")?.lowercase().orEmpty()
        return when {
            engine.contains("gemini") || url.contains("gemini.google") -> AiTarget.GEMINI
            engine.contains("chatgpt") || url.contains("chatgpt.com") -> AiTarget.CHATGPT
            engine.contains("copilot") || url.contains("copilot") || url.contains("bing.com/chat") -> AiTarget.COPILOT
            else -> fallback
        }
    }

    fun handleAutoDomJson(json: String, currentTarget: AiTarget, prefs: Prefs) {
        try {
            val obj = JSONObject(json)
            val mode = obj.optString("mode", "analysis")
            val resolvedTarget = resolveTarget(obj, currentTarget)

            // 🧠 自己学習モード (Visionフィードバック)
            if (mode == "learned") {
                val type = obj.optString("type")
                val selector = obj.optString("selector")
                if (selector.isNotEmpty()) {
                    Log.d("ARC_LEARNING", "Learned new selector for $type: $selector")
                    saveLearnedSelector(type, selector, resolvedTarget, prefs)
                }
                return
            }

            // 🏷️ メタ情報とUIマップの統合処理
            if (obj.has("meta")) {
                obj.getJSONObject("meta")
                // 必要に応じてステータスを外部(MainActivity等)へ通知するロジックをここに追加可能
            }

            // セレクタの自動保存ロジック (既存機能の維持)
            val selectors = obj.optJSONObject("selectors") ?: return
            
            fun safeSet(isLocked: Boolean, field: String, setter: (String) -> Unit, value: String) {
                if (!isLocked && isStableSelector(value) && shouldCommit(resolvedTarget, field, value)) {
                    setter(value)
                }
            }

            val inputSel = selectors.optString("input", "")
            val sendSel = selectors.optString("send", "")
            val respSel = selectors.optString("resp", "")

            when (resolvedTarget) {
                AiTarget.GEMINI -> {
                    safeSet(prefs.isGeminiLocked, "input", { prefs.geminiInputSelector = it }, inputSel)
                    safeSet(prefs.isGeminiLocked, "send", { prefs.geminiSendSelector = it }, sendSel)
                    safeSet(prefs.isGeminiLocked, "resp", { prefs.geminiResponseSelector = it }, respSel)
                }
                AiTarget.CHATGPT -> {
                    safeSet(prefs.isChatGptLocked, "input", { prefs.chatGptInputSelector = it }, inputSel)
                    safeSet(prefs.isChatGptLocked, "send", { prefs.chatGptSendSelector = it }, sendSel)
                    safeSet(prefs.isChatGptLocked, "resp", { prefs.chatGptResponseSelector = it }, respSel)
                }
                AiTarget.COPILOT -> {
                    safeSet(prefs.isCopilotLocked, "input", { prefs.copilotInputSelector = it }, inputSel)
                    safeSet(prefs.isCopilotLocked, "send", { prefs.copilotSendSelector = it }, sendSel)
                    safeSet(prefs.isCopilotLocked, "resp", { prefs.copilotResponseSelector = it }, respSel)
                }
                else -> {}
            }

        } catch (e: Exception) {
            Log.e("ARC_AutoDom", "v8.6 Parse Error", e)
        }
    }

    private fun saveLearnedSelector(type: String, selector: String, target: AiTarget, prefs: Prefs) {
        if (!isStableSelector(selector)) return
        when (target) {
            AiTarget.GEMINI -> {
                if ((type == "input_field" || type == "vision_fix") && !prefs.isGeminiLocked) prefs.geminiInputSelector = selector
                if (type == "send_button" && !prefs.isGeminiLocked) prefs.geminiSendSelector = selector
            }
            AiTarget.CHATGPT -> {
                if ((type == "input_field" || type == "vision_fix") && !prefs.isChatGptLocked) prefs.chatGptInputSelector = selector
                if (type == "send_button" && !prefs.isChatGptLocked) prefs.chatGptSendSelector = selector
            }
            AiTarget.COPILOT -> {
                if ((type == "input_field" || type == "vision_fix") && !prefs.isCopilotLocked) prefs.copilotInputSelector = selector
                if (type == "send_button" && !prefs.isCopilotLocked) prefs.copilotSendSelector = selector
            }
            else -> {}
        }
    }

    /**
     * 🚀 [知能強化] メタ情報とUI構造を統合して取得する最新スクリプト
     */
    fun script(): String = """
        (function() {
            try {
                if (typeof arc === 'undefined' || typeof arc.getAutoDomData !== 'function') {
                    return;
                }
                
                // 1. 最新の知能エンジン(arc_core.js)からデータを統合取得
                const data = arc.getAutoDomData();
                
                // 2. 既存のセレクタ抽出ロジック(AutoDom固有)も併用
                const inputQueries = ['div[contenteditable="true"][role="textbox"]', '#prompt-textarea', 'textarea', '#searchbox', '[role="textbox"]'];
                const sendQueries = ['button[aria-label*="送信"]', 'button[aria-label*="Send"]', 'button[data-testid*="send"]', 'button[type="submit"]', '[aria-label*="Send message"]'];
                const respQueries = ['article', '[data-message-author-role="assistant"]', '.markdown', '.model-response-text'];

                const find = (qs) => {
                    for (let q of qs) {
                        const el = arc.deepQuerySelector(document, q);
                        if (el) return el;
                    }
                    return null;
                };

                const inputEl = find(inputQueries);
                const sendEl = find(sendQueries);
                const respEl = find(respQueries);

                // 3. データをマージしてAndroid側へ送信
                const result = {
                    mode: "analysis",
                    ts: Date.now(),
                    ...data,
                    selectors: {
                        input: inputEl ? arc.buildStableSelector(inputEl) : "",
                        send: sendEl ? arc.buildStableSelector(sendEl) : "",
                        resp: respEl ? arc.buildStableSelector(respEl) : ""
                    }
                };

                if (window.AndroidBridge && AndroidBridge.autoDom) {
                    AndroidBridge.autoDom(JSON.stringify(result));
                    AndroidBridge.heartbeat();
                }
            } catch (e) {
                if (window.AndroidBridge && AndroidBridge.domError) {
                    AndroidBridge.domError("AutoDom Meta Error: " + e.message);
                }
            }
        })();
    """.trimIndent()
}
