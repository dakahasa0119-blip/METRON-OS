package com.arc

import android.graphics.Bitmap
import android.util.Base64
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.util.*
import org.json.JSONObject

/**
 * 司令部(ArcWorker)と神経系を完全に統合し、全工程をフルログ管理する最強の知能ユニット (v24.0 - Neural Orchestrated)
 */
class AllAiPipeline(
    private val prefs: Prefs,
    // 司令部への実行依頼 (missionId を伝搬させる)
    private val requestExecution: (target: AiTarget, prompt: String, missionId: String) -> Unit,
    private val onFinalResult: (String, String, Boolean) -> Unit,
    private val hallucinationPipeline: HallucinationPipeline,
    private val requestVisionSolve: (action: String, onSolved: (Int, Int) -> Unit) -> Unit,
    private val consultGateway: (context: String, problem: String, image: String?, callback: (String) -> Unit) -> Unit,
    private val captureBitmap: (onReady: (Bitmap) -> Unit) -> Unit
) {

    private val results = mutableListOf<String>()
    private var resultDeferred: CompletableDeferred<String>? = null
    private var pageLoadDeferred: CompletableDeferred<Unit>? = null
    private var currentPrompt = ""
    private var missionId = ""
    private var gatewayMissionId = "AUTO"
    private var gatewayAdvice = ""
    private var pipelineActive = false
    private var finalDispatched = false
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var pipelineJob: Job? = null

    fun start(prompt: String, gatewayMissionId: String, onComplete: () -> Unit) {
        pipelineJob?.cancel()
        pipelineActive = true
        this.currentPrompt = prompt
        this.gatewayMissionId = if (gatewayMissionId.isBlank()) "AUTO" else gatewayMissionId
        this.missionId = "MISS_" + System.currentTimeMillis()
        this.results.clear()
        this.finalDispatched = false
        
        Util.trace(missionId, Util.Level.SUMMARY, "MISSION_INIT", "Mission Start: Neural coordination active.")

        pipelineJob = scope.launch {
            try {
                // 1. 🧠 [知能相談] Gatewayの知恵を借りる
                Util.expect(missionId, "ADVICE_RECEIVED", 30000)
                fetchVisualGatewayAdvice()

                // 2. 🚀 [統合リレー] 司令部を介した実行連鎖
                // Copilot は bot/challenge で停止しやすいため、ALL は安定2系統で完走させる。
                val targets = listOf(AiTarget.GEMINI, AiTarget.CHATGPT)
                for (target in targets) {
                    if (!pipelineActive) break
                    
                    val stepId = "EXEC_${target.name}"
                    Util.expect(missionId, stepId, 120000)
                    
                    Util.trace(missionId, Util.Level.THOUGHT, "STEP_START", "Requesting execution for ${target.name}")
                    val orchestratedPrompt = buildAdaptivePrompt(results.size, results, target.name)
                    
                    // 🛡️ 司令部(ArcWorker)に依頼し、結果を確実に待機
                    val res = executeViaCommandCenter(target, orchestratedPrompt)
                    
                    if (res != null && isResponseQualityGood(res)) {
                        Util.trace(missionId, Util.Level.SUMMARY, stepId, "Successful result from ${target.name}")
                        results.add(sanitizeOutput(res))
                    } else {
                        Util.trace(missionId, Util.Level.SUMMARY, "${stepId}_SKIP", "Skipping bad response from ${target.name}")
                    }
                }

                // 3. [最終統合]
                if (pipelineActive) {
                    if (results.isNotEmpty()) {
                        Util.expect(missionId, "SYNTHESIS_COMPLETE", 150000)
                        finalizePipelineSuspending()
                    } else {
                        dispatchFinal("Error: No valid outputs from ALL pipeline", false)
                    }
                }

            } catch (e: Exception) {
                Util.trace(missionId, Util.Level.CRITICAL, "PIPELINE_ANOMALY", "Exception: ${e.message}")
                if (e !is CancellationException) dispatchFinal("Mission Failure", false)
            } finally {
                Util.checkAnomalies(missionId) 
                if (!finalDispatched) {
                    dispatchFinal("Error: Pipeline aborted", false)
                }
                pipelineActive = false
                onComplete()
                Util.trace(missionId, Util.Level.SUMMARY, "MISSION_END", "Mission sequence finished.")
            }
        }
    }

    /**
     * 🚀 司令部(ArcWorker)への実行依頼と、完了シグナルの待機を同期
     */
    private suspend fun executeViaCommandCenter(target: AiTarget, prompt: String): String? {
        resultDeferred = CompletableDeferred() 
        requestExecution(target, prompt, gatewayMissionId)
        
        // ArcWorker からの onAiResult 信号を待機 (最大110秒)
        return withTimeoutOrNull(110000) {
            resultDeferred?.await()
        }
    }

    /**
     * 🚀 [神経接点] 司令部からの全回答を、待機中の各フェーズへ正確に届ける
     */
    fun onAiResult(text: String) {
        if (hallucinationPipeline.isProcessing) {
            hallucinationPipeline.handleResult(text)
        } else {
            resultDeferred?.complete(text)
        }
    }
    
    fun onPageFinished() { 
        pageLoadDeferred?.complete(Unit) 
    }

    private suspend fun fetchVisualGatewayAdvice() {
        val imageB64 = withContext(Dispatchers.Main) {
            val d = CompletableDeferred<String?>()
            captureBitmap { bmp ->
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, 70, out)
                d.complete(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
            }
            d.await()
        }
        val adviceDeferred = CompletableDeferred<String>()
        consultGateway("Recon Done", "Mission: $currentPrompt", imageB64) { adviceDeferred.complete(it) }
        gatewayAdvice = withTimeoutOrNull(20000) { adviceDeferred.await() } ?: ""
        if (gatewayAdvice.isNotEmpty()) Util.trace(missionId, Util.Level.SUMMARY, "ADVICE", "Strategy acquired.")
    }

    private fun isResponseQualityGood(res: String): Boolean {
        val lowerPrompt = currentPrompt.lowercase()
        val expectsShort = lowerPrompt.contains("のみ返答") ||
            lowerPrompt.contains("だけ返答") ||
            lowerPrompt.contains("only reply") ||
            lowerPrompt.contains(" ok")
        val minLen = if (expectsShort) 2 else 30
        return res.trim().length >= minLen && !res.lowercase().contains("access denied")
    }
    
    private fun buildAdaptivePrompt(count: Int, prev: List<String>, name: String): String {
        val context = if (prev.isNotEmpty()) "\n[Prev Result: ${prev.last().take(300)}...]" else ""
        return "You are $name. Strategy: $gatewayAdvice\n${prefs.getFormattedContext()}$context\nRequest: $currentPrompt"
    }

    private fun sanitizeOutput(input: String) = input.replace(Regex("^(はい、|承知).*?\\n", RegexOption.IGNORE_CASE), "").trim()

    private suspend fun finalizePipelineSuspending() {
        val d = CompletableDeferred<String>()
        hallucinationPipeline.process(currentPrompt, results) { d.complete(it) }
        val final = withTimeoutOrNull(120000) { d.await() }
        val text = final ?: "Failed to synthesize."
        val ok = text.isNotBlank() &&
            !text.startsWith("Error:", ignoreCase = true) &&
            !text.contains("failed to synthesize", ignoreCase = true)
        if (ok) Util.trace(missionId, Util.Level.SUMMARY, "COMPLETE", "Final synthesis success.")
        dispatchFinal(text, ok)
    }

    private fun dispatchFinal(text: String, success: Boolean) {
        if (finalDispatched) return
        finalDispatched = true
        onFinalResult(gatewayMissionId, text, success)
    }

    fun stop() { pipelineActive = false; pipelineJob?.cancel(); resultDeferred?.cancel(); pageLoadDeferred?.cancel() }
}
