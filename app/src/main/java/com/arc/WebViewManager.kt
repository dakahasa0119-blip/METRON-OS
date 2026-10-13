package com.arc

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.graphics.createBitmap
import kotlinx.coroutines.*
import java.net.URI
import java.util.TimeZone

/**
 * 隠密性(Stealth)と偵察知能(Recon)を極限まで高め、自己進化を支える最終執行クラス (v23.1 - Fully Polished)
 */
class WebViewManager(
    private val context: Context,
    private val prefs: Prefs,
    var onDomErrorCallback: (String, String?) -> Unit,
    var onAiResult: (String) -> Unit,
    var onAutoDom: (String) -> Unit,
    var onPicked: (String) -> Unit,
    var onPageFinished: () -> Unit,
    var onLoginBlocked: (String) -> Unit = {}
) {
    private data class StealthProfile(
        val ua: String,
        val platform: String,
        val language: String,
        val languages: String,
        val maxTouchPoints: Int,
        val hardwareConcurrency: Int,
        val deviceMemory: Int,
        val timezone: String
    )

    var webView: WebView? = null
        private set

    var onGenerationDone: (() -> Unit)? = null
    private var lastHeartbeat = 0L
    private var isMonitoringActive = true
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var isPatchTesting = false
    private var resultPollJob: Job? = null
    private var heartbeatMonitorJob: Job? = null
    private var lastInterstitialReportMs: Long = 0L
    private var lastBlockRecoverTryMs: Long = 0L
    private var lastHeartbeatLostReportMs: Long = 0L
    private var lastHeartbeatRecoveryTryMs: Long = 0L
    private var lastCopilotBypassMs: Long = 0L
    private var copilotChallengeCount: Int = 0

    private val defaultPcUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    private val defaultMobileUA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36"
    private var currentUA = prefs.pcUserAgent.ifBlank { defaultPcUA }
    @Volatile private var cachedUrl: String = ""
    @Volatile private var cachedTitle: String = ""

    fun createWebView(): WebView {
        val wv = WebView(context)
        webView = wv
        setupWebView(wv)
        return wv
    }

    /**
     * User-initiated selector picker. Never starts automatically.
     * The script attaches temporary capture listeners to the active page.
     */
    fun beginSelectorPicker(role: String) {
        if (role !in setOf("input", "send", "resp")) return
        val page = webView ?: return
        val source = try {
            context.assets.open("selector_picker.js").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            Log.e("ARC_PICKER", "Cannot load local picker asset", e)
            return
        }
        page.evaluateJavascript(source + "\nwindow.MetronSelectorPicker.start('" + role + "');", null)
    }

    /**
     * 自己進化パッチの検証と適用 (安全弁付き)
     */
    fun applyAndVerifyPatch(newJs: String) {
        isPatchTesting = true
        scope.launch {
            prefs.dynamicCoreJs = newJs
            webView?.reload()
            delay(15000)
            if (isPatchTesting) rollbackCoreJs()
        }
    }

    private fun rollbackCoreJs() {
        prefs.dynamicCoreJs = ""
        isPatchTesting = false
        onDomErrorCallback("EVOLUTION_FAILED: Heartbeat timeout", null)
        scope.launch { webView?.reload() }
    }

    private fun getCoreJs(): String {
        if (prefs.dynamicCoreJs.isNotEmpty()) return prefs.dynamicCoreJs
        return try {
            context.assets.open("arc_core.js").bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            ""
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(wv: WebView) {
        WebView.setWebContentsDebuggingEnabled(true)
        wv.setBackgroundColor(Color.BLACK)
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(wv, true)
        }
        wv.settings.apply { 
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = currentUA 
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            loadsImagesAutomatically = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportZoom(false)
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = false
            allowContentAccess = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = true
            }
        }
        
        wv.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                cachedUrl = url ?: ""
                if (shouldApplyStealth(url)) applyAntiBotScripts(view)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (url == null) return
                cachedUrl = url
                cachedTitle = view?.title ?: cachedTitle
                if (shouldBypassCopilotChallenge(url)) {
                    val now = System.currentTimeMillis()
                    copilotChallengeCount += 1
                    if (copilotChallengeCount >= 2) {
                        onDomErrorCallback("BOT_BLOCKED", "cloudflare_challenge_persistent")
                        return
                    }
                    if (now - lastCopilotBypassMs > 8_000L) {
                        lastCopilotBypassMs = now
                        onDomErrorCallback("BOT_BLOCKED", "challenge_url_detected")
                        val next = if (prefs.copilotUrl.contains("copilot.microsoft.com", ignoreCase = true)) {
                            prefs.copilotUrl
                        } else {
                            "https://copilot.microsoft.com/"
                        }
                        view?.post { view.loadUrl(next) }
                    }
                    return
                }
                copilotChallengeCount = 0
                if (isSensitiveAuthUrl(url)) {
                    detectLoginBlock(view, url)
                    return
                } else {
                detectAccessInterstitial(view) { blocked, detail ->
                    if (blocked) {
                            val now = System.currentTimeMillis()
                            if (now - lastInterstitialReportMs > 15_000L) {
                                lastInterstitialReportMs = now
                                onDomErrorCallback("PAGE_INTERSTITIAL_BLOCK", detail)
                            }
                            if (now - lastBlockRecoverTryMs > 3_000L) {
                                lastBlockRecoverTryMs = now
                                attemptUiUnblock()
                                scope.launch {
                                    delay(1200)
                                    detectAccessInterstitial(view) { stillBlocked, _ ->
                                        if (!stillBlocked) {
                                            finalizePageReady(view, url)
                                        }
                                    }
                                }
                            }
                            return@detectAccessInterstitial
                        }
                        finalizePageReady(view, url)
                    }
                }
            }
        }
        
        wv.addJavascriptInterface(JsBridge(
            { r -> onAiResult(r) }, 
            { t, d -> onDomErrorCallback(t, d) }, 
            { onAutoDom(it) }, 
            { 
                lastHeartbeat = System.currentTimeMillis()
                if (isPatchTesting) {
                    isPatchTesting = false
                    Log.d("ARC_EVOLUTION", "Verified.")
                }
            }, 
            { onPicked(it) }, { onGenerationDone?.invoke() }, { }
        ), "AndroidBridge")
    }

    private fun detectAccessInterstitial(view: WebView?, callback: (Boolean, String) -> Unit) {
        val js = """
            (function() {
              const remember = (mark) => {
                try {
                  window.__arcLastBotWallMark = String(mark || 'unknown');
                  window.__arcLastBotWallAt = Date.now();
                } catch (_) {}
              };
              const roots = [];
              const visitRoots = (root) => {
                if (!root || !root.querySelectorAll) return;
                roots.push(root);
                const all = root.querySelectorAll('*');
                for (const el of all) {
                  if (el && el.shadowRoot) visitRoots(el.shadowRoot);
                }
              };
              visitRoots(document);

              let mergedText = '';
              try {
                const bodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
                mergedText += bodyText + '\n';
              } catch (_) {}
              for (const r of roots) {
                try {
                  const t = (r && r.textContent) ? r.textContent : '';
                  if (t) mergedText += t + '\n';
                } catch (_) {}
              }
              const text = mergedText;
              const lower = mergedText.toLowerCase();
              const robotTextMarks = [
                'i am not a robot',
                'verify you are human',
                'verify you are not a robot',
                'human verification',
                'prove you are human',
                '私はロボットではありません',
                'ロボットではありません',
                '人間であることを確認'
              ];
              const challengeTextMarks = [
                'captcha',
                'recaptcha',
                'turnstile',
                'cloudflare challenge',
                'challenge.cloudflare.com'
              ];
              try {
                for (const r of roots) {
                  const iframe = r.querySelector(
                    'iframe[src*="challenge.cloudflare.com"],iframe[src*="challenges.cloudflare.com"],iframe[src*="recaptcha"],iframe[title*="captcha" i],iframe[title*="challenge" i],iframe[id*="cf-chl" i],iframe[name*="cf-chl" i]'
                  );
                  if (iframe) {
                    remember("iframe_challenge");
                    return JSON.stringify({ blocked: true, mark: 'iframe_challenge', source: 'scan' });
                  }
                }
              } catch (_) {}
              try {
                for (const r of roots) {
                  const cbs = r.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
                  for (const cb of cbs) {
                    const host = cb.closest && cb.closest('label,div,section,form');
                    const cbAria = ((cb.getAttribute && (cb.getAttribute('aria-label') || cb.getAttribute('title'))) || '').toLowerCase();
                    const near = ((host && (host.innerText || host.textContent)) ? (host.innerText || host.textContent) : '').toLowerCase();
                    if (
                      cbAria.indexOf('robot') >= 0 ||
                      cbAria.indexOf('captcha') >= 0 ||
                      cbAria.indexOf('human') >= 0 ||
                      near.indexOf('ロボット') >= 0 ||
                      near.indexOf('私はロボットではありません') >= 0 ||
                      near.indexOf('i am not a robot') >= 0 ||
                      near.indexOf('verify you are human') >= 0 ||
                      near.indexOf('captcha') >= 0
                    ) {
                      remember("robot_checkbox");
                      return JSON.stringify({ blocked: true, mark: 'robot_checkbox', source: 'scan' });
                    }
                  }
                }
              } catch (_) {}
              try {
                for (const r of roots) {
                  const widget = r.querySelector(
                    '[class*="captcha" i],[id*="captcha" i],[class*="turnstile" i],[id*="turnstile" i],[data-sitekey]'
                  );
                  if (widget) {
                    remember("captcha_widget");
                    return JSON.stringify({ blocked: true, mark: 'captcha_widget', source: 'scan' });
                  }
                }
              } catch (_) {}
              const hasRobotText = robotTextMarks.some((mark) =>
                lower.indexOf(mark.toLowerCase()) >= 0 || text.indexOf(mark) >= 0
              );
              const hasChallengeText = challengeTextMarks.some((mark) =>
                lower.indexOf(mark.toLowerCase()) >= 0 || text.indexOf(mark) >= 0
              );
              if (hasRobotText && hasChallengeText) {
                remember("text_challenge");
                return JSON.stringify({ blocked: true, mark: 'text_challenge', source: 'scan' });
              }
              return JSON.stringify({ blocked: false, mark: '' });
            })();
        """.trimIndent()
        view?.evaluateJavascript(js) { raw ->
            val parsed = (raw ?: "").trim().trim('"').replace("\\\"", "\"")
            val blocked = parsed.contains("\"blocked\":true")
            val mark = Regex("\"mark\":\"([^\"]*)\"").find(parsed)?.groupValues?.getOrNull(1) ?: ""
            callback(blocked, mark)
        } ?: callback(false, "")
    }

    fun detectBotWall(callback: (BotSignal) -> Unit) {
        detectAccessInterstitial(webView) { blocked, detail ->
            val raw = BotDetectionEngine.fromDomScan(
                blocked = blocked,
                mark = detail,
                url = currentUrl()
            )
            val t = prefs.getBotThresholds()
            callback(BotDetectionEngine.applyThresholds(raw, t.blocked, t.interstitial))
        }
    }

    fun detectGeminiError(callback: (BotSignal) -> Unit) {
        val js = """
            (function() {
              try {
                try {
                  const cachedMark = window.arc && window.arc.__lastGeminiErrorMark
                    ? String(window.arc.__lastGeminiErrorMark)
                    : '';
                  const cachedAt = window.arc && window.arc.__lastGeminiErrorAt
                    ? Number(window.arc.__lastGeminiErrorAt)
                    : 0;
                  const ageMs = Date.now() - cachedAt;
                  if (cachedMark && cachedAt > 0 && ageMs >= 0 && ageMs <= 45000) {
                    return JSON.stringify({ blocked: true, mark: cachedMark, source: 'cache' });
                  }
                } catch (_) {}
                const roots = [];
                const visitRoots = (root) => {
                  if (!root || !root.querySelectorAll) return;
                  roots.push(root);
                  const all = root.querySelectorAll('*');
                  for (const el of all) {
                    if (el && el.shadowRoot) visitRoots(el.shadowRoot);
                  }
                };
                visitRoots(document);

                let mergedText = '';
                try {
                  const bodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
                  mergedText += bodyText + '\n';
                } catch (_) {}
                for (const r of roots) {
                  try {
                    const t = (r && r.textContent) ? r.textContent : '';
                    if (t) mergedText += t + '\n';
                  } catch (_) {}
                }

                const text = mergedText || '';
                const lower = text.toLowerCase();
                const codeRegexes = [
                  /エラーが発生しました\s*[（(]\s*(\d+)\s*[)）]/,
                  /error\s*occurred\s*[（(]\s*(\d+)\s*[)）]/i
                ];
                for (let i = 0; i < codeRegexes.length; i++) {
                  const m = text.match(codeRegexes[i]) || lower.match(codeRegexes[i]);
                  if (m && m[1]) {
                    return JSON.stringify({ blocked: true, mark: 'code:' + String(m[1]), source: 'scan' });
                  }
                }
                const marks = [
                  'something went wrong',
                  'problem generating response',
                  'temporarily unavailable',
                  'network error'
                ];
                for (let i = 0; i < marks.length; i++) {
                  const m = marks[i];
                  if (text.indexOf(m) >= 0 || lower.indexOf(m.toLowerCase()) >= 0) {
                    return JSON.stringify({ blocked: true, mark: 'generic:' + m, source: 'scan' });
                  }
                }
                return JSON.stringify({ blocked: false, mark: '' });
              } catch (_) {
                return JSON.stringify({ blocked: false, mark: '' });
              }
            })();
        """.trimIndent()
        webView?.evaluateJavascript(js) { raw ->
            val parsed = (raw ?: "").trim().trim('"').replace("\\\"", "\"")
            val blocked = parsed.contains("\"blocked\":true")
            val mark = Regex("\"mark\":\"([^\"]*)\"").find(parsed)?.groupValues?.getOrNull(1) ?: ""
            val baseSignal = if (blocked) {
                BotDetectionEngine.fromError(
                    type = "GEMINI_MARKER",
                    data = mark,
                    url = currentUrl()
                )
            } else {
                BotSignal(
                    decision = BotDecision.CLEAR,
                    confidence = 0,
                    mark = "",
                    source = "gemini_scan"
                )
            }
            val t = prefs.getBotThresholds()
            callback(BotDetectionEngine.applyThresholds(baseSignal, t.blocked, t.interstitial))
        } ?: callback(
            BotSignal(
                decision = BotDecision.CLEAR,
                confidence = 0,
                mark = "",
                source = "gemini_scan"
            )
        )
    }

    fun detectProgressSignal(callback: (Boolean, Int, String) -> Unit) {
        val js = """
            (function() {
              try {
                const out = { generating: false, assistant_len: 0, marker: '' };
                const generating = !!document.querySelector(
                  '[aria-label*="停止" i], [aria-label*="Stop" i], button[data-testid*="stop" i], [data-is-streaming="true"], .result-streaming, .generating, [class*="stream" i], [class*="typing" i]'
                );
                out.generating = generating;

                const sels = [
                  '[data-message-author-role="assistant"]',
                  '[data-testid*="assistant" i]',
                  '[data-testid*="message" i]',
                  '.model-response-text',
                  '.markdown',
                  '.prose',
                  '[class*="claude" i]',
                  '[class*="assistant" i]',
                  'article'
                ];
                const nodes = [];
                const seen = new Set();
                sels.forEach((s) => {
                  document.querySelectorAll(s).forEach((el) => {
                    if (!el || seen.has(el)) return;
                    seen.add(el);
                    nodes.push(el);
                  });
                });
                for (let i = nodes.length - 1; i >= 0; i--) {
                  const node = nodes[i];
                  const selfRole = (node.getAttribute && node.getAttribute('data-message-author-role')) || '';
                  const parentRoleEl = node.closest && node.closest('[data-message-author-role]');
                  const parentRole = parentRoleEl ? (parentRoleEl.getAttribute('data-message-author-role') || '') : '';
                  const role = (selfRole || parentRole).toLowerCase();
                  if (role === 'user') continue;
                  const txt = ((node.innerText || node.textContent || '') + '').trim();
                  if (txt.length > 5) {
                    out.assistant_len = txt.length;
                    break;
                  }
                }

                try {
                  const mark = window.arc && window.arc.__lastGeminiErrorMark
                    ? String(window.arc.__lastGeminiErrorMark)
                    : '';
                  const at = window.arc && window.arc.__lastGeminiErrorAt
                    ? Number(window.arc.__lastGeminiErrorAt)
                    : 0;
                  if (mark && at > 0 && Date.now() - at <= 45000) out.marker = mark;
                } catch (_) {}

                return JSON.stringify(out);
              } catch (_) {
                return JSON.stringify({ generating: false, assistant_len: 0, marker: '' });
              }
            })();
        """.trimIndent()
        webView?.evaluateJavascript(js) { raw ->
            val parsed = (raw ?: "").trim().trim('"').replace("\\\"", "\"")
            val generating = parsed.contains("\"generating\":true")
            val len = Regex("\"assistant_len\":(\\d+)").find(parsed)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
            val marker = Regex("\"marker\":\"([^\"]*)\"").find(parsed)?.groupValues?.getOrNull(1) ?: ""
            callback(generating, len, marker)
        } ?: callback(false, 0, "")
    }

    /**
     * アクセシビリティ・ツリー抽出
     */
    fun capturePageSource(callback: (String) -> Unit) {
        scope.launch { 
            val js = """
                (function() {
                    const getAxeTree = () => {
                        let res = "";
                        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
                        let node; let count = 0;
                        while ((node = walker.nextNode()) && count < 100) {
                            const role = node.getAttribute('role') || node.tagName.toLowerCase();
                            const label = node.getAttribute('aria-label') || node.placeholder || node.innerText?.substring(0,20);
                            if (['button','input','textarea','link'].includes(role) || node.onclick) {
                                res += `[${'$'}role] ${'$'}label\n`; count++;
                            }
                        }
                        return res;
                    };
                    return "AXE_TREE:\n" + getAxeTree() + "\n\nRAW_HTML:\n" + document.documentElement.outerHTML.substring(0, 5000);
                })();
            """.trimIndent()
            webView?.evaluateJavascript(js) { html -> callback(html ?: "") }
        }
    }

    private fun finalizePageReady(view: WebView?, url: String) {
        view?.evaluateJavascript(getCoreJs(), null)
        if (shouldApplyStealth(url)) {
            applyAntiBotScripts(view)
            injectHumanNoise(view)
        }
        setMonitoring(true)
        scope.launch { delay(1500); injectAutoDom() }
        onPageFinished()
    }

    private fun detectLoginBlock(view: WebView?, url: String) {
        val js = """
            (function() {
              const body = (document.body && document.body.innerText) ? document.body.innerText : '';
              const hit =
                body.includes('このブラウザまたはアプリは安全でない可能性があります') ||
                body.toLowerCase().includes('this browser or app may not be secure') ||
                body.toLowerCase().includes('couldn\'t sign you in');
              return hit ? 'blocked' : 'ok';
            })();
        """.trimIndent()
        view?.evaluateJavascript(js) { raw ->
            val v = (raw ?: "").trim().trim('"')
            if (v == "blocked") onLoginBlocked(url)
        }
    }

    fun captureBitmap(callback: (Bitmap) -> Unit) {
        scope.launch {
            val wv = webView
            if (wv == null) {
                callback(createBitmap(1, 1))
                return@launch
            }

            val width = if (wv.width > 0) wv.width else 1
            val height = if (wv.height > 0) wv.height else 1
            val bmp = createBitmap(width, height)
            val canvas = Canvas(bmp)
            wv.draw(canvas)
            callback(bmp)
        }
    }

    fun refreshProcess() {
        scope.launch {
            webView?.let { wv ->
                // 旧実装はCookie全削除で全AIログアウトを誘発していたため停止
                // 必要最小限の再読み込みのみ行う
                wv.reload()
            }
        }
    }

    fun refreshKeepingSession() {
        scope.launch {
            webView?.let { wv ->
                // 認証セッションを維持したまま再読み込みする
                wv.reload()
            }
        }
    }

    fun applyPersona(target: AiTarget, reloadPage: Boolean = true) {
        val wv = webView ?: return
        scope.launch {
            currentUA = if (target == AiTarget.MOBILE_BROWSER || target == AiTarget.GEMINI) {
                prefs.mobileUserAgent.ifBlank { defaultMobileUA }
            } else {
                prefs.pcUserAgent.ifBlank { defaultPcUA }
            }
            wv.settings.userAgentString = currentUA
            if (shouldApplyStealth(wv.url)) applyAntiBotScripts(wv)
            if (reloadPage) {
                wv.reload()
            }
        }
    }

    fun rotateStealthPersona(targetHint: String = "") {
        val wv = webView ?: return
        scope.launch {
            val shouldUseMobile = targetHint.equals("mobile_browser", ignoreCase = true) ||
                targetHint.equals("gemini", ignoreCase = true) ||
                (!currentUA.contains("Mobile", ignoreCase = true) && !currentUA.contains("Android", ignoreCase = true))

            currentUA = if (shouldUseMobile) {
                prefs.mobileUserAgent.ifBlank { defaultMobileUA }
            } else {
                prefs.pcUserAgent.ifBlank { defaultPcUA }
            }
            wv.settings.userAgentString = currentUA
            if (shouldApplyStealth(wv.url)) {
                applyAntiBotScripts(wv)
                injectHumanNoise(wv)
            }
            wv.reload()
        }
    }

    fun currentUrl(): String = cachedUrl

    fun currentHost(): String {
        val raw = currentUrl()
        if (raw.isBlank()) return ""
        return try {
            URI(raw).host ?: ""
        } catch (_: Exception) {
            ""
        }
    }

    fun currentTitle(): String = cachedTitle

    /**
     * 特定の要素周辺の精密なHTML断片をJSから取得する
     */
    fun getPrecisionContext(selector: String, callback: (String) -> Unit) {
        scope.launch {
            webView?.evaluateJavascript("arc.getElementContext('$selector')") { html ->
                callback(html ?: "{}")
            }
        }
    }

    fun destroy() {
        setMonitoring(false)
        resultPollJob?.cancel()
        scope.cancel()
        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        webView = null
    }

    fun resumeRuntime() {
        val wv = webView ?: return
        wv.post {
            try {
                wv.onResume()
                wv.resumeTimers()
            } catch (_: Exception) {}
        }
    }

    fun injectPromptForcefully(inS: String, sendS: String, txt: String) { 
        val escapedText = Util.escapeJs(txt)
        val escapedInputSel = inS.replace("\\", "\\\\").replace("'", "\\'")
        val escapedSendSel = sendS.replace("\\", "\\\\").replace("'", "\\'")
        val responseSel = prefs.getResponseSelectorFor(webView?.url ?: "")
            .replace("\\", "\\\\").replace("'", "\\'")
        scope.launch {
            simulateHumanInteraction()
            val continueInjection = {
                // Cookie同意や利用許諾のオーバーレイを軽く除去してから入力送信
                webView?.evaluateJavascript(
                    """
                    (function(){
                      try {
                        const labels = ['accept all','accept','agree','allow all','すべて受け入れる','同意','許可'];
                        const nodes = Array.from(document.querySelectorAll('button,[role="button"]'));
                        for (const el of nodes) {
                          const t = (el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase();
                          if (!t) continue;
                          if (labels.some(k => t.includes(k)) && !el.disabled) { el.click(); }
                        }
                      } catch (_) {}
                    })();
                    """.trimIndent(), null
                )
                // 送信前の既存回答をベースラインとして保持し、古い回答の再投稿を防ぐ
                webView?.evaluateJavascript(
                    "(function(){ try { if (window.arc && arc.armResultBaseline) { arc.armResultBaseline('$responseSel'); } } catch(e){} })();",
                    null
                )
                webView?.evaluateJavascript(
                    "(function(){ const f=arc.performFill('$escapedInputSel','$escapedText'); if(f)setTimeout(()=>arc.performSend('$escapedSendSel'),700); })();",
                    null
                )
                startResultPolling()
            }
            // bot チャレンジ画面では送信を試みず、解除フェーズへ移行する
            webView?.evaluateJavascript(
                """
                (function(){
                  try{
                    const t=((document.body&&document.body.innerText)||'').toLowerCase();
                    const hasIframe = !!document.querySelector(
                      'iframe[src*="challenge.cloudflare.com" i],iframe[src*="recaptcha" i],iframe[title*="captcha" i],iframe[title*="challenge" i]'
                    );
                    const hasWidget = !!document.querySelector(
                      '[class*="captcha" i],[id*="captcha" i],[class*="turnstile" i],[id*="turnstile" i],[data-sitekey]'
                    );
                    const hasRobotCheckbox = Array.from(document.querySelectorAll('input[type="checkbox"],[role="checkbox"]')).some((cb) => {
                      const host = cb.closest && cb.closest('label,div,section,form');
                      const cbAria = ((cb.getAttribute && (cb.getAttribute('aria-label') || cb.getAttribute('title'))) || '').toLowerCase();
                      const near = ((host && (host.innerText || host.textContent)) ? (host.innerText || host.textContent) : '').toLowerCase();
                      return cbAria.includes('robot') || cbAria.includes('captcha') || cbAria.includes('human') ||
                        near.includes('ロボット') || near.includes('i am not a robot') || near.includes('verify you are human') || near.includes('captcha');
                    });
                    if (hasIframe) return 'iframe_challenge';
                    if (hasWidget) return 'captcha_widget';
                    if (hasRobotCheckbox) return 'robot_checkbox';
                    return 'ok';
                  }catch(_){ return 'ok'; }
                })();
                """.trimIndent()
            ) { raw ->
                val v = (raw ?: "").trim().trim('"').lowercase()
                if (v != "ok") {
                    attemptUiUnblock()
                    onDomErrorCallback("BOT_BLOCKED", v)
                    return@evaluateJavascript
                }
                continueInjection()
            } ?: continueInjection()
        }
    }

    fun attemptUiUnblock(onDone: (Boolean) -> Unit = {}) {
        val js = """
            (function() {
              try {
                const words = [
                  'accept all','accept','agree','allow all','continue','ok','got it',
                  'verify','verify you are human','i am not a robot','security check',
                  'すべて受け入れる','同意','許可','続行','閉じる','許諾','承諾',
                  'ロボットではありません','人間であることを確認','私はロボットではありません'
                ];
                const clickedSet = new Set();
                let clicked = false;

                const visitRoots = (root, out) => {
                  if (!root || !root.querySelectorAll) return;
                  out.push(root);
                  const all = root.querySelectorAll('*');
                  for (const el of all) {
                    if (el && el.shadowRoot) visitRoots(el.shadowRoot, out);
                  }
                };

                const roots = [];
                visitRoots(document, roots);

                const clickOnce = (el) => {
                  if (!el) return false;
                  if (clickedSet.has(el)) return false;
                  try {
                    if (el.disabled) return false;
                    el.click();
                    clickedSet.add(el);
                    return true;
                  } catch (_) { return false; }
                };

                for (const root of roots) {
                  const nodes = Array.from(root.querySelectorAll('button,[role="button"],[aria-label],label,input[type="checkbox"],[role="checkbox"]'));
                  for (const el of nodes) {
                    const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().toLowerCase();
                    const type = (el.getAttribute('type') || '').toLowerCase();
                    const isCheckbox = type === 'checkbox' || el.getAttribute('role') === 'checkbox';
                    if (isCheckbox) {
                      if (clickOnce(el)) clicked = true;
                      // チェックボックスに紐づくラベルも押しておく
                      try {
                        const id = el.getAttribute('id');
                        if (id) {
                          const lb = root.querySelector('label[for="' + id + '"]');
                          if (lb && clickOnce(lb)) clicked = true;
                        }
                        const parentLabel = el.closest && el.closest('label');
                        if (parentLabel && clickOnce(parentLabel)) clicked = true;
                      } catch (_) {}
                      continue;
                    }
                    if (!t) continue;
                    if (words.some(w => t.includes(w))) {
                      if (clickOnce(el)) clicked = true;
                    }
                  }
                }

                const bodyTxt = ((document.body && document.body.innerText) ? document.body.innerText : '').toLowerCase();
                const challengeVisible = [
                  'verify you are human',
                  'i am not a robot',
                  'security check',
                  'captcha',
                  'ロボットではありません',
                  '人間であることを確認'
                ].some(w => bodyTxt.includes(w));

                return JSON.stringify({ clicked: clicked, challenge: challengeVisible });
              } catch (_) {
                return JSON.stringify({ clicked: false, challenge: false });
              }
            })();
        """.trimIndent()
        webView?.evaluateJavascript(js) { raw ->
            val v = (raw ?: "").lowercase()
            val ok = v.contains("\"clicked\":true")
            onDone(ok)
        } ?: onDone(false)
    }

    private fun startResultPolling() {
        resultPollJob?.cancel()
        resultPollJob = scope.launch {
            repeat(24) {
                delay(2500)
                val wv = webView ?: return@launch
                val selector = prefs.getResponseSelectorFor(wv.url ?: "")
                val escaped = selector.replace("\\", "\\\\").replace("'", "\\'")
                wv.evaluateJavascript(
                    """
                    (function(){
                      try {
                        if (!(window.arc && arc.extractCleanResult)) {
                          return JSON.stringify({ ok:false, reason:'arc_missing' });
                        }
                        const txt = arc.extractCleanResult('$escaped') || '';
                        const pending = Number(arc.__pendingCount || 0);
                        const baselineLen = String(arc.__resultBaseline || '').length;
                        const lastLen = String(arc.__lastPostedResult || '').length;
                        return JSON.stringify({
                          ok:true,
                          len: txt.length,
                          pending: pending,
                          baseline_len: baselineLen,
                          last_len: lastLen
                        });
                      } catch(e) {
                        return JSON.stringify({ ok:false, reason:String((e && e.message) || e) });
                      }
                    })();
                    """.trimIndent()
                ) { raw ->
                    val parsed = (raw ?: "").trim().trim('"').replace("\\\"", "\"")
                    val ok = parsed.contains("\"ok\":true")
                    val len = Regex("\"len\":(\\d+)").find(parsed)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
                    val pending = Regex("\"pending\":(\\d+)").find(parsed)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
                    val baselineLen = Regex("\"baseline_len\":(\\d+)").find(parsed)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
                    val lastLen = Regex("\"last_len\":(\\d+)").find(parsed)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
                    if (!ok || len > 0 || pending > 0) {
                        Log.d(
                            "ARC_RESULT_POLL",
                            "ok=$ok len=$len pending=$pending baseline=$baselineLen last=$lastLen raw=${parsed.take(180)}"
                        )
                    }
                }
            }
        }
    }

    private fun simulateHumanInteraction() {
        webView?.evaluateJavascript("(function(){ window.scrollBy(0, Math.floor(Math.random()*20)-10); })();", null)
    }

    fun injectAutoDom() {
        scope.launch { webView?.evaluateJavascript(AutoDom.script(), null) }
    }

    fun setMonitoring(active: Boolean) {
        isMonitoringActive = active
        if (!active) {
            heartbeatMonitorJob?.cancel()
            heartbeatMonitorJob = null
            return
        }
        startHeartbeatMonitor()
    }

    private fun startHeartbeatMonitor() {
        heartbeatMonitorJob?.cancel()
        heartbeatMonitorJob = scope.launch {
            while(isMonitoringActive) {
                val u = (webView?.url ?: "").lowercase()
                val tickMs = if (u.contains("copilot.microsoft.com") || u.contains("bing.com/chat")) {
                    2_000L
                } else {
                    prefs.heartbeatIntervalMs.coerceIn(4_000L, 9_000L)
                }
                delay(tickMs)
                injectAutoDom()
                detectAccessInterstitial(webView) { blocked, detail ->
                    if (blocked) {
                        val raw = BotDetectionEngine.fromDomScan(
                            blocked = blocked,
                            mark = detail,
                            url = currentUrl()
                        )
                        val t = prefs.getBotThresholds()
                        val signal = BotDetectionEngine.applyThresholds(raw, t.blocked, t.interstitial)
                        if (signal.decision == BotDecision.BOT_BLOCKED) {
                            onDomErrorCallback("BOT_BLOCKED", signal.detailString())
                        } else if (signal.decision == BotDecision.INTERSTITIAL) {
                            onDomErrorCallback("PAGE_INTERSTITIAL_BLOCK", signal.detailString())
                        }
                    }
                }
                val currentUrl = webView?.url
                if (shouldApplyStealth(currentUrl)) {
                    applyAntiBotScripts(webView)
                    injectHumanNoise(webView)
                }
                if (lastHeartbeat > 0 && System.currentTimeMillis() - lastHeartbeat > 30000) {
                    val now = System.currentTimeMillis()
                    if (now - lastHeartbeatLostReportMs > 20_000L) {
                        onDomErrorCallback("heartbeat_lost", null)
                        lastHeartbeatLostReportMs = now
                    }
                    if (now - lastHeartbeatRecoveryTryMs > 30_000L) {
                        lastHeartbeatRecoveryTryMs = now
                        refreshKeepingSession()
                    }
                    lastHeartbeat = now
                }
            }
        }
    }

    private fun isSensitiveAuthUrl(url: String?): Boolean {
        val u = url?.lowercase() ?: return false
        return u.contains("accounts.google.com") ||
            u.contains("myaccount.google.com") ||
            u.contains("serviceLogin".lowercase()) ||
            u.contains("/signin") ||
            u.contains("/challenge") ||
            u.contains("recaptcha") ||
            u.contains("gstatic.com/recaptcha")
    }

    private fun shouldApplyStealth(url: String?): Boolean = !isSensitiveAuthUrl(url)

    private fun shouldBypassCopilotChallenge(url: String?): Boolean {
        val u = url?.lowercase() ?: return false
        val isCopilotSession = u.contains("copilot") || u.contains("bing.com/chat") || prefs.copilotUrl.contains("copilot", true)
        if (!isCopilotSession) return false
        return u.contains("challenge.cloudflare.com") || u.contains("/cdn-cgi/challenge-platform")
    }

    private fun buildStealthProfile(): StealthProfile {
        val mobile = currentUA.contains("Mobile", ignoreCase = true) || currentUA.contains("Android", ignoreCase = true)
        return StealthProfile(
            ua = currentUA,
            platform = if (mobile) "Linux armv8l" else "Linux x86_64",
            language = "ja-JP",
            languages = "['ja-JP','ja','en-US','en']",
            maxTouchPoints = if (mobile) 5 else 0,
            hardwareConcurrency = if (mobile) 8 else 12,
            deviceMemory = if (mobile) 8 else 16,
            timezone = TimeZone.getDefault().id
        )
    }

    private fun jsLiteral(v: String): String = v.replace("\\", "\\\\").replace("'", "\\'")

    private fun buildStealthScript(profile: StealthProfile): String {
        val ua = jsLiteral(profile.ua)
        val platform = jsLiteral(profile.platform)
        val lang = jsLiteral(profile.language)
        val tz = jsLiteral(profile.timezone)
        return """
            (function() {
              const define = (obj, key, value) => {
                try { Object.defineProperty(obj, key, { get: () => value, configurable: true }); } catch (_) {}
              };
              const navProto = Object.getPrototypeOf(navigator);
              define(navProto, 'webdriver', undefined);
              define(navProto, 'userAgent', '$ua');
              define(navProto, 'platform', '$platform');
              define(navProto, 'language', '$lang');
              define(navProto, 'languages', ${profile.languages});
              define(navProto, 'maxTouchPoints', ${profile.maxTouchPoints});
              define(navProto, 'hardwareConcurrency', ${profile.hardwareConcurrency});
              define(navProto, 'deviceMemory', ${profile.deviceMemory});
              define(navProto, 'vendor', 'Google Inc.');
              define(navProto, 'doNotTrack', '1');

              if (!window.chrome) window.chrome = {};
              window.chrome.runtime = window.chrome.runtime || {};
              window.chrome.app = window.chrome.app || {};
              window.chrome.csi = window.chrome.csi || function(){ return {}; };
              window.chrome.loadTimes = window.chrome.loadTimes || function(){ return {}; };

              const fakePlugins = [
                {name:'Chrome PDF Plugin', filename:'internal-pdf-viewer', description:'Portable Document Format'},
                {name:'Chrome PDF Viewer', filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai', description:''}
              ];
              define(navProto, 'plugins', fakePlugins);
              define(navProto, 'mimeTypes', [{type:'application/pdf', suffixes:'pdf', description:'Portable Document Format'}]);

              try {
                const originalQuery = navigator.permissions && navigator.permissions.query
                  ? navigator.permissions.query.bind(navigator.permissions)
                  : null;
                if (originalQuery) {
                  navigator.permissions.query = function(parameters) {
                    if (parameters && parameters.name === 'notifications') {
                      return Promise.resolve({ state: Notification.permission });
                    }
                    return originalQuery(parameters);
                  };
                }
              } catch (_) {}

              try {
                const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
                Intl.DateTimeFormat.prototype.resolvedOptions = function() {
                  const out = originalResolvedOptions.apply(this, arguments);
                  out.timeZone = '$tz';
                  return out;
                };
              } catch (_) {}

              try {
                const p = WebGLRenderingContext && WebGLRenderingContext.prototype;
                if (p && p.getParameter) {
                  const oldGetParameter = p.getParameter;
                  p.getParameter = function(param) {
                    if (param === 37445) return 'Intel Inc.';
                    if (param === 37446) return 'Intel Iris OpenGL Engine';
                    return oldGetParameter.apply(this, arguments);
                  };
                }
              } catch (_) {}

              try {
                const p2 = WebGL2RenderingContext && WebGL2RenderingContext.prototype;
                if (p2 && p2.getParameter) {
                  const oldGetParameter2 = p2.getParameter;
                  p2.getParameter = function(param) {
                    if (param === 37445) return 'Intel Inc.';
                    if (param === 37446) return 'Intel Iris OpenGL Engine';
                    return oldGetParameter2.apply(this, arguments);
                  };
                }
              } catch (_) {}
            })();
        """.trimIndent()
    }

    private fun applyAntiBotScripts(view: WebView?) {
        val js = buildStealthScript(buildStealthProfile())
        view?.evaluateJavascript(js, null)
    }

    private fun injectHumanNoise(view: WebView?) {
        val js = """
            (function() {
              try {
                const x = Math.floor(Math.random() * Math.max(40, window.innerWidth || 100));
                const y = Math.floor(Math.random() * Math.max(40, window.innerHeight || 100));
                const ev = new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y });
                document.dispatchEvent(ev);
                if (Math.random() > 0.5) window.scrollBy(0, Math.floor(Math.random() * 12) - 6);
              } catch (_) {}
            })();
        """.trimIndent()
        view?.evaluateJavascript(js, null)
    }
}
