package com.arc

import android.webkit.JavascriptInterface

/**
 * JavaScript からの呼び出しを Android 側に中継するブリッジクラス
 */
@Suppress("unused")
class JsBridge(
    private val onAiResultCallback: (String) -> Unit,
    private val onDomErrorCallback: (String, String?) -> Unit, // 引数を2つに変更
    private val onAutoDomCallback: (String) -> Unit,
    private val onHeartbeatCallback: () -> Unit,
    private val onPickedCallback: (String) -> Unit,
    private val onGenerationDoneCallback: () -> Unit = {},
    private val onVisionRequestCallback: (String) -> Unit = {}
) {

    @JavascriptInterface
    fun postMessage(text: String) {
        onAiResultCallback(text)
    }

    @JavascriptInterface
    fun domError(type: String) {
        onDomErrorCallback(type, null) // 第2引数にnullを渡す
    }

    @JavascriptInterface
    fun domError(type: String, data: String) {
        onDomErrorCallback(type, data)
    }

    // 画像付きエラー通知用
    @JavascriptInterface
    fun domErrorWithImage(type: String, imageData: String) {
        onDomErrorCallback(type, imageData)
    }

    @JavascriptInterface
    fun autoDom(json: String) {
        onAutoDomCallback(json)
    }

    @JavascriptInterface
    fun heartbeat() {
        onHeartbeatCallback()
    }

    @JavascriptInterface
    fun onPicked(selector: String) {
        onPickedCallback(selector)
    }

    @JavascriptInterface
    fun onGenerationDone() {
        onGenerationDoneCallback()
    }

    @JavascriptInterface
    fun onVisionRequest(reason: String) {
        onVisionRequestCallback(reason)
    }
}
