package com.arc

import kotlinx.coroutines.*

/**
 * Phase 6: Market Research & Code Generation Pipeline
 */
class AppDeploymentPipeline(
    private val prefs: Prefs,
    private val requestExecution: (target: AiTarget, prompt: String, missionId: String, qid: String) -> Unit,
    private val onFinalResult: (String, String, Boolean) -> Unit
) {
    private var pipelineActive = false
    private var missionId = ""
    private var originalPrompt = ""
    private var qid = ""
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var pipelineJob: Job? = null
    private var resultDeferred: CompletableDeferred<String>? = null

    fun start(task: ArcTask.AppDeployment, onComplete: () -> Unit) {
        pipelineJob?.cancel()
        pipelineActive = true
        this.originalPrompt = task.prompt
        this.missionId = task.missionId
        this.qid = task.qid

        pipelineJob = scope.launch {
            try {
                // Phase 1: Market Research (Scraping)
                Util.trace(missionId, Util.Level.SUMMARY, "APP_DEPLOY_START", "Starting AppDeploymentPipeline with Market Research")
                val researchPrompt = """
                    [SYSTEM INSTRUCTION]
                    以下のアプリ作成・改修要件について、まずはコーディングを行わずに「要件定義・市場調査」のみを行え。
                    このアプリ要件を満たす市販のシステムや競合アプリをウェブ検索し、主要な機能、UIレイアウト、使いやすさ（UX）の工夫点を徹底的に抽出しろ。
                    結果はマークダウン形式で「いいとこ取り仕様書」としてまとめ出力せよ。
                    ※絶対にコード自体は書かないこと。
                    
                    [元の要件]
                    ${originalPrompt.take(1500)}
                """.trimIndent()

                val researchResult = executeViaCommandCenter(AiTarget.GEMINI, researchPrompt, "RESEARCH_${System.currentTimeMillis()}")
                val researchOutput = researchResult ?: "No research result obtained."
                Util.trace(missionId, Util.Level.SUMMARY, "MARKET_RESEARCH_DONE", "Market Research finished (length=${researchOutput.length})")

                // Phase 2: Generation using Research Context
                val generationPrompt = """
                    ${originalPrompt}
                    
                    =======================================
                    【追加コンテキスト：市場調査に基づく最強の仕様】
                    以下の市場調査・要件定義結果をUIや機能の設計に最大限取り入れ、市販レベルの高品質なコードを出力せよ。
                    
                    ${researchOutput.take(2500)}
                """.trimIndent()
                
                Util.trace(missionId, Util.Level.THOUGHT, "GENERATE_CODE", "Injecting researched context into generator")
                val codeResult = executeViaCommandCenter(AiTarget.GEMINI, generationPrompt, "GEN_$qid")

                if (codeResult != null && codeResult.isNotBlank()) {
                    // Deployment will be done via Gateway / GAS API in later steps
                    // For now, we return the generated code to the Gateway
                    dispatchFinal(codeResult, true)
                } else {
                    dispatchFinal("Error: Failed to generate code.", false)
                }

            } catch (e: Exception) {
                if (e !is CancellationException) {
                    Util.trace(missionId, Util.Level.CRITICAL, "APP_DEPLOY_FAIL", "Pipeline failed: ${e.message}")
                    dispatchFinal("Error: Pipeline aborted", false)
                }
            } finally {
                pipelineActive = false
                onComplete()
            }
        }
    }

    private suspend fun executeViaCommandCenter(target: AiTarget, prompt: String, stepQid: String): String? {
        resultDeferred = CompletableDeferred()
        requestExecution(target, prompt, missionId, stepQid)
        return withTimeoutOrNull(150_000) {
            resultDeferred?.await()
        }
    }

    fun onAiResult(text: String) {
        resultDeferred?.complete(text)
    }

    private fun dispatchFinal(text: String, success: Boolean) {
        onFinalResult(missionId, text, success)
    }
}
