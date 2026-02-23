package com.arc

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import com.arc.databinding.ActivityMainBinding
import org.json.JSONObject
import kotlinx.coroutines.*

/**
 * ARC 統合指令ハブ (v25.1 - Neural Connected)
 */
class MainActivity : AppCompatActivity() {

    companion object {
        var serverPort: Int = 8765 
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs
    private lateinit var webViewManager: WebViewManager
    private lateinit var allAiPipeline: AllAiPipeline
    private lateinit var debugHud: DebugHud

    private var currentTarget: AiTarget = AiTarget.GEMINI
    private val mainScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var heartbeatJob: Job? = null

    private var wakeLock: PowerManager.WakeLock? = null
    private val screenTimeoutHandler = Handler(Looper.getMainLooper())
    private val disableScreenRunnable = Runnable {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        debugHud.update("SCREEN: SLEEP (AUTO)")
    }

    private lateinit var arcWorker: ArcWorker
    private lateinit var arcQueue: ArcTaskQueue
    private lateinit var arcGateway: GatewayClient
    private var arcServer: LocalHttpServer? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = Prefs(this)
        if (prefs.keepScreenAwake) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        debugHud = DebugHud(binding.debugHudLayout, prefs)

        setupWebView()
        setupPipelines()
        startArcCore()
        setupUi()
        
        pokeScreen()
        startHeartbeatLoop()
    }

    fun pokeScreen() {
        if (!prefs.keepScreenAwake) return
        runOnUiThread {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            debugHud.update("SCREEN: ACTIVE")
            screenTimeoutHandler.removeCallbacks(disableScreenRunnable)
            screenTimeoutHandler.postDelayed(disableScreenRunnable, 10 * 60 * 1000)
            acquireWakeLock()
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ARC:KeepAlive").apply {
            acquire(10 * 60 * 1000L)
        }
    }

    private fun setupWebView() {
        webViewManager = WebViewManager(
            context = this,
            prefs = prefs,
            onDomErrorCallback = { type, _ -> 
                runOnUiThread { debugHud.update(type) }
            },
            onAiResult = { _ -> /* ArcWorker handles */ },
            onAutoDom = { json -> handleAutoDomResult(json) },
            onPicked = { selector -> savePickedSelector(selector) },
            onPageFinished = { 
                runOnUiThread {
                    debugHud.update("PAGE_READY")
                    allAiPipeline.onPageFinished()
                }
            }
        )
        binding.webViewContainer.addView(webViewManager.createWebView())
    }

    private fun handleAutoDomResult(json: String) {
        AutoDom.handleAutoDomJson(json, currentTarget, prefs)
        try {
            val obj = JSONObject(json)
            val status = obj.optJSONObject("meta")?.optString("status", "ready")
                ?: obj.optString("status", "ready")
            debugHud.update(if (status == "generating") "AI: BUSY" else "AI: READY")
        } catch (_: Exception) {}
    }

    private fun startHeartbeatLoop() {
        heartbeatJob?.cancel()
        heartbeatJob = mainScope.launch {
            val intervalMs = prefs.heartbeatIntervalMs.coerceAtLeast(60000L)
            while (isActive) {
                delay(intervalMs)
                if (arcWorker.currentQid == null) {
                    arcWorker.announceStatus("heartbeat") { instruction ->
                        handleGatewayInstruction(instruction)
                    }
                }
            }
        }
    }

    private fun handleGatewayInstruction(instruction: JSONObject) {
        val mode = instruction.optString("mode")
        if (mode.isBlank() || mode == "arc_heartbeat") return
        val jobId = instruction.optString("job_id", "")
        when (mode) {
            "request_arc" -> {
                val qid = instruction.optString("qid", if (jobId.isNotBlank()) jobId else "gw_${System.currentTimeMillis()}")
                val missionId = instruction.optString("mission_id", if (jobId.isNotBlank()) jobId else qid)
                val target = instruction.optString("target", currentTarget.name)
                val prompt = instruction.optString("prompt", "")
                if (prompt.isNotBlank()) {
                    arcQueue.enqueue(ArcTask.AI(qid, target, prompt, missionId = missionId))
                    debugHud.update("GW: ENQUEUED")
                }
            }
            "arc_refresh" -> {
                webViewManager.refreshProcess()
                if (jobId.isNotBlank()) arcGateway.sendArcResult(jobId, "refresh_done")
                debugHud.update("GW: REFRESH")
            }
            "arc_execute_js" -> {
                val script = instruction.optString("script", "")
                if (script.isNotBlank()) {
                    webViewManager.webView?.post { webViewManager.webView?.evaluateJavascript(script, null) }
                    if (jobId.isNotBlank()) arcGateway.sendArcResult(jobId, "js_executed")
                    debugHud.update("GW: JS")
                }
            }
            "arc_screenshot" -> {
                webViewManager.captureBitmap { bmp ->
                    val out = java.io.ByteArrayOutputStream()
                    bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, out)
                    val b64 = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
                    arcGateway.sendArcResult(if (jobId.isNotBlank()) jobId else "gw_manual", "screenshot_captured", b64)
                    debugHud.update("GW: SHOT")
                }
            }
        }
    }

    private fun setupPipelines() {
        val hallucinationPipeline = HallucinationPipeline(
            prefs = prefs,
            loadAi = { target -> arcQueue.enqueue(ArcTask.AI("HAL_RECON", target.name, "Recovery", missionId = "HAL_FIX")) },
            injectPrompt = { text -> arcQueue.enqueue(ArcTask.AI("HAL_INJECT", currentTarget.name, text, missionId = "HAL_FIX")) }
        )

        allAiPipeline = AllAiPipeline(
            prefs = prefs,
            requestExecution = { target, prompt, missionId ->
                arcQueue.enqueue(ArcTask.AI(qid = "PIPE_${System.currentTimeMillis()}", target = target.name, prompt = prompt, missionId = missionId))
            },
            onFinalResult = { final -> 
                arcGateway.sendArcResult("ALL_FINAL", final)
                runOnUiThread { debugHud.update("ALL_DONE") }
            },
            hallucinationPipeline = hallucinationPipeline,
            requestVisionSolve = { action, onSolved ->
                arcQueue.enqueue(ArcTask.VisionRequest(action, onSolved))
            },
            consultGateway = { ctx, prob, img, callback ->
                arcGateway.consultGateway(ctx, prob, img, callback)
            },
            captureBitmap = { onReady ->
                webViewManager.captureBitmap(onReady)
            }
        )
    }

    private fun executeLoad(target: AiTarget, customUrl: String? = null) {
        currentTarget = target
        webViewManager.applyPersona(target)
        val url = customUrl ?: when (target) {
            AiTarget.FULL_BROWSER, AiTarget.MOBILE_BROWSER -> "https://bot.sannysoft.com/"
            else -> prefs.getUrlFor(target.name)
        }
        webViewManager.webView?.post { webViewManager.webView?.loadUrl(url) }
    }

    private fun startArcCore() {
        arcGateway = GatewayClient(prefs)
        arcGateway.sendSetupRequest(serverPort) { _, _ -> }
        
        arcWorker = ArcWorker(webViewManager, arcGateway, prefs) { allAiPipeline }
        arcWorker.onGlobalAiResult = { _ ->
            runOnUiThread { debugHud.update("GEN_DONE"); pokeScreen() }
        }
        arcWorker.onSystemStatusUpdate = { status -> runOnUiThread { debugHud.update(status) } }
        arcWorker.onSystemErrorRequest = { type, _ -> runOnUiThread { debugHud.update("ERR: $type") } }
        
        arcQueue = ArcTaskQueue(arcWorker)
        arcServer = LocalHttpServer(arcQueue, webViewManager, arcGateway, prefs, 8765) { pokeScreen() }
        
        try { 
            arcServer?.safeStart()
            serverPort = arcServer?.actualPort ?: 8765
            arcWorker.announceStatus("online")
        } catch (_: Exception) {}
    }

    private fun setupUi() {
        binding.btnGemini.setOnClickListener { arcQueue.enqueue(ArcTask.AI("manual", "gemini", "Hello")) }
        binding.btnGPT.setOnClickListener { arcQueue.enqueue(ArcTask.AI("manual", "chatgpt", "Hello")) }
        binding.btnCopilot.setOnClickListener { arcQueue.enqueue(ArcTask.AI("manual", "copilot", "Hello")) }

        binding.sendButton.setOnClickListener {
            val text = binding.promptInput.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty()) {
                binding.promptInput.setText("")
                if (text.startsWith("/all")) arcQueue.enqueue(ArcTask.Pipeline(text.removePrefix("/all").trim()))
                else arcQueue.enqueue(ArcTask.AI("manual", currentTarget.name, text))
            }
        }
        binding.settingsButton.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }
    }

    /**
     * 🛡️ [復旧] セレクタピッカーの結果を保存する
     */
    private fun savePickedSelector(selector: String) {
        if (selector.isBlank()) return
        when (currentTarget) {
            AiTarget.GEMINI -> prefs.geminiInputSelector = selector
            AiTarget.CHATGPT -> prefs.chatGptInputSelector = selector
            AiTarget.COPILOT -> prefs.copilotInputSelector = selector
            else -> {}
        }
        debugHud.update("PICKED: $selector")
    }

    override fun onResume() {
        super.onResume()
        pokeScreen()
    }

    override fun onPause() {
        super.onPause()
        wakeLock?.let { if (it.isHeld) it.release() }
    }

    override fun onDestroy() {
        heartbeatJob?.cancel()
        mainScope.cancel()
        arcServer?.stop(); webViewManager.destroy()
        screenTimeoutHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
