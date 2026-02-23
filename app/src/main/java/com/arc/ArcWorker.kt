package com.arc

import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
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
    private val workerScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val visionClient by lazy { VisionClient(prefs.gasUrl) }
    
    var currentQid: String? = null
    var currentMissionId: String? = null
    private var isAborted = false
    private var lastTarget: String = ""
    private var lastFailedSelector: String = ""
    private var lastFailedType: String = ""

    // 🚀 [統合信号系]
    var onGlobalAiResult: ((String) -> Unit)? = null
    var onSystemStatusUpdate: ((String) -> Unit)? = null
    var onSystemErrorRequest: ((String, String?) -> Unit)? = null 
    
    private var currentDoneCallback: (() -> Unit)? = null
    private var timeoutJob: Job? = null

    init {
        // 🚀 現場(WebView)からの全信号を掌握し、ミッション文脈に合わせてルーティング
        web.onAiResult = { result ->
            if (!isAborted) {
                onGlobalAiResult?.invoke(result)
                if (currentQid != null) {
                    cancelActiveJobs()
                    handleAiResult(result)
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
                onSystemStatusUpdate?.invoke("GEN_READY")
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
                    handleDomError(type, data)
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
        onSystemStatusUpdate?.invoke("CONSULTING BRAIN...")
        gateway.consultGateway("Failed at $lastFailedSelector", precisionData) { advice ->
            if (advice.isNullOrBlank()) {
                startExpertHealing(precisionData)
                return@consultGateway
            }
            
            when {
                // 🧬 コードパッチなら自己進化プロセスへ
                advice.contains("function") || advice.contains("arc.") -> {
                    onSystemStatusUpdate?.invoke("EVOLVING CORE...")
                    web.applyAndVerifyPatch(advice)
                }
                // 💡 セレクタなら即座に適用
                advice.startsWith(".") || advice.startsWith("#") || advice.contains("[") -> {
                    onSystemStatusUpdate?.invoke("RECOVERING...")
                    applyHealing(advice)
                }
                else -> startExpertHealing(precisionData)
            }
        }
    }

    private fun validateSelector(s: String?) = !s.isNullOrBlank() && s.length < 100 && (s.startsWith(".") || s.startsWith("#") || s.contains("["))

    private fun cancelActiveJobs() {
        timeoutJob?.cancel()
        timeoutJob = null
    }

    fun abortCurrent() { 
        isAborted = true; currentQid = null; currentDoneCallback = null
        cancelActiveJobs()
    }

    fun process(task: ArcTask, done: () -> Unit) {
        isAborted = false
        when (task) {
            is ArcTask.Pipeline -> {
                currentMissionId = task.missionId
                onSystemStatusUpdate?.invoke("MISSION START")
                announceStatus("running")
                pipelineProvider().start(task.prompt) { 
                    web.refreshProcess()
                    announceStatus("idle")
                    done() 
                }
            }
            is ArcTask.AI -> {
                currentQid = task.qid
                currentMissionId = task.missionId
                currentDoneCallback = done
                announceStatus("running")
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
        val target = task.target.lowercase()
        val parsedTarget = Util.parseTarget(target)
        val shouldLoad = lastTarget != target || task.forceReload
        lastTarget = target
        cancelActiveJobs()

        if (shouldLoad) {
            onSystemStatusUpdate?.invoke("LOADING $target")
            web.applyPersona(parsedTarget ?: AiTarget.GEMINI)
            web.webView?.post { web.webView?.loadUrl(prefs.getUrlFor(target)) }
        }

        val isReconTarget = parsedTarget == AiTarget.MOBILE_BROWSER || parsedTarget == AiTarget.FULL_BROWSER
        if (isReconTarget) {
            val done = currentDoneCallback
            val finishRecon = {
                onSystemStatusUpdate?.invoke("RECON_READY")
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
                onSystemStatusUpdate?.invoke("INJECTING...")
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
        
        timeoutJob = workerScope.launch {
            delay(60000)
            if (!isAborted && currentQid == task.qid) handleDomError("TIMEOUT", null)
        }
    }

    private fun handleAiResult(result: String) {
        val qid = currentQid ?: return
        val done = currentDoneCallback
        if (qid.startsWith("HEAL_")) {
            gateway.reportLearning(lastTarget, result)
            applyHealing(result); finishTask(done)
        } else {
            web.captureBitmap { bmp ->
                gateway.sendArcResult(qid, result, bitmapToBase64(bmp))
                prefs.addContext("Task: $qid", result)
                onSystemStatusUpdate?.invoke("MISSION OK")
                announceStatus("success")
                finishTask(done)
            }
        }
    }

    private fun handleDomError(type: String, data: String?) {
        onSystemErrorRequest?.invoke(type, data)
        if (type.contains("FAIL") && currentQid != null && !currentQid!!.startsWith("HEAL_")) {
            web.capturePageSource { html -> 
                startSelfHealing(html) 
            }
        } else {
            gateway.sendArcError(currentQid ?: "SYSTEM", type, data)
            announceStatus("error")
            finishTask(currentDoneCallback)
        }
    }

    private fun startSelfHealing(html: String) {
        onSystemStatusUpdate?.invoke("REPAIRING...")
        val expertPrompt = "Extract selector from HTML:\n$html"
        val healingTask = ArcTask.AI(qid = "HEAL_$currentQid", target = if (lastTarget == "gemini") "chatgpt" else "gemini", prompt = expertPrompt, isSelfHealing = true)
        executeAiTask(healingTask)
    }

    private fun startExpertHealing(data: String) {
        onSystemStatusUpdate?.invoke("ESCALATING...")
        executeAiTask(ArcTask.AI(qid = "HEAL_$currentQid", target = "gemini", prompt = "Fix this precision fragment:\n$data", isSelfHealing = true))
    }

    private fun applyHealing(res: String) {
        val match = Regex("""(\.[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+|\[[^\]]+\])""").find(res)
        match?.value?.let { selector ->
            if (validateSelector(selector)) {
                updateSelectorForFailure(selector)
                onSystemStatusUpdate?.invoke("LEARNED")
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

    fun announceStatus(status: String, onInstruction: (JSONObject) -> Unit = {}) {
        val json = JSONObject().apply {
            put("mode", "arc_heartbeat"); put("status", status)
            put("ip", Util.getLocalIpAddress()); put("target", lastTarget); put("mission", currentMissionId ?: "NONE")
            put("port", MainActivity.serverPort); put("version", ArcCore.VERSION)
            put("worker_id", prefs.workerId)
            put("executor", "ARC")
        }
        workerScope.launch { gateway.sendHeartbeat(json.toString(), onInstruction) }
    }

    private fun finishTask(d: (() -> Unit)?) { currentQid = null; currentDoneCallback = null; d?.invoke() }
    private fun executeVisionTask(t: ArcTask.VisionRequest) { 
        val done = currentDoneCallback
        web.captureBitmap { b -> visionClient.ask(bitmap = b, prompt = "Find ${t.action}") { x, y -> t.onResult(x, y); finishTask(done) } } 
    }
    private fun buildFinalPrompt(t: ArcTask.AI) = "${prefs.getFormattedContext()}\n\n依頼: ${t.prompt}"
    private fun bitmapToBase64(b: Bitmap) = ByteArrayOutputStream().let { o -> b.compress(Bitmap.CompressFormat.JPEG, 70, o); Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP) }
}
