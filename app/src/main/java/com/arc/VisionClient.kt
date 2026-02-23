package com.arc

import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.*

/**
 * 画面キャプチャを解析し、要素の座標を特定するAIクライアント
 */
class VisionClient(private val gasVisionUrl: String) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun ask(
        bitmap: Bitmap,
        prompt: String,
        callback: (Int, Int) -> Unit
    ) {
        scope.launch {
            try {
                val base64 = bitmapToBase64(bitmap)
                val payload = JSONObject().apply {
                    put("mode", "vision")
                    put("prompt", prompt)
                    put("image", base64)
                }.toString()

                val conn = URL(gasVisionUrl).openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true

                OutputStreamWriter(conn.outputStream).use { it.write(payload) }

                val response = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(response)
                withContext(Dispatchers.Main) { callback(json.optInt("x", 0), json.optInt("y", 0)) }

            } catch (e: Exception) {
                Log.e("VisionClient", "Vision Analysis Error: ${e.message}")
                withContext(Dispatchers.Main) { callback(0, 0) }
            }
        }
    }

    private fun bitmapToBase64(bitmap: Bitmap): String {
        val outputStream = ByteArrayOutputStream() // タイポ baos を修正
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, outputStream)
        return Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
    }
}
