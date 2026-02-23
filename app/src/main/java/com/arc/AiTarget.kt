package com.arc

/**
 * サポートされている AI およびブラウザターゲットの定義
 */
enum class AiTarget {
    GEMINI,
    CHATGPT,
    COPILOT,
    
    // 🌐 自己診断・検証用のブラウザモード
    FULL_BROWSER,   // PC版表示
    MOBILE_BROWSER, // モバイル版表示

    // 🧠 Gateway 連携知能
    GATEWAY_ADVISOR // ローカルLLM & 長期記憶への相談モード
}
