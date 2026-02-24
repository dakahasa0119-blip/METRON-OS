package com.arc

import android.util.Log
import kotlinx.coroutines.*

/**
 * 複数AIの結果を統合し、ハルシネーションを抑制する
 * v5.1: ifBlank への置換と接続性の改善
 */
class HallucinationPipeline(
    private val prefs: Prefs,
    private val injectPrompt: (AiTarget, String, String) -> Unit
) {

    private var onDone: ((String) -> Unit)? = null
    private var summaryBuffer = ""
    private var originalPrompt = ""
    private var missionId = ""

    var isProcessing = false
        private set

    private var phase = 0
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var phaseTimeoutJob: Job? = null
    private var injectionJob: Job? = null

    private fun startPhaseTimeout() {
        phaseTimeoutJob?.cancel()
        phaseTimeoutJob = scope.launch {
            delay(60000)
            Log.w("ARC_PIPELINE", "⚠️ Hallucination phase $phase timed out. Forcing completion...")
            finalizeWithLastAvailable()
        }
    }

    fun process(prompt: String, missionId: String, results: List<String>, callback: (String) -> Unit) {
        this.originalPrompt = prompt
        this.missionId = missionId
        this.onDone = callback
        this.isProcessing = true
        this.phase = 0

        val combined = results.joinToString("\n\n---\n\n")
        
        // 🛠️ ifBlank を使用して簡略化
        val template = prefs.summaryPrompt.ifBlank { "以下の複数のAI回答を統合し、最も正確で一貫性のある回答を作成してください：\n\n{CONTENT}" }
        val finalPrompt = template.replace("{CONTENT}", combined)

        Log.d("ARC_HALLUCINATION", "🚀 Starting Summary Phase...")
        
        startPhaseTimeout()

        injectionJob?.cancel()
        injectionJob = scope.launch {
            delay(2000)
            if (isProcessing) injectPrompt(AiTarget.GEMINI, finalPrompt, this@HallucinationPipeline.missionId)
        }
    }

    fun handleResult(text: String) {
        if (!isProcessing) return
        phaseTimeoutJob?.cancel()
        
        when (phase) {
            0 -> handleSummary(text)
            1 -> handleFactCheck(text)
        }
    }

    private fun handleSummary(text: String) {
        summaryBuffer = text
        phase = 1

        Log.d("ARC_HALLUCINATION", "🔍 Starting Fact Check Phase...")
        // Copilot は bot/challenge 影響を受けやすいため、最終検証は ChatGPT 側で実施
        
        val factCheckPrompt = """
            以下の内容に事実誤認や矛盾がないか最終確認し、必要なら修正して完成させてください。
            (重要: 誤りがない場合はそのまま出力し、誤りがある場合のみ修正せよ)
            
            $summaryBuffer
        """.trimIndent()

        startPhaseTimeout()

        injectionJob?.cancel()
        injectionJob = scope.launch {
            delay(2000)
            if (isProcessing) injectPrompt(AiTarget.CHATGPT, factCheckPrompt, this@HallucinationPipeline.missionId)
        }
    }

    private fun handleFactCheck(text: String) {
        complete(text)
    }

    private fun finalizeWithLastAvailable() {
        if (summaryBuffer.isNotEmpty()) {
            complete(summaryBuffer)
        } else {
            complete("Error: Hallucination pipeline failed")
        }
    }

    private fun complete(finalText: String) {
        isProcessing = false
        phaseTimeoutJob?.cancel()
        injectionJob?.cancel()
        
        if (finalText.length > 10 && !isCodeTask(originalPrompt)) {
            prefs.addContext(
                q = originalPrompt,
                a = finalText,
                isSuccess = true,
                target = "hallucination",
                sessionId = missionId
            )
        }

        onDone?.invoke(finalText)
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
}
