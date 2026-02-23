package com.arc

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.Gravity
import android.widget.FrameLayout
import com.arc.databinding.DebugHudBinding

/**
 * 運用状況をリアルタイムに表示するHUD (v5.2 - Dynamic & Integrated)
 * DataBindingを使用しつつ、動的な追加(attach)機能も保持・統合。
 */
class DebugHud {

    private var binding: DebugHudBinding? = null
    private val prefs: Prefs
    private var isPipelineActive: Boolean = false
    private var lastLog: String = "準備完了"

    // 1. XML(include)ですでに配置されている場合に使用するコンストラクタ
    constructor(binding: DebugHudBinding, prefs: Prefs) {
        this.binding = binding
        this.prefs = prefs
        refreshDisplay()
    }

    // 2. 動的にActivityへ追加したい場合に使用するコンストラクタ
    constructor(activity: Activity, prefs: Prefs) {
        this.prefs = prefs
        // DataBinding を使って動的にインフレートし、Activityの最前面に追加
        val inflater = LayoutInflater.from(activity)
        val hudBinding = DebugHudBinding.inflate(inflater)
        this.binding = hudBinding

        val params = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            topMargin = 200 // 他のUIとの重なりを避ける
            marginEnd = 20
        }
        
        // Activityのルートコンテナを取得して追加
        val root = activity.findViewById<FrameLayout>(android.R.id.content)
        root.addView(hudBinding.root, params)
        refreshDisplay()
    }

    fun update(status: String) {
        when (status) {
            "ALL_START" -> isPipelineActive = true
            "ALL_DONE" -> isPipelineActive = false
        }
        this.lastLog = translateStatus(status)
        refreshDisplay()
    }

    private fun translateStatus(status: String): String {
        return when {
            status == "ALL_START" -> "🚀 全AI一括実行を開始します..."
            status == "ALL_DONE" -> "🏁 すべての統合処理が完了しました"
            status.startsWith("LOADING") -> "🌐 ページにアクセスしています..."
            status == "INJECTING_PROMPT" -> "✍️ 質問を注入しています..."
            status == "WAITING_FOR_RESPONSE" -> "👀 AIの回答を待っています..."
            status == "EXTRACTING..." -> "📝 回答を抽出しています..."
            status == "GEN_DONE" -> "✅ 処理が完了しました"
            status == "PAGE_READY" -> "🟢 ページの準備が整いました"
            status == "AI: BUSY" -> "✨ AIが生成中です..."
            status == "AI: READY" -> "待機中"
            status.contains("SELF_HEALING") -> "🔧 自己修復モード実行中..."
            status.contains("LEARNED") -> "💡 セレクタを学習しました"
            status.startsWith("ERR:") -> "❗ エラー: ${status.removePrefix("ERR:")}"
            else -> "🤖 $status"
        }
    }

    private fun refreshDisplay() {
        val slotNum = prefs.selectedSlotIndex + 1
        val modeName = if (isPipelineActive) "全AI一括実行" else "通常タスク実行"
        val gasStatus = if (prefs.gasUrl.isNotEmpty()) "連携中" else "未設定"

        val info = """
            【スロット】 $slotNum | 【モード】 $modeName
            【外部連携】 $gasStatus
            【状況】 $lastLog
        """.trimIndent()

        render(info)
    }

    private fun render(text: String) {
        Handler(Looper.getMainLooper()).post {
            binding?.debugHudText?.text = text
        }
    }
}
