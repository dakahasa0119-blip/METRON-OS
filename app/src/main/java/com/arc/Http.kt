package com.arc

import android.util.Log
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.pow

/**
 * 通信ユーティリティ
 * 指数バックオフによる自動リトライ機能を搭載 (v2.0 - Coroutine Safe)
 */
object Http {

    /**
     * suspend 版 POST（Coroutine 内から呼ぶ推奨メソッド）
     * Thread.sleep の代わりに delay を使用し、Coroutine キャンセルに対応。
     */
    suspend fun post(urlStr: String, json: String, maxRetries: Int = 3): String {
        var lastException: Exception? = null
        
        for (attempt in 1..maxRetries) {
            try {
                return withContext(Dispatchers.IO) {
                    executePost(urlStr, json)
                }
            } catch (e: Exception) {
                lastException = e
                Log.w("Http", "Attempt $attempt failed: ${e.message}")
                
                if (attempt < maxRetries) {
                    // 指数バックオフ: 2秒, 4秒, 8秒... と待機時間を増やす
                    val waitTime = (2.0.pow(attempt.toDouble()) * 1000).toLong()
                    delay(waitTime) // Thread.sleep → delay (Coroutine対応)
                }
            }
        }
        
        Log.e("Http", "All $maxRetries attempts failed for $urlStr")
        return """{"status":"ERROR","message":"${lastException?.message}"}"""
    }

    private fun executePost(urlStr: String, json: String, redirectCount: Int = 0): String {
        if (redirectCount > 5) {
            throw IllegalStateException("Too many redirects for $urlStr")
        }
        val url = URL(urlStr)
        val conn = url.openConnection() as HttpURLConnection

        conn.requestMethod = "POST"
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
        conn.doOutput = true
        conn.connectTimeout = 15000 // 15秒
        conn.readTimeout = 15000

        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
            it.write(json)
        }

        val code = conn.responseCode
        if (code in 300..399) {
            val location = conn.getHeaderField("Location")
            if (!location.isNullOrBlank()) {
                Log.d("Http", "Redirect($code): $urlStr -> $location")
                conn.disconnect()
                return if (code == HttpURLConnection.HTTP_MOVED_TEMP ||
                    code == HttpURLConnection.HTTP_MOVED_PERM ||
                    code == HttpURLConnection.HTTP_SEE_OTHER) {
                    // Apps Script WebApp の 302/303 は結果取得用URL。GETで追従しないとHTMLへ迷子になる。
                    executeGet(location, redirectCount + 1)
                } else {
                    // 307/308 はメソッド維持
                    executePost(location, json, redirectCount + 1)
                }
            }
        }

        val response = if (code in 200..299) {
            conn.inputStream.bufferedReader().use(BufferedReader::readText)
        } else {
            conn.errorStream?.bufferedReader()?.use(BufferedReader::readText) ?: "HTTP $code"
        }

        Log.d("Http", "POST Success: $urlStr")
        return response
    }

    private fun executeGet(urlStr: String, redirectCount: Int = 0): String {
        if (redirectCount > 5) {
            throw IllegalStateException("Too many redirects for $urlStr")
        }
        val url = URL(urlStr)
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 15000
        conn.readTimeout = 15000

        val code = conn.responseCode
        if (code in 300..399) {
            val location = conn.getHeaderField("Location")
            if (!location.isNullOrBlank()) {
                Log.d("Http", "Redirect($code): $urlStr -> $location")
                conn.disconnect()
                return executeGet(location, redirectCount + 1)
            }
        }

        val response = if (code in 200..299) {
            conn.inputStream.bufferedReader().use(BufferedReader::readText)
        } else {
            conn.errorStream?.bufferedReader()?.use(BufferedReader::readText) ?: "HTTP $code"
        }
        Log.d("Http", "GET Success: $urlStr")
        return response
    }
}
