package com.arc

import android.util.Log
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * WebView内の診断信号を収集し、Gatewayへ診断スナップショットとして送信する。
 * CAPTCHA回避ではなく、差分診断用の証跡収集のみを目的とする。
 */
class WebViewDiagnosticProbe(
    private val web: WebViewManager,
    private val gateway: GatewayClient,
    private val prefs: Prefs,
    private val scope: CoroutineScope
) {
    fun captureAndSend(reason: String = "manual", callback: (Boolean, String) -> Unit = { _, _ -> }) {
        scope.launch {
            try {
                val wv = web.webView
                if (wv == null) {
                    withContext(Dispatchers.Main) { callback(false, "webview_unavailable") }
                    return@launch
                }
                val payload = collectDiagnosticPayload(wv, reason)
                gateway.sendCopilotDiagnosticSnapshot(payload) { ok, traceId ->
                    callback(ok, traceId)
                }
            } catch (e: Exception) {
                Log.w("ARC_DIAG", "captureAndSend failed: ${e.message}")
                withContext(Dispatchers.Main) { callback(false, "exception") }
            }
        }
    }

    private suspend fun collectDiagnosticPayload(wv: WebView, reason: String): JSONObject {
        val js = """
            (function() {
              function safe(fn, fallback){ try { return fn(); } catch(_) { return fallback; } }
              var canvasData = safe(function(){
                var c = document.createElement('canvas');
                var ctx = c.getContext('2d');
                ctx.textBaseline = 'top';
                ctx.font = "14px Arial";
                ctx.fillText("arc-diagnostic", 2, 2);
                return c.toDataURL();
              }, "");
              var webgl = safe(function(){
                var c = document.createElement('canvas');
                var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
                if (!gl) return { vendor: "", renderer: "" };
                var dbg = gl.getExtension('WEBGL_debug_renderer_info');
                return {
                  vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "") : "",
                  renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : ""
                };
              }, { vendor: "", renderer: "" });

              var marks = [
                '私はロボットではありません',
                'i am not a robot',
                'verify you are human',
                'just a moment',
                'cloudflare',
                'challenge',
                'security check',
                'captcha',
                'turnstile'
              ];
              var bodyText = safe(function(){ return (document.body && document.body.innerText) ? document.body.innerText : ''; }, '');
              var lower = String(bodyText || '').toLowerCase();
              var hit = '';
              for (var i = 0; i < marks.length; i++) {
                var m = String(marks[i] || '');
                if (!m) continue;
                if (lower.indexOf(m.toLowerCase()) >= 0) {
                  hit = m;
                  break;
                }
              }
              var challengeDetected = !!hit || safe(function(){
                return !!document.querySelector('iframe[src*="challenge" i],iframe[src*="captcha" i],iframe[title*="captcha" i],input[type="checkbox"]');
              }, false);

              var out = {
                href: safe(function(){ return location.href; }, ''),
                title: safe(function(){ return document.title; }, ''),
                navigator: {
                  webdriver: safe(function(){ return navigator.webdriver; }, null),
                  userAgent: safe(function(){ return navigator.userAgent; }, ''),
                  platform: safe(function(){ return navigator.platform; }, ''),
                  languages: safe(function(){ return navigator.languages || []; }, []),
                  hardwareConcurrency: safe(function(){ return navigator.hardwareConcurrency; }, null)
                },
                webgl: webgl,
                canvas_data_url: String(canvasData || ''),
                local_storage: safe(function(){ return !!window.localStorage; }, false),
                session_storage: safe(function(){ return !!window.sessionStorage; }, false),
                indexed_db: safe(function(){ return !!window.indexedDB; }, false),
                service_worker: safe(function(){ return !!navigator.serviceWorker; }, false),
                cookie_enabled: safe(function(){ return !!navigator.cookieEnabled; }, false),
                challenge: {
                  detected: challengeDetected,
                  text: hit || ''
                }
              };
              return JSON.stringify(out);
            })();
        """.trimIndent()

        val raw = evalJs(wv, js)
        val core = parseJsJsonString(raw)

        val nav = core.optJSONObject("navigator") ?: JSONObject()
        val webgl = core.optJSONObject("webgl") ?: JSONObject()
        val challenge = core.optJSONObject("challenge") ?: JSONObject()

        val langs = nav.optJSONArray("languages") ?: JSONArray()
        val headers = JSONObject().apply {
            put("accept-language", langs.toString())
        }

        val canvasHash = sha256Hex(core.optString("canvas_data_url", ""))
        val note = buildString {
            append(reason)
            append(" / arc=")
            append(ArcCore.VERSION)
        }

        return JSONObject().apply {
            put("worker_id", prefs.workerId)
            put("target", "copilot")
            put("page_url", core.optString("href", web.currentUrl()))
            put("page_title", core.optString("title", web.currentTitle()))
            put("navigator", JSONObject().apply {
                put("webdriver", nav.opt("webdriver"))
                put("userAgent", nav.optString("userAgent", ""))
                put("platform", nav.optString("platform", ""))
                put("languages", langs)
                put("hardwareConcurrency", nav.opt("hardwareConcurrency"))
            })
            put("webgl", JSONObject().apply {
                put("vendor", webgl.optString("vendor", ""))
                put("renderer", webgl.optString("renderer", ""))
            })
            put("canvas_hash", canvasHash)
            put("local_storage", core.optBoolean("local_storage", false))
            put("session_storage", core.optBoolean("session_storage", false))
            put("indexed_db", core.optBoolean("indexed_db", false))
            put("service_worker", core.optBoolean("service_worker", false))
            put("cookie_enabled", core.optBoolean("cookie_enabled", false))
            put("headers", headers)
            put("challenge", JSONObject().apply {
                put("detected", challenge.optBoolean("detected", false))
                put("text", challenge.optString("text", ""))
            })
            put("note", note.take(1000))
        }
    }

    private fun sha256Hex(text: String): String {
        if (text.isBlank()) return ""
        val md = MessageDigest.getInstance("SHA-256")
        val dig = md.digest(text.toByteArray(Charsets.UTF_8))
        return dig.joinToString("") { "%02x".format(it) }
    }

    private suspend fun evalJs(wv: WebView, js: String): String = withContext(Dispatchers.Main) {
        suspendCoroutine { cont ->
            try {
                wv.evaluateJavascript(js) { result ->
                    cont.resume(result ?: "")
                }
            } catch (_: Exception) {
                cont.resume("")
            }
        }
    }

    private fun parseJsJsonString(raw: String): JSONObject {
        if (raw.isBlank() || raw == "null") return JSONObject()
        return try {
            val decoded = JSONObject("{\"v\":$raw}").optString("v", "")
            if (decoded.isBlank()) JSONObject() else JSONObject(decoded)
        } catch (_: Exception) {
            JSONObject().apply { put("raw", raw.take(800)) }
        }
    }
}
