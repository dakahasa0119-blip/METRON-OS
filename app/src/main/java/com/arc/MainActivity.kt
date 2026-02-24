package com.arc

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.Toast
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

    private fun ensureOperationalForeground(reason: String) {
        runOnUiThread {
            pokeScreen()
            webViewManager.resumeRuntime()
            debugHud.update("GW: EXEC")
            Log.d("ARC_UI", "Foreground ensure requested: $reason")
            try {
                val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                am.appTasks.firstOrNull()?.moveToFront()
            } catch (e: Exception) {
                Log.w("ARC_UI", "moveToFront failed: ${e.message}")
            }
            val intent = Intent(this, MainActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
                )
            }
            startActivity(intent)
        }
    }

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
            },
            onLoginBlocked = { blockedUrl ->
                runOnUiThread {
                    debugHud.update("LOGIN_BLOCK: 外部ブラウザへ切替")
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(blockedUrl)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(intent)
                        Toast.makeText(
                            this,
                            "Googleログインは外部ブラウザで続行します",
                            Toast.LENGTH_LONG
                        ).show()
                    } catch (_: Exception) {
                        debugHud.update("LOGIN_BLOCK: 外部ブラウザ起動失敗")
                    }
                }
            }
        )
        binding.webViewContainer.addView(webViewManager.createWebView())
    }

    private fun handleAutoDomResult(json: String) {
        AutoDom.handleAutoDomJson(json, currentTarget, prefs)
        if (arcWorker.currentQid != null) return
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
            val intervalMs = prefs.heartbeatIntervalMs.coerceIn(5000L, 120000L)
            while (isActive) {
                val busy = arcWorker.currentQid != null
                if (!busy) {
                    arcWorker.announceStatus("heartbeat") { instruction ->
                        handleGatewayInstruction(instruction)
                    }
                } else {
                    // 実行中も生存信号は出す（命令受信はしない）
                    arcWorker.announceStatus("running")
                }
                delay(intervalMs)
            }
        }
    }

    private fun handleGatewayInstruction(instruction: JSONObject) {
        val mode = instruction.optString("mode")
        if (mode.isBlank() || mode == "arc_heartbeat") return
        val jobId = instruction.optString("job_id", "")
        Log.d("ARC_GW_INSTR", "mode=$mode job_id=$jobId")
        when (mode) {
            "request_arc" -> {
                val qid = instruction.optString("qid", if (jobId.isNotBlank()) jobId else "gw_${System.currentTimeMillis()}")
                val missionId = instruction.optString("mission_id", if (jobId.isNotBlank()) jobId else qid)
                val target = instruction.optString("target", currentTarget.name)
                val prompt = instruction.optString("prompt", "")
                if (prompt.isNotBlank()) {
                    ensureOperationalForeground("gateway_instruction_request_arc")
                    if (target.equals("ALL", ignoreCase = true)) {
                        arcQueue.enqueue(ArcTask.Pipeline(prompt, missionId = missionId))
                    } else {
                        arcQueue.enqueue(ArcTask.AI(qid, target, prompt, missionId = missionId))
                    }
                    debugHud.update("GW: ENQUEUED")
                } else if (jobId.isNotBlank()) {
                    arcGateway.sendArcError(
                        qid = jobId,
                        type = "EMPTY_PROMPT",
                        data = "gateway_instruction_missing_prompt",
                        missionId = missionId,
                        target = target
                    )
                }
            }
            "arc_refresh" -> {
                webViewManager.refreshProcess()
                if (jobId.isNotBlank()) {
                    arcGateway.sendArcResult(
                        qid = jobId,
                        result = "refresh_done",
                        missionId = jobId,
                        target = instruction.optString("target", currentTarget.name)
                    )
                }
                debugHud.update("GW: REFRESH")
            }
            "arc_execute_js" -> {
                val script = instruction.optString("script", "")
                if (script.isNotBlank()) {
                    webViewManager.webView?.post { webViewManager.webView?.evaluateJavascript(script, null) }
                    if (jobId.isNotBlank()) {
                        arcGateway.sendArcResult(
                            qid = jobId,
                            result = "js_executed",
                            missionId = jobId,
                            target = instruction.optString("target", currentTarget.name),
                            prompt = instruction.optString("prompt", "")
                        )
                    }
                    debugHud.update("GW: JS")
                } else if (jobId.isNotBlank()) {
                    arcGateway.sendArcError(
                        qid = jobId,
                        type = "EMPTY_SCRIPT",
                        data = "gateway_instruction_missing_script",
                        missionId = jobId,
                        target = instruction.optString("target", currentTarget.name)
                    )
                }
            }
            "arc_screenshot" -> {
                Log.d("ARC_GW_INSTR", "arc_screenshot start job_id=$jobId")
                ensureOperationalForeground("gateway_instruction_arc_screenshot")
                val target = instruction.optString("target", currentTarget.name)
                val mid = if (jobId.isNotBlank()) jobId else "gw_manual"
                var responded = false
                Handler(Looper.getMainLooper()).postDelayed({
                    if (!responded) {
                        Log.w("ARC_GW_INSTR", "arc_screenshot timeout job_id=$mid")
                        arcGateway.sendArcError(
                            qid = mid,
                            type = "SCREENSHOT_TIMEOUT",
                            data = "capture_bitmap_no_callback",
                            missionId = mid,
                            target = target
                        )
                        debugHud.update("GW: SHOT_TIMEOUT")
                    }
                }, 12_000)
                webViewManager.captureBitmap { bmp ->
                    responded = true
                    Log.d("ARC_GW_INSTR", "arc_screenshot captured job_id=$mid")
                    val out = java.io.ByteArrayOutputStream()
                    bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, out)
                    val b64 = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
                    arcGateway.sendArcResult(
                        qid = mid,
                        result = "screenshot_captured",
                        image = b64,
                        missionId = mid,
                        target = target
                    )
                    debugHud.update("GW: SHOT")
                }
            }
        }
    }

    private fun setupPipelines() {
        val hallucinationPipeline = HallucinationPipeline(
            prefs = prefs,
            injectPrompt = { target, text ->
                arcWorker.process(
                    ArcTask.AI(
                        qid = "PIPE_${System.currentTimeMillis()}",
                        target = target.name,
                        prompt = text,
                        missionId = "HAL_FIX"
                    )
                ) { }
            }
        )

        allAiPipeline = AllAiPipeline(
            prefs = prefs,
            requestExecution = { target, prompt, missionId ->
                arcWorker.process(
                    ArcTask.AI(
                        qid = "PIPE_${System.currentTimeMillis()}",
                        target = target.name,
                        prompt = prompt,
                        missionId = missionId
                    )
                ) { }
            },
            onFinalResult = { missionId, final, success ->
                val mid = if (missionId.isBlank()) "ALL_FINAL" else missionId
                val evalSummary = allAiPipeline.lastEvalSummary()
                if (success) {
                    arcGateway.sendArcResult(
                        qid = mid,
                        result = final,
                        missionId = mid,
                        target = "ALL",
                        evalSummary = evalSummary
                    )
                } else {
                    arcGateway.sendArcError(
                        qid = mid,
                        type = "ALL_PIPELINE_FAILED",
                        data = final,
                        missionId = mid,
                        target = "ALL"
                    )
                }
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
        arcWorker.onGatewayInstruction = { instruction -> handleGatewayInstruction(instruction) }
        
        arcQueue = ArcTaskQueue(arcWorker)
        arcServer = LocalHttpServer(
            arcQueue,
            webViewManager,
            arcGateway,
            prefs,
            8765,
            onRequested = { pokeScreen() },
            onExecutionRequested = { ensureOperationalForeground("remote_job") }
        )
        
        try { 
            arcServer?.safeStart()
            serverPort = arcServer?.actualPort ?: 8765
            arcWorker.announceStatus("online")
        } catch (_: Exception) {}
    }

    private fun setupUi() {
        binding.btnGemini.setOnClickListener { switchAiTarget(AiTarget.GEMINI) }
        binding.btnGPT.setOnClickListener { switchAiTarget(AiTarget.CHATGPT) }
        binding.btnCopilot.setOnClickListener { switchAiTarget(AiTarget.COPILOT) }

        binding.modeToggleButton.setOnClickListener {
            prefs.headlessMode = !prefs.headlessMode
            updateRunModeUi()
            Toast.makeText(
                this,
                if (prefs.headlessMode) getString(R.string.toast_mode_headless) else getString(R.string.toast_mode_debug),
                Toast.LENGTH_SHORT
            ).show()
        }

        binding.sendButton.setOnClickListener {
            if (prefs.headlessMode) {
                Toast.makeText(this, getString(R.string.toast_headless_send_disabled), Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val text = binding.promptInput.text?.toString()?.trim() ?: ""
            if (text.isNotEmpty()) {
                binding.promptInput.setText("")
                // 手動送信は最優先。残ジョブとの競合を避けるためキューをクリアする。
                arcQueue.clearAll()
                if (text.startsWith("/all")) arcQueue.enqueue(ArcTask.Pipeline(text.removePrefix("/all").trim()))
                else arcQueue.enqueue(ArcTask.AI("manual", currentTarget.name, text))
            }
        }
        binding.settingsButton.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        updateRunModeUi()
        // 初回表示時に現在ターゲットを確実に選択・ロードする
        switchAiTarget(currentTarget)
    }

    private fun updateRunModeUi() {
        val isHeadless = prefs.headlessMode
        binding.aiTabRow.visibility = if (isHeadless) View.GONE else View.VISIBLE
        binding.promptInput.visibility = if (isHeadless) View.GONE else View.VISIBLE
        binding.sendButton.visibility = if (isHeadless) View.GONE else View.VISIBLE
        binding.modeBanner.text = if (isHeadless) getString(R.string.banner_headless) else getString(R.string.banner_debug)
        binding.modeBanner.setBackgroundColor(
            if (isHeadless) android.graphics.Color.parseColor("#E8F0FE")
            else android.graphics.Color.parseColor("#E6F4EA")
        )
        binding.modeBanner.setTextColor(
            if (isHeadless) android.graphics.Color.parseColor("#174EA6")
            else android.graphics.Color.parseColor("#137333")
        )
        binding.modeToggleButton.text =
            if (isHeadless) getString(R.string.btn_mode_headless) else getString(R.string.btn_mode_debug)
    }

    private fun switchAiTarget(target: AiTarget) {
        currentTarget = target
        executeLoad(target)
        val label = when (target) {
            AiTarget.GEMINI -> "Gemini"
            AiTarget.CHATGPT -> "ChatGPT"
            AiTarget.COPILOT -> "Copilot"
            else -> target.name
        }
        Log.d("ARC_UI", "Switched AI target: $label")
        debugHud.update("AI切替: $label")
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
        webViewManager.resumeRuntime()
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
