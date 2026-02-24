package com.arc

import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.ServerSocket

/**
 * Linux (Gateway) からの高度な命令を受け付けるサーバー (v14.0 - Hardened & Auth)
 */
class LocalHttpServer(
    private val queue: ArcTaskQueue,
    private val web: WebViewManager,
    private val gateway: GatewayClient,
    private val prefs: Prefs,
    private val initialPort: Int,
    private val onRequested: () -> Unit,
    private val onExecutionRequested: () -> Unit
) : NanoHTTPD(initialPort) {

    var actualPort: Int = initialPort
        private set

    companion object {
        private val logBuffer = mutableListOf<String>()
        fun log(msg: String) {
            synchronized(logBuffer) {
                logBuffer.add("${System.currentTimeMillis()}: $msg")
                if (logBuffer.size > 100) logBuffer.removeAt(0)
            }
        }
    }

    fun safeStart() {
        var portToTry = initialPort
        var success = false
        while (!success && portToTry < initialPort + 10) {
            try {
                ServerSocket(portToTry).use { it.close() }
                actualPort = portToTry
                start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                success = true
                Log.d("ARC_HTTP", "Server started on port: $actualPort")
            } catch (_: Exception) {
                portToTry++
            }
        }
    }

    override fun serve(session: IHTTPSession): Response {
        if (session.method == Method.POST) {
            try {
                onRequested()
                val files = mutableMapOf<String, String>()
                session.parseBody(files)
                val jsonStr = files["postData"] ?: return errorResponse("No data")
                
                val obj = JSONObject(jsonStr)
                
                // 🛡️ 強化 C: ゼロタッチ・認証 (Secure Token Auth)
                // Prefs に保存されたランダム UUID トークンで認証
                val authKey = obj.optString("auth_key")
                if (authKey != prefs.authToken) {
                    Log.w("ARC_AUTH", "Unauthorized access attempt blocked.")
                    return errorResponse("Unauthorized")
                }

                val mode = obj.optString("mode")
                log("API Called: $mode")

                return when (mode) {
                    "arc_info" -> {
                        val info = JSONObject().apply {
                            put("version", "14.0-hardened")
                            put("port", actualPort)
                            put("ip", Util.getLocalIpAddress())
                            put("worker_id", prefs.workerId)
                            put("executor", "ARC")
                            put("queue_depth", queue.pendingCount())
                            put("status", "online")
                            put("auth_key", prefs.authToken)
                        }
                        newFixedLengthResponse(Response.Status.OK, "application/json", info.toString())
                    }
                    "healthz" -> {
                        val health = JSONObject().apply {
                            put("status", "ok")
                            put("queue_depth", queue.pendingCount())
                            put("port", actualPort)
                            put("version", "14.0-hardened")
                        }
                        newFixedLengthResponse(Response.Status.OK, "application/json", health.toString())
                    }
                    "request_arc" -> {
                        onExecutionRequested()
                        val qid = obj.optString("qid")
                        val targetTag = obj.optString("target").uppercase()
                        val prompt = obj.optString("prompt")

                        if (qid.isEmpty() || targetTag.isEmpty() || prompt.isEmpty()) return errorResponse("Missing params")
                        
                        if (targetTag == Util.TAG_ALL) {
                            queue.enqueue(ArcTask.Pipeline(prompt))
                        } else {
                            val target = Util.parseTarget(targetTag)
                            if (target != null) {
                                queue.enqueue(ArcTask.AI(qid, target.name, prompt))
                            } else {
                                return errorResponse("Unknown target tag: $targetTag")
                            }
                        }
                        successResponse("enqueued")
                    }
                    "arc_execute_js" -> {
                        onExecutionRequested()
                        val script = obj.optString("script")
                        web.webView?.post { web.webView?.evaluateJavascript(script, null) }
                        successResponse("injected")
                    }
                    "arc_refresh" -> {
                        onExecutionRequested()
                        // 🛡️ プロセスのリフレッシュ命令
                        web.refreshProcess()
                        successResponse("refreshing")
                    }
                    "arc_screenshot" -> {
                        web.captureBitmap { bmp: Bitmap ->
                            val out = ByteArrayOutputStream()
                            bmp.compress(Bitmap.CompressFormat.JPEG, 70, out)
                            val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                            gateway.sendArcResult(
                                qid = "manual_shot",
                                result = "screenshot_captured",
                                image = b64,
                                missionId = "manual_shot",
                                target = "gateway"
                            )
                        }
                        successResponse("capturing")
                    }
                    "gw_probe_result" -> {
                        val qid = obj.optString("qid")
                        val text = obj.optString("text", "GW_PROBE_OK")
                        if (qid.isBlank()) return errorResponse("Missing qid")
                        gateway.sendArcResult(qid = qid, result = text, missionId = qid, target = "gateway")
                        successResponse("probe_sent")
                    }
                    else -> errorResponse("Unknown mode")
                }
            } catch (e: Exception) {
                Log.e("ARC_HTTP", "Server request handling error: ${e.message}", e)
                return errorResponse("Server Error: ${e.message}")
            }
        }
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", "{}")
    }

    private fun successResponse(status: String) = 
        newFixedLengthResponse(Response.Status.OK, "application/json", """{"status":"$status"}""")

    private fun errorResponse(msg: String) = 
        newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", """{"error":"$msg"}""")
}
