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
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.arc.databinding.ActivityMainBinding
import org.json.JSONObject
import kotlinx.coroutines.*
import kotlin.coroutines.resume

/**
 * ARC 統合指令ハブ (v25.1 - Neural Connected)
 */
class MainActivity : AppCompatActivity() {

    companion object {
        var serverPort: Int = 8765 
        private val GUIDE_TARGET_ORDER = listOf("gemini", "chatgpt", "copilot")
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: Prefs
    private lateinit var webViewManager: WebViewManager
    private lateinit var allAiPipeline: AllAiPipeline
    private lateinit var debugHud: DebugHud

    private var currentTarget: AiTarget = AiTarget.GEMINI
    private val mainScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var heartbeatJob: Job? = null
    private var verificationDialog: AlertDialog? = null
    private var lastVerificationPromptAtMs: Long = 0L
    private var dynamicSetupJob: Job? = null
    private var smokeWaiter: CompletableDeferred<String?>? = null

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
            val bringToFront = shouldBringToFrontFor(reason)
            debugHud.update(if (bringToFront) "GW: EXEC" else "GW: BG_EXEC")
            Log.d("ARC_UI", "Foreground ensure requested: $reason / bring=$bringToFront")
            if (!bringToFront) return@runOnUiThread
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

    private fun shouldBringToFrontFor(reason: String): Boolean {
        if (reason.startsWith("dynamic_setup")) return true
        if (reason.startsWith("gateway_instruction") || reason == "remote_job") {
            return prefs.shouldForceForegroundForGatewayTask()
        }
        return true
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = Prefs(this)
        val migrationNotes = prefs.runStartupMigrations()
        if (prefs.shouldKeepScreenAwakeNow()) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        debugHud = DebugHud(binding.debugHudLayout, prefs)
        if (migrationNotes.isNotEmpty()) {
            Log.i("ARC_MIGRATION", "Startup migrations applied: ${migrationNotes.joinToString(",")}")
            debugHud.update("MIGRATION: Copilot slot -> Claude")
        }

        setupWebView()
        setupPipelines()
        startArcCore()
        setupUi()
        handleGuideIntent(intent)
        handleDynamicSetupIntent(intent)
        
        pokeScreen()
        startHeartbeatLoop()
    }

    fun pokeScreen() {
        if (!prefs.shouldKeepScreenAwakeNow()) return
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
                val busy = arcWorker.currentQid != null || allAiPipeline.isRunning()
                if (!busy) {
                    arcWorker.announceStatus("heartbeat") { instruction ->
                        handleGatewayInstruction(instruction)
                    }
                }
                val nextDelay = if (busy) minOf(intervalMs, 10_000L) else intervalMs
                delay(nextDelay)
            }
        }
    }

    private fun handleGatewayInstruction(instruction: JSONObject) {
        val mode = instruction.optString("mode")
        if (mode.isBlank() || mode == "arc_heartbeat") return
        val jobId = instruction.optString("job_id", "")
        Log.d("ARC_GW_INSTR", "mode=$mode job_id=$jobId")
        when (mode) {
            "arc_set_runtime_mode" -> {
                val requested = instruction.optString("runtime_mode", Prefs.RUNTIME_MODE_INTERACTIVE)
                    .trim()
                    .lowercase()
                val normalized = if (requested == Prefs.RUNTIME_MODE_AUTONOMOUS) {
                    Prefs.RUNTIME_MODE_AUTONOMOUS
                } else {
                    Prefs.RUNTIME_MODE_INTERACTIVE
                }
                prefs.runtimeMode = normalized
                if (instruction.has("bring_to_front_on_execution")) {
                    prefs.bringToFrontOnExecution = instruction.optBoolean("bring_to_front_on_execution", false)
                }
                if (instruction.has("keep_screen_awake")) {
                    prefs.keepScreenAwake = instruction.optBoolean("keep_screen_awake", prefs.keepScreenAwake)
                }
                if (prefs.shouldKeepScreenAwakeNow()) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                if (jobId.isNotBlank()) {
                    arcGateway.sendArcResult(
                        qid = jobId,
                        result = "runtime_mode_set:$normalized",
                        missionId = jobId,
                        target = instruction.optString("target", currentTarget.name)
                    )
                }
                debugHud.update("GW: RUNTIME=$normalized")
            }
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
                webViewManager.refreshKeepingSession()
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
            injectPrompt = { target, text, missionId ->
                arcWorker.process(
                    ArcTask.AI(
                        qid = "PIPE_${System.currentTimeMillis()}",
                        target = target.name,
                        prompt = text,
                        missionId = missionId
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
            resolveExecutionOrder = { callback ->
                arcGateway.fetchAdaptiveAllOrder(callback)
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
        arcWorker.onGlobalAiResult = { text ->
            val waiter = smokeWaiter
            if (waiter != null && !waiter.isCompleted) {
                waiter.complete(text)
            }
            runOnUiThread { debugHud.update("GEN_DONE"); pokeScreen() }
        }
        arcWorker.onSystemStatusUpdate = { status -> runOnUiThread { debugHud.update(status) } }
        arcWorker.onSystemErrorRequest = { type, data ->
            runOnUiThread {
                debugHud.update("ERR: $type")
                maybeShowVerificationDialog(type, data)
            }
        }
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

    private fun handleGuideIntent(intent: Intent?) {
        val targetRaw = intent?.getStringExtra("ARC_GUIDE_TARGET") ?: return
        val target = normalizeGuideTarget(targetRaw) ?: return
        val sequence = intent.getBooleanExtra("ARC_GUIDE_SEQUENCE", false)
        val stepIndex = intent.getIntExtra("ARC_GUIDE_STEP_INDEX", GUIDE_TARGET_ORDER.indexOf(target).coerceAtLeast(0))
        showGuideStep(target, sequence, stepIndex)
    }

    private fun handleDynamicSetupIntent(intent: Intent?) {
        val start = intent?.getBooleanExtra("ARC_DYNAMIC_SETUP", false) ?: false
        if (!start) return
        if (dynamicSetupJob?.isActive == true) return
        dynamicSetupJob = mainScope.launch {
            runDynamicLoginSetup()
        }
    }

    private fun normalizeGuideTarget(raw: String): String? {
        return when (raw.lowercase().trim()) {
            "gemini" -> "gemini"
            "chatgpt", "gpt" -> "chatgpt"
            "copilot", "claude" -> "copilot"
            else -> null
        }
    }

    private fun targetLabel(target: String): String {
        return when (target) {
            "gemini" -> "Gemini"
            "chatgpt" -> "ChatGPT"
            "copilot" -> "Claude"
            else -> target
        }
    }

    private fun showGuideStep(target: String, sequence: Boolean, stepIndex: Int) {
        val ai = when (target) {
            "gemini" -> AiTarget.GEMINI
            "chatgpt" -> AiTarget.CHATGPT
            "copilot" -> AiTarget.COPILOT
            else -> return
        }
        switchAiTarget(ai)
        val message = getString(R.string.msg_login_guide_step, targetLabel(target))
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.title_login_guide))
            .setMessage(message)
            .setCancelable(false)
            .setNegativeButton(getString(R.string.btn_guide_close), null)
            .setPositiveButton(getString(R.string.btn_guide_next)) { _, _ ->
                if (sequence) {
                    val nextIndex = stepIndex + 1
                    if (nextIndex in GUIDE_TARGET_ORDER.indices) {
                        showGuideStep(GUIDE_TARGET_ORDER[nextIndex], true, nextIndex)
                        return@setPositiveButton
                    }
                }
                Toast.makeText(this, getString(R.string.toast_login_guide_done), Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    private suspend fun runDynamicLoginSetup() {
        val steps = listOf(
            AiTarget.GEMINI to "Gemini",
            AiTarget.CHATGPT to "ChatGPT",
            AiTarget.COPILOT to "Claude"
        )
        val skippedOrFailed = mutableListOf<String>()
        setupLoop@ for ((target, label) in steps) {
            ensureOperationalForeground("dynamic_setup_$label")
            switchAiTarget(target)
            delay(2200)

            var ready = false
            var skipCurrent = false
            for (attempt in 0 until 12) {
                val p = probeCurrentPage()
                val loginReady = isSignedInForSetup(target, p)
                if (p.challenge || !p.inputReady || !loginReady) {
                    val reason = when {
                        p.challenge -> "認証/ボット検知画面"
                        !p.inputReady -> "入力欄未検出"
                        else -> "ログイン未完了"
                    }
                    val action = awaitManualStep(
                        title = "$label: 手動確認",
                        message = "状態: $reason\nARC内のこの画面でログイン/認証を完了してから「再チェック」を押してください。\n必要なら外部ブラウザも開けます。\nURL: ${prefs.getUrlFor(target.name)}",
                        url = prefs.getUrlFor(target.name)
                    )
                    when (action) {
                        ManualStepAction.RECHECK -> delay(1000)
                        ManualStepAction.SKIP_CURRENT -> {
                            skipCurrent = true
                            break
                        }
                        ManualStepAction.ABORT_ALL -> return
                    }
                } else {
                    ready = true
                    break
                }
            }
            if (skipCurrent) continue@setupLoop
            if (!ready) {
                skippedOrFailed += "$label(準備確認)"
                continue@setupLoop
            }

            val smokeOk = runSmokeTest(target)
            if (!smokeOk) {
                val action = awaitManualStep(
                    title = "$label: 送受信確認失敗",
                    message = "短文送信の確認に失敗しました。ARC内の画面を確認して「再チェック」を押してください。",
                    url = prefs.getUrlFor(target.name)
                )
                when (action) {
                    ManualStepAction.RECHECK -> {
                        if (!runSmokeTest(target)) {
                            skippedOrFailed += "$label(送受信確認)"
                            continue@setupLoop
                        }
                    }
                    ManualStepAction.SKIP_CURRENT -> continue@setupLoop
                    ManualStepAction.ABORT_ALL -> return
                }
            }
        }
        val msg = if (skippedOrFailed.isEmpty()) {
            "動的ログイン検証を完了しました"
        } else {
            "動的ログイン検証完了（一部未完了: ${skippedOrFailed.joinToString(" / ")}）"
        }
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
    }

    private data class PageProbe(
        val inputReady: Boolean,
        val sendReady: Boolean,
        val challenge: Boolean,
        val loginPrompt: Boolean,
        val accountMenu: Boolean,
        val title: String
    )

    private enum class ManualStepAction {
        RECHECK,
        SKIP_CURRENT,
        ABORT_ALL
    }

    private suspend fun probeCurrentPage(): PageProbe = suspendCancellableCoroutine { cont ->
        val js = """
            (function(){
              function q(sel){ try { return document.querySelector(sel); } catch(_) { return null; } }
              const text = ((document.body && document.body.innerText) ? document.body.innerText : '').toLowerCase();
              const hasLoginAnchor = !!q("a[href*='login' i], a[href*='signin' i], a[href*='auth' i]");
              const hasLoginButton = !!q("button[data-testid*='login' i], button[aria-label*='log in' i], button[aria-label*='sign in' i]");
              const loginPrompt = hasLoginAnchor || hasLoginButton || text.includes('log in') || text.includes('sign in') || text.includes('ログイン') || text.includes('サインイン');
              const accountMenu = !!q("button[data-testid='profile-button'], [aria-label*='profile' i], [aria-label*='account' i], a[href*='settings' i], img[alt*='profile' i]");
              const challengeStrong = text.includes('i am not a robot') ||
                text.includes('verify you are human') ||
                text.includes('captcha') ||
                text.includes('challenge.cloudflare.com') ||
                text.includes('checking your browser') ||
                text.includes('security check to access') ||
                text.includes('私はロボットではありません') ||
                !!q("iframe[src*='challenge' i],iframe[src*='captcha' i]");
              const input = q("textarea, div[contenteditable='true'][role='textbox'], [contenteditable='true']");
              const send = q("button[data-testid*='send' i], button[aria-label*='送信' i], button[aria-label*='send' i], button[type='submit'], [data-testid='fruitjuice-send-button'], #send-button");
              const challenge = !!challengeStrong && !input;
              return JSON.stringify({
                inputReady: !!input,
                sendReady: !!send || !!input,
                challenge: !!challenge,
                loginPrompt: !!loginPrompt,
                accountMenu: !!accountMenu,
                title: document.title || ''
              });
            })();
        """.trimIndent()
        webViewManager.webView?.post {
            webViewManager.webView?.evaluateJavascript(js) { raw ->
                try {
                    val decoded = JSONObject("{\"v\":$raw}").optString("v", "")
                    val obj = if (decoded.isBlank()) JSONObject() else JSONObject(decoded)
                    cont.resume(
                        PageProbe(
                            inputReady = obj.optBoolean("inputReady", false),
                            sendReady = obj.optBoolean("sendReady", false),
                            challenge = obj.optBoolean("challenge", false),
                            loginPrompt = obj.optBoolean("loginPrompt", false),
                            accountMenu = obj.optBoolean("accountMenu", false),
                            title = obj.optString("title", "")
                        )
                    )
                } catch (_: Exception) {
                    cont.resume(PageProbe(false, false, true, true, false, ""))
                }
            }
        } ?: cont.resume(PageProbe(false, false, true, true, false, ""))
    }

    private fun isSignedInForSetup(target: AiTarget, p: PageProbe): Boolean {
        val url = webViewManager.currentUrl().lowercase()
        if (p.loginPrompt) return false
        return when (target) {
            AiTarget.GEMINI -> {
                !url.contains("accounts.google.com") &&
                    !url.contains("servicelogin") &&
                    p.inputReady
            }
            AiTarget.CHATGPT -> {
                !url.contains("auth.openai.com") &&
                    !url.contains("chatgpt.com/auth") &&
                    p.inputReady &&
                    (p.accountMenu || !p.loginPrompt)
            }
            AiTarget.COPILOT -> {
                (!url.contains("claude.ai/login") || url.contains("app-google-auth")) &&
                    p.inputReady &&
                    (p.accountMenu || !p.loginPrompt)
            }
            else -> p.inputReady
        }
    }

    private suspend fun runSmokeTest(target: AiTarget): Boolean {
        val (inputSel, sendSel) = prefs.getSelectorsFor(target.name)
        if (inputSel.isBlank() || sendSel.isBlank()) return false
        val waiter = CompletableDeferred<String?>()
        smokeWaiter = waiter
        val token = "SETUP_OK_" + (System.currentTimeMillis() % 100000)
        val prompt = "接続確認です。次の文字列をそのまま返答してください: $token"
        webViewManager.injectPromptForcefully(inputSel, sendSel, prompt)
        val result = withTimeoutOrNull(35_000L) { waiter.await() } ?: ""
        smokeWaiter = null
        val lower = result.lowercase()
        val normalized = lower.trim()
        if (lower.contains("cloudflare") || lower.contains("captcha") || lower.contains("robot")) return false
        if (normalized == "ok" || normalized == "ok." || normalized == "okay") return true
        if (result.contains(token)) return true
        return result.isNotBlank() && result.length >= 6
    }

    private suspend fun awaitManualStep(title: String, message: String, url: String): ManualStepAction =
        suspendCancellableCoroutine { cont ->
            val dlg = AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setCancelable(false)
                .setNegativeButton("このAIをスキップ") { _, _ ->
                    if (!cont.isCompleted) cont.resume(ManualStepAction.SKIP_CURRENT)
                }
                .setNeutralButton(getString(R.string.btn_open_external_browser)) { _, _ ->
                    openExternalBrowser(url)
                    if (!cont.isCompleted) cont.resume(ManualStepAction.RECHECK)
                }
                .setPositiveButton(getString(R.string.btn_recheck)) { _, _ ->
                    if (!cont.isCompleted) cont.resume(ManualStepAction.RECHECK)
                }
                .create()
            dlg.show()
            cont.invokeOnCancellation { dlg.dismiss() }
        }

    private fun maybeShowVerificationDialog(type: String, data: String?) {
        if (!requiresManualVerification(type, data)) return
        val now = System.currentTimeMillis()
        if (now - lastVerificationPromptAtMs < 12_000L) return
        if (verificationDialog?.isShowing == true) return
        lastVerificationPromptAtMs = now

        val targetUrl = when {
            type.contains("COPILOT", ignoreCase = true) ||
                (data ?: "").contains("copilot", ignoreCase = true) ||
                (data ?: "").contains("claude", ignoreCase = true) ->
                prefs.getUrlFor("copilot")
            type.contains("LOGIN_REQUIRED", ignoreCase = true) && !data.isNullOrBlank() ->
                data
            else -> webViewManager.currentUrl().ifBlank { prefs.getUrlFor("copilot") }
        }

        verificationDialog = AlertDialog.Builder(this)
            .setTitle(getString(R.string.title_verification_required))
            .setMessage(getString(R.string.msg_verification_required))
            .setCancelable(false)
            .setNegativeButton(getString(R.string.btn_guide_close)) { _, _ ->
                arcWorker.announceStatus("verification_deferred")
            }
            .setNeutralButton(getString(R.string.btn_open_external_browser)) { _, _ ->
                openExternalBrowser(targetUrl)
            }
            .setPositiveButton(getString(R.string.btn_resume_here)) { _, _ ->
                val target = inferVerificationTarget(type, data)
                switchAiTarget(target)
                webViewManager.webView?.post { webViewManager.webView?.loadUrl(prefs.getUrlFor(target.name)) }
                arcWorker.announceStatus("verification_resumed")
                Toast.makeText(this, getString(R.string.toast_verification_resumed), Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    private fun inferVerificationTarget(type: String, data: String?): AiTarget {
        val merged = (type + " " + (data ?: "") + " " + webViewManager.currentUrl()).lowercase()
        return when {
            merged.contains("copilot") || merged.contains("claude.ai") || merged.contains("claude") -> AiTarget.COPILOT
            merged.contains("chatgpt") || merged.contains("auth.openai.com") || merged.contains("openai") -> AiTarget.CHATGPT
            merged.contains("gemini") || merged.contains("google.com") || merged.contains("accounts.google") -> AiTarget.GEMINI
            else -> currentTarget
        }
    }

    private fun requiresManualVerification(type: String, data: String?): Boolean {
        val s = (type + " " + (data ?: "")).lowercase()
        val marks = listOf(
            "copilot_bot_blocked",
            "challenge.cloudflare.com",
            "checking your browser",
            "captcha",
            "recaptcha",
            "robot",
            "verify you are human",
            "私はロボットではありません"
        )
        val hasExplicitLogin = s.contains("login_required") && (
            s.contains("accounts.google.com") ||
                s.contains("auth.openai.com") ||
                s.contains("chatgpt.com/auth") ||
                s.contains("claude.ai/login")
            )
        return hasExplicitLogin || marks.any { s.contains(it) }
    }

    private fun openExternalBrowser(url: String) {
        val u = if (url.isBlank()) prefs.getUrlFor("copilot") else url
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(u)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        } catch (_: Exception) {
            debugHud.update("EXT_BROWSER_OPEN_FAIL")
        }
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
            AiTarget.COPILOT -> "Claude"
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

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleGuideIntent(intent)
        handleDynamicSetupIntent(intent)
    }

    override fun onPause() {
        super.onPause()
        wakeLock?.let { if (it.isHeld) it.release() }
    }

    override fun onDestroy() {
        verificationDialog?.dismiss()
        verificationDialog = null
        heartbeatJob?.cancel()
        mainScope.cancel()
        arcServer?.stop(); webViewManager.destroy()
        screenTimeoutHandler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
