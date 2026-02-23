package com.arc

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.graphics.createBitmap
import kotlinx.coroutines.*

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
    var onPageFinished: () -> Unit
) {

    var webView: WebView? = null
        private set

    var onGenerationDone: (() -> Unit)? = null
    private var lastHeartbeat = 0L
    private var isMonitoringActive = true
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var isPatchTesting = false

    private val defaultPcUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    private val defaultMobileUA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36"
    private var currentUA = prefs.pcUserAgent.ifBlank { defaultPcUA }

    fun createWebView(): WebView {
        val wv = WebView(context)
        webView = wv
        setupWebView(wv)
        return wv
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
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        wv.settings.apply { 
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = currentUA 
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            allowFileAccess = false
        }
        
        wv.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                applyAntiBotScripts(view)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (url == null) return
                if (!url.contains("accounts.google.com")) {
                    view?.evaluateJavascript(getCoreJs(), null)
                    applyAntiBotScripts(view)
                    setMonitoring(true)
                    scope.launch { delay(1500); injectAutoDom() }
                    onPageFinished()
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
                wv.clearCache(true)
                wv.clearFormData()
                wv.clearHistory()
                CookieManager.getInstance().removeAllCookies(null)
                wv.reload()
            }
        }
    }

    fun applyPersona(target: AiTarget) {
        val wv = webView ?: return
        scope.launch {
            currentUA = if (target == AiTarget.MOBILE_BROWSER) {
                prefs.mobileUserAgent.ifBlank { defaultMobileUA }
            } else {
                prefs.pcUserAgent.ifBlank { defaultPcUA }
            }
            wv.settings.userAgentString = currentUA
            wv.reload()
        }
    }

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
        scope.cancel()
        webView?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        webView = null
    }

    fun injectPromptForcefully(inS: String, sendS: String, txt: String) { 
        val escapedText = Util.escapeJs(txt)
        scope.launch {
            simulateHumanInteraction()
            webView?.evaluateJavascript("(function(){ const f=arc.performFill('$inS','$escapedText'); if(f)setTimeout(()=>arc.performSend('$sendS'),500); })();", null)
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
        if (active) startHeartbeatMonitor()
    }

    private fun startHeartbeatMonitor() {
        scope.launch {
            while(isMonitoringActive) {
                delay(10000)
                injectAutoDom()
                if (lastHeartbeat > 0 && System.currentTimeMillis() - lastHeartbeat > 30000) {
                    onDomErrorCallback("heartbeat_lost", null)
                    lastHeartbeat = System.currentTimeMillis()
                }
            }
        }
    }

    private fun applyAntiBotScripts(view: WebView?) {
        val js = """
            (function() {
                Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                Object.defineProperty(navigator, 'languages', {get: () => ['ja-JP', 'ja', 'en-US', 'en']});
                window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){}, app: {} };
            })();
        """.trimIndent()
        view?.evaluateJavascript(js, null)
    }
}
