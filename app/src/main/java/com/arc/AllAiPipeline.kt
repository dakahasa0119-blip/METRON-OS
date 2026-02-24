package com.arc

import android.graphics.Bitmap
import android.util.Base64
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.util.*
import org.json.JSONObject
import kotlin.math.max

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
    private data class EvalRubric(
        val codeTask: Boolean,
        val requiredTerms: List<String>,
        val preferLanguage: String
    )

    private data class EvalResult(
        val score: Int,
        val text: String
    )


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
        return res.trim().length >= minLen &&
            !res.lowercase().contains("access denied") &&
            !looksLikeContextLeak(res)
    }
    
    private fun buildAdaptivePrompt(count: Int, prev: List<String>, name: String): String {
        val context = if (prev.isNotEmpty()) "\n[Prev Result: ${prev.last().take(300)}...]" else ""
        val memory = prefs.getFormattedContext(includeFailures = false, maxSuccess = 2)
        val strict = if (isCodeTask(currentPrompt)) {
            "\n[Output Rules]\n- Return only final code.\n- Do not include operational logs or memory summaries.\n- Include all requested functions and a runnable main/example.\n"
        } else ""
        return "You are $name. Strategy: $gatewayAdvice\n$memory$context$strict\nRequest: $currentPrompt"
    }

    private fun sanitizeOutput(input: String): String {
        return input
            .replace(Regex("^(はい、|承知).*?\\n", RegexOption.IGNORE_CASE), "")
            .replace(Regex("【現場の短期記憶（直近の経緯）】[\\s\\S]*?(?=\\n\\n|$)"), "")
            .trim()
    }

    private suspend fun finalizePipelineSuspending() {
        val rubric = buildRubric(currentPrompt)
        val d = CompletableDeferred<String>()
        hallucinationPipeline.process(currentPrompt, results) { d.complete(it) }
        val final = withTimeoutOrNull(120000) { d.await() }
        val draft = normalizeFinalOutputForTask(final ?: "Failed to synthesize.")
        val repaired = if (evaluateCandidate(draft, rubric).score >= 60) draft else repairFinalOnce(draft)
        var text = chooseBestCandidate(
            listOf(
                evaluateCandidate(draft, rubric),
                evaluateCandidate(repaired, rubric)
            ) + results.map { evaluateCandidate(normalizeFinalOutputForTask(it), rubric) }
        ).text
        text = normalizeFinalOutputForTask(text)
        val finalEval = evaluateCandidate(text, rubric)
        val ok = text.isNotBlank() &&
            !text.startsWith("Error:", ignoreCase = true) &&
            !text.contains("failed to synthesize", ignoreCase = true) &&
            finalEval.score >= 55
        if (ok) Util.trace(missionId, Util.Level.SUMMARY, "COMPLETE", "Final synthesis success.")
        dispatchFinal(text, ok)
    }

    private suspend fun repairFinalOnce(draft: String): String {
        val req = currentPrompt
        val repairPrompt = """
            次の回答を、要求仕様を満たす最終版に整形してください。
            制約:
            - 余計な前置き・運用ログ・短期記憶を出さない
            - 要求仕様に不足があれば補う
            - 出力は最終回答のみ（前置き禁止）
            - コード課題ならコードだけを返す

            [要求]
            $req

            [ドラフト]
            $draft
        """.trimIndent()
        val repaired = executeViaCommandCenter(AiTarget.CHATGPT, repairPrompt)
        return normalizeFinalOutputForTask(repaired ?: draft)
    }

    private fun chooseBestCandidate(candidates: List<EvalResult>): EvalResult {
        return candidates.maxWithOrNull(
            compareBy<EvalResult> { it.score }.thenBy { it.text.length }
        ) ?: EvalResult(0, "")
    }

    private fun normalizeFinalOutputForTask(raw: String): String {
        var out = sanitizeOutput(raw)
        if (!isCodeTask(currentPrompt)) return out

        val fenced = Regex("```(?:[a-zA-Z0-9_+-]*)\\s*\\n([\\s\\S]*?)```")
            .findAll(out)
            .map { it.groupValues.getOrNull(1)?.trim().orEmpty() }
            .filter { it.isNotBlank() }
            .toList()
        if (fenced.isNotEmpty()) {
            out = fenced.maxByOrNull { it.length } ?: out
        }

        out = out.replace(Regex("^kotlin\\s*(?=//|/\\*|data\\s+class|class\\s+|fun\\s+|import\\s+)", RegexOption.IGNORE_CASE), "")
        if (!hasCodeBlockOrCodeShape(out)) {
            val markers = listOf("data class", "class ", "fun ", "import ", "object ", "interface ")
            val lines = out.lines()
            val start = lines.indexOfFirst { line ->
                markers.any { m -> line.contains(m, ignoreCase = true) }
            }
            if (start >= 0) out = lines.drop(start).joinToString("\n")
        }
        return out.trim()
    }

    private fun evaluateCandidate(rawText: String, rubric: EvalRubric): EvalResult {
        val text = normalizeFinalOutputForTask(rawText)
        if (text.isBlank()) return EvalResult(0, text)
        var score = 0

        if (!looksLikeContextLeak(text)) score += 20 else score -= 60

        if (rubric.codeTask) {
            if (hasCodeBlockOrCodeShape(text)) score += 25 else score -= 35
            if (looksLikeProsePrefix(text)) score -= 20
            if (text.length >= 120) score += 10 else score -= 10
            if (hasBalancedBrackets(text)) score += 10
        } else {
            score += 10
        }

        if (rubric.preferLanguage.isNotBlank() && text.lowercase().contains(rubric.preferLanguage)) {
            score += 5
        }

        if (rubric.requiredTerms.isNotEmpty()) {
            val lower = text.lowercase()
            val hit = rubric.requiredTerms.count { lower.contains(it.lowercase()) }
            score += (40.0 * (hit.toDouble() / rubric.requiredTerms.size.toDouble())).toInt()
        } else {
            score += 10
        }

        return EvalResult(score.coerceIn(0, 100), text)
    }

    private fun looksLikeContextLeak(text: String): Boolean {
        val lower = text.lowercase()
        return lower.contains("現場の短期記憶") ||
            lower.contains("失敗の記録") ||
            lower.contains("watchdog_timeout") ||
            lower.contains("stall_no_progress")
    }

    private fun isCodeTask(prompt: String): Boolean {
        val p = prompt.lowercase()
        return p.contains("実装") ||
            p.contains("コード") ||
            p.contains("kotlin") ||
            p.contains("python") ||
            p.contains("typescript") ||
            p.contains("java")
    }

    private fun hasCodeBlockOrCodeShape(text: String): Boolean {
        val t = text.trim()
        if (t.contains("```")) return true
        val signals = listOf("class ", "fun ", "data class", "public ", "private ", "def ", "function ")
        return signals.any { t.contains(it) }
    }

    private fun looksLikeProsePrefix(text: String): Boolean {
        val first = text.lineSequence().firstOrNull { it.isNotBlank() }?.trim() ?: return false
        val codeHead = listOf("class ", "data class", "fun ", "import ", "object ", "interface ", "//", "/*")
        if (codeHead.any { first.startsWith(it, ignoreCase = true) }) return false
        return first.contains("。") || first.contains("です") || first.contains("ます")
    }

    private fun hasBalancedBrackets(text: String): Boolean {
        fun balanceOf(open: Char, close: Char): Int {
            var n = 0
            for (c in text) {
                if (c == open) n++
                if (c == close) n--
            }
            return n
        }
        return balanceOf('{', '}') == 0 && balanceOf('(', ')') == 0
    }

    private fun buildRubric(prompt: String): EvalRubric {
        val p = prompt.lowercase()
        val codeTask = isCodeTask(prompt)
        val preferLanguage = when {
            p.contains("kotlin") -> "kotlin"
            p.contains("python") -> "python"
            p.contains("typescript") -> "typescript"
            p.contains("javascript") -> "javascript"
            p.contains("java") -> "java"
            else -> ""
        }

        val baseReq = mutableListOf<String>()
        val reqSeed = when {
            prompt.contains("要件:") -> prompt.substringAfter("要件:")
            prompt.contains("要件") -> prompt.substringAfter("要件")
            else -> prompt
        }
        reqSeed
            .replace("。", ",")
            .replace("、", ",")
            .replace("・", ",")
            .replace("\n", ",")
            .split(",")
            .map { it.trim() }
            .filter { it.length in 2..40 }
            .forEach { raw ->
                when {
                    raw.contains("data class", ignoreCase = true) -> baseReq.add("data class")
                    raw.contains("insert", ignoreCase = true) -> baseReq.add("insert")
                    raw.contains("search", ignoreCase = true) -> baseReq.add("search")
                    raw.contains("delete", ignoreCase = true) -> baseReq.add("delete")
                    raw.contains("inorder", ignoreCase = true) -> baseReq.add("inorder")
                    raw.contains("main", ignoreCase = true) -> {
                        baseReq.add("fun main")
                        baseReq.add("main(")
                    }
                }
            }
        val requiredTerms = baseReq.distinct().take(max(4, baseReq.size))
        return EvalRubric(
            codeTask = codeTask,
            requiredTerms = requiredTerms,
            preferLanguage = preferLanguage
        )
    }

    private fun dispatchFinal(text: String, success: Boolean) {
        if (finalDispatched) return
        finalDispatched = true
        onFinalResult(gatewayMissionId, text, success)
    }

    fun stop() { pipelineActive = false; pipelineJob?.cancel(); resultDeferred?.cancel(); pageLoadDeferred?.cancel() }
}
