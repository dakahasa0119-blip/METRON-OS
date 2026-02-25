package com.arc

import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream

/**
 * ARCの全ての知能を統率し、信号の死角を完全に排除したコアエンジン (v25.4 - Neural Polished)
 */
class ArcWorker(
    val web: WebViewManager,
    private val gateway: GatewayClient,
    private val prefs: Prefs,
    private val pipelineProvider: () -> AllAiPipeline
) {
    private data class ScreenDecision(
        val action: String,
        val note: String = ""
    )

    private val workerScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val visionClient by lazy { VisionClient(prefs.gasUrl) }
    
    var currentQid: String? = null
    var currentMissionId: String? = null
    private var isAborted = false
    private var lastTarget: String = ""
    private var lastFailedSelector: String = ""
    private var lastFailedType: String = ""
    private var lastAiTask: ArcTask.AI? = null
    private var currentAttemptStartedAtMs: Long = 0L
    private var stealthRetryCount: Int = 0
    private var adaptiveRetryCount: Int = 0
    private var isFinalizingResult: Boolean = false
    private val statusTrail = ArrayDeque<String>()
    private var statusSeq: Long = 0L
    private var lastFastHeartbeatAtMs: Long = 0L
    private val fastHeartbeatMinIntervalMs: Long = 1200L
    private var pendingFastHeartbeatJob: Job? = null
    private var lastCopilotDiagAtMs: Long = 0L
    private val copilotDiagCooldownMs: Long = 20_000L
    private var consultInFlight: Boolean = false
    private var consultAttemptCount: Int = 0
    private var lastConsultAtMs: Long = 0L
    private val webDiag by lazy { WebViewDiagnosticProbe(web, gateway, prefs, workerScope) }
    private data class TimingModel(var emaMs: Double = 0.0, var samples: Int = 0)
    private val timingModels = mutableMapOf<String, TimingModel>()

    // 🚀 [統合信号系]
    var onGlobalAiResult: ((String) -> Unit)? = null
    var onSystemStatusUpdate: ((String) -> Unit)? = null
    var onSystemErrorRequest: ((String, String?) -> Unit)? = null 
    var onGatewayInstruction: ((JSONObject) -> Unit)? = null
    
    private var currentDoneCallback: (() -> Unit)? = null
    private var timeoutJob: Job? = null
    private var taskHeartbeatJob: Job? = null
    private fun isDriveReferencePrompt(prompt: String): Boolean {
        val p = prompt.lowercase()
        val marks = listOf(
            "docs.google.com/spreadsheets",
            "drive.google.com",
            "@google",
            "google drive",
            "spreadsheet",
            "sheet",
            "スプレッドシート",
            "シート参照"
        )
        return marks.any { p.contains(it) }
    }

    private fun perAttemptTimeoutMsFor(target: String, prompt: String): Long {
        if (isDriveReferencePrompt(prompt)) {
            return when (target.lowercase()) {
                "gemini" -> 150_000L
                else -> 120_000L
            }
        }
        return when (target.lowercase()) {
            else -> 45_000L
        }
    }

    private fun noProgressLimitMsFor(target: String, prompt: String): Long {
        if (isDriveReferencePrompt(prompt)) {
            return when (target.lowercase()) {
                "gemini" -> 95_000L
                else -> 70_000L
            }
        }
        return when (target.lowercase()) {
            else -> 28_000L
        }
    }

    private fun timingKey(target: String, prompt: String): String {
        val mode = if (isDriveReferencePrompt(prompt)) "drive" else "normal"
        return "${target.lowercase()}:$mode"
    }

    private fun recordAttemptTiming(target: String, prompt: String, elapsedMs: Long, success: Boolean) {
        if (elapsedMs <= 0L) return
        val key = timingKey(target, prompt)
        val m = timingModels.getOrPut(key) { TimingModel() }
        val x = elapsedMs.toDouble()
        if (m.samples <= 0) {
            m.emaMs = x
            m.samples = 1
            return
        }
        val alpha = if (success) 0.25 else 0.12
        m.emaMs = m.emaMs * (1.0 - alpha) + x * alpha
        m.samples += 1
    }

    private fun dynamicNoProgressLimitMs(
        target: String,
        prompt: String,
        baseMs: Long,
        elapsedMs: Long,
        generating: Boolean,
        assistantLen: Int,
        timeoutMs: Long
    ): Long {
        var limit = baseMs
        val model = timingModels[timingKey(target, prompt)]
        if (model != null && model.samples >= 2) {
            val emaBased = (model.emaMs * 0.70).toLong().coerceAtLeast(15_000L)
            limit = maxOf(limit, emaBased)
        }

        if (generating || assistantLen > 0) {
            val longCap = (timeoutMs - 5_000L).coerceAtLeast(limit)
            limit = minOf(longCap, limit + 25_000L)
        } else if (elapsedMs >= 20_000L) {
            val coldCut = if (isDriveReferencePrompt(prompt)) 45_000L else 22_000L
            limit = minOf(limit, coldCut)
        }
        return limit
    }

    init {
        gateway.telemetrySupplier = {
            JSONObject().apply {
                put("hud_tail", snapshotStatusTrail())
                put("hud_last", latestStatus())
                put("arc_qid", currentQid ?: "")
                put("runtime_mode", prefs.normalizedRuntimeMode())
                put("bring_to_front_on_execution", prefs.bringToFrontOnExecution)
                put("effective_keep_screen_awake", prefs.shouldKeepScreenAwakeNow())
                put("capabilities", JSONObject().apply {
                    put("supports_slot_mode", false)
                    put("supports_consensus", true)
                    put("supports_runtime_mode_switch", true)
                    put("supports_compact_corner_mode", prefs.compactCornerMode)
                    put("supports_minimize_guard", prefs.minimizeGuardEnabled)
                })
            }
        }
        // 🚀 現場(WebView)からの全信号を掌握し、ミッション文脈に合わせてルーティング
        web.onAiResult = { result ->
            if (!isAborted) {
                onGlobalAiResult?.invoke(result)
                val qid = currentQid
                if (qid != null) {
                    cancelActiveJobs()
                    if (qid.startsWith("PIPE_")) {
                        emitStatus("PIPE_STEP_DONE")
                        pipelineProvider().onAiResult(result)
                        finishTask(currentDoneCallback)
                    } else {
                        handleAiResult(result)
                    }
                } else pipelineProvider().onAiResult(result)
            }
        }
        
        web.onPageFinished = {
            if (!isAborted && currentQid == null) {
                pipelineProvider().onPageFinished()
            }
        }

        // 🛡️ [信号同期] 生成完了信号を受け取り、ミッションステータスを更新
        web.onGenerationDone = {
            if (!isAborted) {
                emitStatus("GEN_READY")
                // 必要に応じて次のステップを急がせるトリガーに使用
            }
        }

        web.onDomErrorCallback = { type, data ->
            if (!isAborted) {
                cancelActiveJobs()
                if ((type.contains("FILL_FAIL_REPORT") || type.contains("SEND_FAIL_REPORT")) && data != null) {
                    lastFailedType = if (type.contains("SEND_FAIL_REPORT")) "send" else "input"
                    lastFailedSelector = type.substringAfter(":")
                    handleOperationFailure(data)
                } else if (currentQid != null) {
                    val qid = currentQid ?: ""
                    if (qid.startsWith("PIPE_")) {
                        emitStatus("PIPE_STEP_ERROR:$type")
                        pipelineProvider().onAiResult("")
                        finishTask(currentDoneCallback)
                    } else {
                        handleDomError(type, data)
                    }
                } else {
                    onSystemErrorRequest?.invoke(type, data)
                }
            }
        }
    }

    /**
     * 🧠 [知能統合] 現場の失敗を、Gatewayの長期記憶または外部AIで連動解決する
     */
    private fun handleOperationFailure(precisionData: String) {
        if (!prefs.consultGatewayEnabled) {
            emitStatus("CONSULT_DISABLED")
            startExpertHealing(precisionData)
            return
        }
        val now = System.currentTimeMillis()
        if (consultInFlight) {
            emitStatus("CONSULT_SKIP:IN_FLIGHT")
            startExpertHealing(precisionData)
            return
        }
        if (consultAttemptCount >= 1 || now - lastConsultAtMs < 7_000L) {
            emitStatus("CONSULT_SKIP:THROTTLED")
            startExpertHealing(precisionData)
            return
        }
        consultInFlight = true
        consultAttemptCount++
        lastConsultAtMs = now
        emitStatus("CONSULTING BRAIN...")
        gateway.consultGateway("Failed at $lastFailedSelector", precisionData) { advice ->
            consultInFlight = false
            if (advice.isNullOrBlank()) {
                startExpertHealing(precisionData)
                return@consultGateway
            }
            
            when {
                // 🧬 コードパッチなら自己進化プロセスへ
                advice.contains("function") || advice.contains("arc.") -> {
                    emitStatus("EVOLVING CORE...")
                    web.applyAndVerifyPatch(advice)
                }
                // 💡 セレクタなら即座に適用
                advice.startsWith(".") || advice.startsWith("#") || advice.contains("[") -> {
                    emitStatus("RECOVERING...")
                    applyHealing(advice)
                }
                else -> startExpertHealing(precisionData)
            }
        }
    }

    private fun validateSelector(s: String?) = !s.isNullOrBlank() && s.length < 100 && (s.startsWith(".") || s.startsWith("#") || s.contains("["))

    @Synchronized
    private fun rememberStatus(status: String) {
        val ts = System.currentTimeMillis()
        statusTrail.addLast("${ts}:${status.take(120)}")
        while (statusTrail.size > 20) statusTrail.removeFirst()
    }

    private fun emitStatus(status: String) {
        rememberStatus(status)
        val seq = nextStatusSeq()
        val url = web.currentUrl()
        val inferred = inferTargetFromUrl(url).ifBlank { lastTarget }
        val shortUrl = if (url.length > 180) url.take(180) + "...(len=" + url.length + ")" else url
        Log.d(
            "ARC_HUD_EVT",
            "seq=$seq qid=${currentQid ?: "-"} target=${inferred.ifBlank { "-" }} status=${status.take(120)} url=$shortUrl"
        )
        onSystemStatusUpdate?.invoke(status)
        requestFastHeartbeat(status)
    }

    @Synchronized
    private fun reserveFastHeartbeatDelayMs(nowMs: Long): Long {
        val delta = nowMs - lastFastHeartbeatAtMs
        if (delta >= fastHeartbeatMinIntervalMs) {
            lastFastHeartbeatAtMs = nowMs
            return 0L
        }
        return (fastHeartbeatMinIntervalMs - delta).coerceAtLeast(0L)
    }

    private fun requestFastHeartbeat(status: String) {
        if (isAborted) return
        // 実行中コンテキストのみで即時反映。待機中は定期heartbeatに任せる。
        if (currentQid == null && currentMissionId.isNullOrBlank()) return
        val nowMs = System.currentTimeMillis()
        val statusHint = when {
            status.startsWith("MISSION OK") || status.startsWith("PIPE_STEP_DONE") -> "success"
            status.startsWith("ERROR") || status.startsWith("BOT_BLOCKED") -> "error"
            else -> "running"
        }
        val delayMs = reserveFastHeartbeatDelayMs(nowMs)
        if (delayMs <= 0L) {
            pendingFastHeartbeatJob?.cancel()
            pendingFastHeartbeatJob = null
            announceStatus(statusHint)
            return
        }
        pendingFastHeartbeatJob?.cancel()
        pendingFastHeartbeatJob = workerScope.launch {
            delay(delayMs)
            if (isAborted) return@launch
            if (currentQid == null && currentMissionId.isNullOrBlank()) return@launch
            synchronized(this@ArcWorker) {
                lastFastHeartbeatAtMs = System.currentTimeMillis()
            }
            announceStatus(statusHint)
        }
    }

    @Synchronized
    private fun snapshotStatusTrail(): JSONArray {
        return JSONArray(statusTrail.toList())
    }

    @Synchronized
    private fun latestStatus(): String {
        return statusTrail.lastOrNull() ?: ""
    }

    @Synchronized
    private fun nextStatusSeq(): Long {
        statusSeq += 1
        return statusSeq
    }

    @Synchronized
    private fun currentStatusSeq(): Long {
        return statusSeq
    }

    private fun cancelActiveJobs() {
        timeoutJob?.cancel()
        timeoutJob = null
        taskHeartbeatJob?.cancel()
        taskHeartbeatJob = null
        pendingFastHeartbeatJob?.cancel()
        pendingFastHeartbeatJob = null
    }

    fun abortCurrent() { 
        isAborted = true; currentQid = null; currentDoneCallback = null
        isFinalizingResult = false
        cancelActiveJobs()
    }

    fun forceFailCurrent(errorType: String, data: String) {
        val qid = currentQid ?: lastAiTask?.qid ?: "SYSTEM"
        val missionId = currentMissionId
        val target = lastAiTask?.target
        val prompt = lastAiTask?.prompt
        prefs.addContext(
            q = "Task: $qid",
            a = "ERROR: $errorType $data",
            isSuccess = false,
            target = target ?: "",
            sessionId = missionId ?: qid
        )
        if (qid != "SYSTEM") {
            gateway.sendArcError(qid, errorType, data, missionId = missionId, target = target, prompt = prompt)
        } else {
            gateway.sendArcError("SYSTEM", errorType, data, missionId = missionId, target = target, prompt = prompt)
        }
        announceStatus("error")
        val done = currentDoneCallback
        currentQid = null
        currentDoneCallback = null
        isFinalizingResult = false
        done?.invoke()
    }

    fun process(task: ArcTask, done: () -> Unit) {
        isAborted = false
        when (task) {
            is ArcTask.Pipeline -> {
                currentMissionId = task.missionId
                emitStatus("MISSION START")
                announceStatus("running")
                pipelineProvider().start(task.prompt, task.missionId) {
                    currentMissionId = null
                    announceStatus("idle")
                    done() 
                }
            }
            is ArcTask.AI -> {
                currentQid = task.qid
                currentMissionId = task.missionId
                lastAiTask = task
                isFinalizingResult = false
                if (!task.isSelfHealing) {
                    stealthRetryCount = 0
                    adaptiveRetryCount = 0
                    consultAttemptCount = 0
                    consultInFlight = false
                    lastConsultAtMs = 0L
                }
                currentDoneCallback = done
                announceStatus("running")
                startTaskHeartbeat(task.qid)
                executeAiTask(task)
            }
            is ArcTask.VisionRequest -> {
                currentDoneCallback = done
                announceStatus("running")
                executeVisionTask(task)
            }
        }
    }

    private fun executeAiTask(task: ArcTask.AI) {
        lastAiTask = task
        currentAttemptStartedAtMs = System.currentTimeMillis()
        val target = task.target.lowercase()
        val parsedTarget = Util.parseTarget(target)
        val currentUrl = web.currentUrl()
        val currentPageTarget = inferTargetFromUrl(currentUrl)
        val targetMismatch = currentPageTarget.isNotBlank() && currentPageTarget != target
        val shouldLoad = lastTarget != target || task.forceReload || targetMismatch
        lastTarget = target
        cancelActiveJobs()

        if (shouldLoad) {
            if (targetMismatch) {
                emitStatus("TARGET_MISMATCH:${currentPageTarget}->${target}")
                Log.w("ARC_TASK", "target mismatch current=$currentPageTarget requested=$target url=$currentUrl")
            }
            emitStatus("LOADING $target")
            // ここで reload すると旧ページの onPageFinished で誤注入が起きるため、URL遷移側に一本化する
            web.applyPersona(parsedTarget ?: AiTarget.GEMINI, reloadPage = false)
            web.webView?.post { web.webView?.loadUrl(prefs.getUrlFor(target)) }
            // 遷移失敗時の保険: 8秒後も別ターゲットなら再度明示遷移
            workerScope.launch {
                delay(8000)
                if (isAborted || currentQid != task.qid) return@launch
                val nowTarget = inferTargetFromUrl(web.currentUrl())
                if (nowTarget != target) {
                    Log.w("ARC_TASK", "force nav retry current=$nowTarget requested=$target")
                    emitStatus("FORCE_NAV_RETRY:$target")
                    web.webView?.post { web.webView?.loadUrl(prefs.getUrlFor(target)) }
                }
            }
        }

        val isReconTarget = parsedTarget == AiTarget.MOBILE_BROWSER || parsedTarget == AiTarget.FULL_BROWSER
        if (isReconTarget) {
            val done = currentDoneCallback
            val finishRecon = {
                emitStatus("RECON_READY")
                finishTask(done)
            }
            if (shouldLoad) {
                val old = web.onPageFinished
                web.onPageFinished = {
                    if (!isAborted && currentQid == task.qid) {
                        web.onPageFinished = old
                        finishRecon()
                    }
                    old()
                }
            } else {
                workerScope.launch { delay(300); if (!isAborted) finishRecon() }
            }
            return
        }

        val action = {
            if (!isAborted) {
                emitStatus("INJECTING...")
                val (inS, sendS) = prefs.getSelectorsFor(target)
                web.injectPromptForcefully(inS, sendS, buildFinalPrompt(task))
            }
        }

        if (shouldLoad) {
            val old = web.onPageFinished
            web.onPageFinished = { if(!isAborted && currentQid == task.qid) { action(); web.onPageFinished = old }; old() }
        } else {
            workerScope.launch { delay(1000); if(!isAborted) action() }
        }
        
        if (isDriveReferencePrompt(task.prompt)) {
            emitStatus("LONG_WAIT_MODE:DRIVE_REF")
        }
        val timeoutMs = perAttemptTimeoutMsFor(target, task.prompt)
        timeoutJob = workerScope.launch {
            val startedAt = System.currentTimeMillis()
            var lastSeq = currentStatusSeq()
            var lastProgressAt = startedAt
            var lastAssistantLen = 0
            var generatingNow = false
            while (isActive) {
                val nowBeforeWait = System.currentTimeMillis()
                val tickMs =
                    if (target == "gemini" && nowBeforeWait - startedAt <= 20_000L) 500L
                    else 2_000L
                delay(tickMs)
                if (isAborted || currentQid != task.qid) return@launch

                val now = System.currentTimeMillis()
                val elapsed = now - startedAt
                val seqNow = currentStatusSeq()
                if (seqNow != lastSeq) {
                    lastSeq = seqNow
                    lastProgressAt = now
                }
                val noProgressMs = now - lastProgressAt

                if (elapsed >= timeoutMs) {
                    handleDomError("TIMEOUT", "elapsed_ms=$elapsed")
                    return@launch
                }

                if (elapsed >= 12_000L) {
                    val bot = detectBotWallQuick()
                    if (bot.first) {
                        handleDomError("BOT_BLOCKED", bot.second)
                        return@launch
                    }
                }

                val signal = probeProgressQuick()
                generatingNow = signal.generating
                if (target == "gemini" && elapsed >= 7_000L && signal.marker.isNotBlank()) {
                    val code = Regex("""code[:_](\d+)""", RegexOption.IGNORE_CASE)
                        .find(signal.marker)
                        ?.groupValues
                        ?.getOrNull(1)
                        ?.trim()
                    val errType = if (!code.isNullOrBlank()) "GEMINI_FAIL_$code" else "GEMINI_FAIL_GENERIC"
                    handleDomError(errType, signal.marker)
                    return@launch
                }
                if (signal.generating) {
                    lastProgressAt = now
                }
                if (signal.assistantLen > lastAssistantLen + 8) {
                    lastAssistantLen = signal.assistantLen
                    lastProgressAt = now
                } else if (signal.assistantLen > lastAssistantLen) {
                    lastAssistantLen = signal.assistantLen
                }

                if (elapsed >= 15_000L) {
                    val currentT = inferTargetFromUrl(web.currentUrl())
                    if (currentT.isNotBlank() && currentT != target) {
                        handleDomError("TARGET_STALL:${currentT}->${target}", web.currentUrl())
                        return@launch
                    }
                }

                if (elapsed >= 6_000L) {
                    val urlNow = web.currentUrl()
                    if (isLoginRequiredUrl(target, urlNow)) {
                        handleDomError("LOGIN_REQUIRED", urlNow)
                        return@launch
                    }
                }

                val dynamicNoProgressMs = dynamicNoProgressLimitMs(
                    target = target,
                    prompt = task.prompt,
                    baseMs = noProgressLimitMsFor(target, task.prompt),
                    elapsedMs = elapsed,
                    generating = generatingNow,
                    assistantLen = lastAssistantLen,
                    timeoutMs = timeoutMs
                )
                if (noProgressMs >= dynamicNoProgressMs) {
                    val bot = detectBotWallQuick()
                    if (bot.first) {
                        handleDomError("BOT_BLOCKED", bot.second)
                        return@launch
                    }
                    handleDomError("STALL_NO_PROGRESS", "no_status_change_ms=$noProgressMs")
                    return@launch
                }
            }
        }
    }

    private suspend fun detectBotWallQuick(): Pair<Boolean, String> {
        val d = CompletableDeferred<Pair<Boolean, String>>()
        web.detectBotWall { blocked, mark ->
            if (!d.isCompleted) d.complete(blocked to mark)
        }
        return withTimeoutOrNull(1500) { d.await() } ?: (false to "")
    }

    private data class ProgressSignal(
        val generating: Boolean = false,
        val assistantLen: Int = 0,
        val marker: String = ""
    )

    private suspend fun probeProgressQuick(): ProgressSignal {
        val d = CompletableDeferred<ProgressSignal>()
        web.detectProgressSignal { generating, assistantLen, marker ->
            if (!d.isCompleted) d.complete(
                ProgressSignal(
                    generating = generating,
                    assistantLen = assistantLen,
                    marker = marker
                )
            )
        }
        return withTimeoutOrNull(1500) { d.await() } ?: ProgressSignal()
    }

    private fun startTaskHeartbeat(qid: String) {
        taskHeartbeatJob?.cancel()
        taskHeartbeatJob = workerScope.launch {
            while (isActive && !isAborted && currentQid == qid) {
                announceStatus("running")
                delay(10_000L)
            }
        }
    }

    private fun handleAiResult(result: String) {
        val qid = currentQid ?: return
        if (isFinalizingResult) return
        isFinalizingResult = true
        val done = currentDoneCallback
        val elapsedMs = (System.currentTimeMillis() - currentAttemptStartedAtMs).coerceAtLeast(0L)
        val target = lastAiTask?.target?.lowercase()?.trim().orEmpty()
        if (qid.startsWith("HEAL_")) {
            gateway.reportLearning(lastTarget, result)
            applyHealing(result); finishTask(done)
        } else {
            stealthRetryCount = 0
            adaptiveRetryCount = 0
            gateway.sendArcResult(
                qid,
                result,
                missionId = currentMissionId,
                target = lastAiTask?.target,
                prompt = lastAiTask?.prompt
            ) { ok ->
                if (ok) {
                    recordAttemptTiming(target = target, prompt = lastAiTask?.prompt ?: "", elapsedMs = elapsedMs, success = true)
                    prefs.addContext(
                        q = "Task: $qid",
                        a = result,
                        isSuccess = true,
                        target = target,
                        sessionId = currentMissionId ?: qid
                    )
                    emitStatus("MISSION OK")
                    announceStatus("success")
                } else {
                    recordAttemptTiming(target = target, prompt = lastAiTask?.prompt ?: "", elapsedMs = elapsedMs, success = false)
                    gateway.sendArcError(
                        qid,
                        "RESULT_POST_FAIL",
                        "arc_result_send_failed",
                        missionId = currentMissionId,
                        target = lastAiTask?.target,
                        prompt = lastAiTask?.prompt
                    )
                    emitStatus("RESULT_SEND_FAIL")
                    announceStatus("error")
                }
                finishTask(done)
            }
        }
    }

    private fun isLoginRequiredUrl(target: String, url: String): Boolean {
        val u = url.lowercase()
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

    private fun isBotBlocked(type: String, data: String?): Boolean {
        val text = (type + " " + (data ?: "")).lowercase()
        val marks = listOf(
            "captcha",
            "recaptcha",
            "verify you are human",
            "checking your browser",
            "just a moment",
            "turnstile",
            "このページにアクセスしています",
            "unusual traffic",
            "access denied",
            "forbidden",
            "cloudflare",
            "bot detected",
            "security check",
            "human verification",
            "verify you are not a robot",
            "bot check"
        )
        return marks.any { text.contains(it) }
    }

    private fun handleDomError(type: String, data: String?) {
        onSystemErrorRequest?.invoke(type, data)
        val qid = currentQid ?: ""
        val isGeminiTransient = type == "GEMINI_FAIL_2" || type == "GEMINI_FAIL_13"
        if (
            isGeminiTransient &&
            currentQid != null &&
            qid != "manual" &&
            !qid.startsWith("HEAL_") &&
            stealthRetryCount < 1
        ) {
            stealthRetryCount++
            emitStatus("GEMINI_RETRY_$stealthRetryCount")
            val retryTask = lastAiTask?.copy(forceReload = true)
            if (retryTask != null) {
                web.refreshKeepingSession()
                workerScope.launch {
                    delay(1500)
                    if (!isAborted && currentQid != null) {
                        executeAiTask(retryTask)
                    }
                }
                return
            }
        }

        val maybeRecoverable = currentQid != null &&
            qid != "manual" &&
            !qid.startsWith("HEAL_") &&
            (type.contains("TIMEOUT") || type.contains("FAIL") || isBotBlocked(type, data))
        if (maybeRecoverable) {
            attemptAdaptiveRecovery(type, data) { recovered ->
                if (!recovered) {
                    handleDomErrorFallback(type, data)
                }
            }
            return
        }

        handleDomErrorFallback(type, data)
    }

    @Synchronized
    private fun shouldRunCopilotDiag(nowMs: Long): Boolean {
        if (nowMs - lastCopilotDiagAtMs < copilotDiagCooldownMs) return false
        lastCopilotDiagAtMs = nowMs
        return true
    }

    private fun triggerCopilotDiag(reason: String) {
        if (isAborted) return
        val target = inferTargetFromUrl(web.currentUrl()).ifBlank { lastTarget }
        if (target != "copilot") return
        val nowMs = System.currentTimeMillis()
        if (!shouldRunCopilotDiag(nowMs)) return
        emitStatus("COPILOT_DIAG_CAPTURE")
        webDiag.captureAndSend(reason = reason) { ok, key ->
            val tag = if (ok) "COPILOT_DIAG_SENT" else "COPILOT_DIAG_FAIL"
            emitStatus("$tag:$key")
        }
    }

    private fun handleDomErrorFallback(type: String, data: String?) {
        val qid = currentQid ?: lastAiTask?.qid ?: "SYSTEM"
        val isCopilotHardBlocked = type.contains("COPILOT_BOT_BLOCKED", ignoreCase = true)

        if (type.contains("TIMEOUT") && currentQid != null && !currentQid!!.startsWith("HEAL_")) {
            // 最終失敗時は、画面情報を結果として残してからエラー終了
            persistFallbackResult(qid, type)
        }

        if (!isCopilotHardBlocked && currentQid != null && !currentQid!!.startsWith("HEAL_") && isBotBlocked(type, data) && stealthRetryCount < 1) {
            stealthRetryCount++
            emitStatus("SAFE_RETRY_$stealthRetryCount")
            val retryTask = lastAiTask?.copy(forceReload = true)
            if (retryTask != null) {
                workerScope.launch {
                    delay(1500)
                    if (!isAborted && currentQid != null) {
                        executeAiTask(retryTask)
                    }
                }
                return
            }
        }
        if (type.contains("FAIL") &&
            currentQid != null &&
            qid != "manual" &&
            !currentQid!!.startsWith("HEAL_")
        ) {
            web.capturePageSource { html -> 
                startSelfHealing(html) 
            }
        } else {
            val elapsedMs = (System.currentTimeMillis() - currentAttemptStartedAtMs).coerceAtLeast(0L)
            val target = lastAiTask?.target?.lowercase()?.trim().orEmpty()
            recordAttemptTiming(target = target, prompt = lastAiTask?.prompt ?: "", elapsedMs = elapsedMs, success = false)
            prefs.addContext(
                q = "Task: $qid",
                a = "ERROR: $type ${data ?: ""}",
                isSuccess = false,
                target = target,
                sessionId = currentMissionId ?: qid
            )
            gateway.sendArcError(
                qid,
                type,
                data,
                missionId = currentMissionId,
                target = lastAiTask?.target,
                prompt = lastAiTask?.prompt
            )
            announceStatus("error")
            finishTask(currentDoneCallback)
        }
    }

    private fun persistFallbackResult(qid: String, reason: String) {
        web.capturePageSource { html ->
            val text = html
                .replace("\\n", " ")
                .replace("\\\"", "\"")
                .replace(Regex("\\s+"), " ")
                .take(900)
            gateway.sendArcResult(
                qid,
                "FALLBACK($reason): $text",
                missionId = currentMissionId,
                target = lastAiTask?.target,
                prompt = lastAiTask?.prompt
            )
        }
    }

    private fun attemptAdaptiveRecovery(type: String, data: String?, onDone: (Boolean) -> Unit) {
        val task = lastAiTask
        if (task == null || adaptiveRetryCount >= 2) {
            onDone(false)
            return
        }
        if (!prefs.consultGatewayEnabled) {
            val fallback = ScreenDecision("RETRY", note = "consult_disabled")
            executeDecision(fallback, task, onDone)
            return
        }

        emitStatus("SCREEN_ANALYZE")
        web.captureBitmap { bmp ->
            val image = bitmapToBase64(bmp)
            web.capturePageSource { html ->
                val problem = buildString {
                    append("reason=").append(type)
                    if (!data.isNullOrBlank()) append(", data=").append(data.take(600))
                    append("\npage=").append(html.take(2500))
                    append("\nReturn JSON only: {\"action\":\"RETRY|CLICK_UNBLOCK|REFRESH|WAIT|ESCALATE\",\"note\":\"short\"}")
                }
                gateway.consultGateway("ARC_SCREEN_DECISION", problem, image) { advice ->
                    val decision = decodeDecision(advice)
                    executeDecision(decision, task, onDone)
                }
            }
        }
    }

    private fun decodeDecision(advice: String): ScreenDecision {
        if (advice.isBlank()) return ScreenDecision("RETRY", note = "empty_advice")
        try {
            val obj = JSONObject(advice)
            val action = obj.optString("action", "").uppercase()
            if (action.isNotBlank()) return ScreenDecision(action, obj.optString("note", "json"))
        } catch (_: Exception) {}

        val lower = advice.lowercase()
        return when {
            lower.contains("cookie") || lower.contains("consent") || lower.contains("同意") -> ScreenDecision("CLICK_UNBLOCK", note = "consent")
            lower.contains("refresh") || lower.contains("reload") || lower.contains("再読み込み") -> ScreenDecision("REFRESH", note = "refresh")
            lower.contains("switch") && lower.contains("gemini") -> ScreenDecision("RETRY", note = "target_switch_blocked")
            lower.contains("switch") && lower.contains("chatgpt") -> ScreenDecision("RETRY", note = "target_switch_blocked")
            lower.contains("switch") && lower.contains("copilot") -> ScreenDecision("RETRY", note = "target_switch_blocked")
            lower.contains("captcha") || lower.contains("login") || lower.contains("認証") -> ScreenDecision("ESCALATE", note = "blocked")
            lower.contains("wait") || lower.contains("待機") -> ScreenDecision("WAIT", note = "wait")
            else -> ScreenDecision("RETRY", note = "fallback")
        }
    }

    private fun executeDecision(decision: ScreenDecision, task: ArcTask.AI, onDone: (Boolean) -> Unit) {
        adaptiveRetryCount++
        emitStatus("SCREEN_ACTION:${decision.action}")

        when (decision.action) {
            "CLICK_UNBLOCK" -> {
                web.attemptUiUnblock { clicked ->
                    if (!clicked) {
                        onDone(false)
                        return@attemptUiUnblock
                    }
                    workerScope.launch {
                        delay(1200)
                        if (!isAborted && currentQid != null) executeAiTask(task.copy(forceReload = false))
                    }
                    onDone(true)
                }
            }
            "REFRESH" -> {
                web.refreshKeepingSession()
                workerScope.launch {
                    delay(2200)
                    if (!isAborted && currentQid != null) executeAiTask(task.copy(forceReload = false))
                }
                onDone(true)
            }
            // target切替はGateway側の明示failoverのみ許可する
            "SWITCH_TARGET" -> {
                workerScope.launch {
                    delay(1000)
                    if (!isAborted && currentQid != null) executeAiTask(task.copy(forceReload = false))
                }
                onDone(true)
            }
            "WAIT" -> {
                workerScope.launch {
                    delay(2500)
                    if (!isAborted && currentQid != null) executeAiTask(task.copy(forceReload = false))
                }
                onDone(true)
            }
            "RETRY" -> {
                workerScope.launch {
                    delay(1000)
                    if (!isAborted && currentQid != null) executeAiTask(task.copy(forceReload = false))
                }
                onDone(true)
            }
            else -> {
                gateway.sendArcError(
                    currentQid ?: "SYSTEM",
                    "SCREEN_BLOCKED",
                    decision.note,
                    missionId = currentMissionId,
                    target = lastAiTask?.target,
                    prompt = lastAiTask?.prompt
                )
                onDone(false)
            }
        }
    }

    private fun currentRecoveryTarget(): String {
        val t = when (lastAiTask?.target?.lowercase()?.trim().orEmpty()) {
            "claude" -> "copilot"
            else -> lastAiTask?.target?.lowercase()?.trim().orEmpty()
        }
        if (t == "chatgpt" || t == "gemini" || t == "copilot") return t
        val fallback = when (lastTarget.lowercase().trim()) {
            "claude" -> "copilot"
            else -> lastTarget.lowercase().trim()
        }
        if (fallback == "chatgpt" || fallback == "gemini" || fallback == "copilot") return fallback
        return "gemini"
    }

    private fun startSelfHealing(html: String) {
        val target = currentRecoveryTarget()
        emitStatus("REPAIRING:$target")
        val expertPrompt = "Extract selector from HTML:\n$html"
        val healingTask = ArcTask.AI(
            qid = "HEAL_$currentQid",
            target = target,
            prompt = expertPrompt,
            isSelfHealing = true
        )
        executeAiTask(healingTask)
    }

    private fun startExpertHealing(data: String) {
        val target = currentRecoveryTarget()
        emitStatus("ESCALATING:$target")
        executeAiTask(
            ArcTask.AI(
                qid = "HEAL_$currentQid",
                target = target,
                prompt = "Fix this precision fragment:\n$data",
                isSelfHealing = true
            )
        )
    }

    private fun applyHealing(res: String) {
        val match = Regex("""(\.[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+|\[[^\]]+\])""").find(res)
        match?.value?.let { selector ->
            if (validateSelector(selector)) {
                updateSelectorForFailure(selector)
                emitStatus("LEARNED")
            }
        }
    }

    private fun updateSelectorForFailure(selector: String) {
        val target = lastTarget.lowercase()
        when (lastFailedType) {
            "input" -> when (target) {
                "gemini" -> if (!prefs.isGeminiLocked) prefs.geminiInputSelector = selector
                "chatgpt" -> if (!prefs.isChatGptLocked) prefs.chatGptInputSelector = selector
                "copilot" -> if (!prefs.isCopilotLocked) prefs.copilotInputSelector = selector
                else -> prefs.updateSelectorFor(target, selector)
            }
            "send" -> when (target) {
                "gemini" -> if (!prefs.isGeminiLocked) prefs.geminiSendSelector = selector
                "chatgpt" -> if (!prefs.isChatGptLocked) prefs.chatGptSendSelector = selector
                "copilot" -> if (!prefs.isCopilotLocked) prefs.copilotSendSelector = selector
                else -> prefs.updateSelectorFor(target, selector)
            }
            else -> prefs.updateSelectorFor(target, selector)
        }
    }

    fun announceStatus(status: String, onInstruction: ((JSONObject) -> Unit)? = null) {
        val currentUrl = web.currentUrl()
        val currentHost = web.currentHost()
        val inferredTarget = inferTargetFromUrl(currentUrl).ifBlank { lastTarget }
        val instructionHandler = onInstruction ?: onGatewayInstruction
        val json = JSONObject().apply {
            put("mode", "arc_heartbeat"); put("status", status)
            put("ip", Util.getLocalIpAddress()); put("target", lastTarget); put("mission", currentMissionId ?: "NONE")
            put("mission_id", currentMissionId ?: "")
            put("qid", currentQid ?: "")
            put("hud_seq", currentStatusSeq())
            put("current_target", inferredTarget)
            put("current_url", currentUrl)
            put("current_host", currentHost)
            put("current_title", web.currentTitle())
            put("port", MainActivity.serverPort); put("version", ArcCore.VERSION)
            put("worker_id", prefs.workerId)
            put("executor", "ARC")
        }
        workerScope.launch {
            gateway.sendHeartbeat(json.toString()) { instruction ->
                instructionHandler?.invoke(instruction)
            }
        }
    }

    private fun inferTargetFromUrl(url: String): String {
        val u = url.lowercase()
        return when {
            u.contains("chatgpt.com") -> "chatgpt"
            u.contains("gemini.google.com") -> "gemini"
            u.contains("copilot.microsoft.com") || u.contains("bing.com/chat") || u.contains("claude.ai") -> "copilot"
            else -> ""
        }
    }

    private fun finishTask(d: (() -> Unit)?) {
        val wasQid = currentQid ?: ""
        currentQid = null
        if (!wasQid.startsWith("PIPE_")) {
            currentMissionId = null
        }
        currentDoneCallback = null
        isFinalizingResult = false
        d?.invoke()
    }
    private fun executeVisionTask(t: ArcTask.VisionRequest) { 
        val done = currentDoneCallback
        web.captureBitmap { b -> visionClient.ask(bitmap = b, prompt = "Find ${t.action}") { x, y -> t.onResult(x, y); finishTask(done) } } 
    }
    private fun buildFinalPrompt(t: ArcTask.AI): String {
        // ARC UI からの手動送信は、入力した文面をそのまま送る
        if (t.qid == "manual") return t.prompt
        // コード生成タスクでは過去ログ混入を避ける
        if (looksLikeCodeTask(t.prompt)) {
            return "依頼: ${t.prompt}"
        }
        val context = prefs.getContextForPrompt(
            prompt = t.prompt,
            includeFailures = true,
            maxItems = 7,
            maxChars = 1400
        ).take(1400)
        return "$context\n\n依頼: ${t.prompt}"
    }

    private fun looksLikeCodeTask(prompt: String): Boolean {
        val p = prompt.lowercase()
        val marks = listOf(
            "kotlin", "python", "javascript", "typescript", "java", "go", "rust", "c++", "c#", "swift",
            "コード", "実装", "関数", "class", "method", "algorithm", "api", "sql", "テスト", "unit test"
        )
        return marks.any { p.contains(it) }
    }
    private fun bitmapToBase64(b: Bitmap) = ByteArrayOutputStream().let { o -> b.compress(Bitmap.CompressFormat.JPEG, 70, o); Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP) }
}
