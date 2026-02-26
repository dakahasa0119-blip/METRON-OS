package com.arc

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.*
import java.util.UUID

/**
 * 外部(GAS/Gateway)との通信を統率し、フルログ整理と自動セットアップを司る (v13.5 - Zero-Touch Polished)
 */
class GatewayClient(private val prefs: Prefs) {

    private val clientScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val currentVersion = "13.6"
    private val maxInlineImageB64 = 180_000
    var telemetrySupplier: (() -> JSONObject)? = null
    private val hbLock = Any()
    @Volatile private var hbSending: Boolean = false
    @Volatile private var hbPendingStatusJson: String? = null
    @Volatile private var hbPendingPriority: Boolean = false
    @Volatile private var hbPendingCallback: ((JSONObject) -> Unit)? = null

    /**
     * 🌐 [Settings用] 接続テスト (Handshake)
     */
    fun performHandshake(callback: (Boolean) -> Unit) {
        if (prefs.gasUrl.isBlank()) {
            callback(false)
            return
        }
        clientScope.launch {
            try {
                val response = Http.post(
                    prefs.gasUrl,
                    JSONObject().apply {
                        put("mode", "handshake")
                        put("client", "ARC")
                        put("version", currentVersion)
                        put("ip", Util.getLocalIpAddress())
                        put("port", MainActivity.serverPort)
                    }.toString()
                )
                withContext(Dispatchers.Main) { 
                    val ok = response.contains("ACK", ignoreCase = true) ||
                        response.contains("Success", ignoreCase = true) ||
                        response.contains("\"status\":\"ok\"", ignoreCase = true)
                    callback(ok)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { callback(false) }
            }
        }
    }

    /**
     * 🚀 [True Zero-Touch] 
     * 初期構築リクエスト。シート構造と最新のdoPostロジックをGatewayへ教え込む。
     */
    fun sendSetupRequest(port: Int, callback: (Boolean, String) -> Unit) {
        if (prefs.gasUrl.isBlank()) {
            callback(false, "GAS URL is empty")
            return
        }
        val setupData = JSONObject().apply {
            put("mode", "arc_setup")
            put("blueprint", JSONObject().apply {
                put("version", currentVersion)
                put("ip", Util.getLocalIpAddress())
                put("port", port)
                put("auth_key", prefs.authToken)
                put(
                    "api_modes",
                    JSONArray(
                        listOf(
                            "arc_info",
                            "request_arc",
                            "arc_execute_js",
                            "arc_refresh",
                            "arc_screenshot",
                            "arc_runtime_status",
                            "arc_runtime_set"
                        )
                    )
                )
                put("sheets", JSONObject().apply {
                    put("MAIN_CHAT", JSONArray(listOf("Timestamp", "User", "Content", "Status", "Response", "MissionID")))
                    put("ARC_NODES", JSONArray(listOf("LastSeen", "IP", "Port", "Status", "Capabilities", "Version", "WorkerID", "Executor", "CurrentHost", "CurrentUrl", "CurrentTitle", "HudTail")))
                    put("ARC_JOBS", JSONArray(listOf("Timestamp", "JobID", "Worker", "Mode", "Payload", "Status", "LeasedAt")))
                    put("ARC_RESULTS", JSONArray(listOf("Timestamp", "MissionID", "Target", "Prompt", "Result", "ImageURL")))
                    put("ARC_ERRORS", JSONArray(listOf("Timestamp", "QID", "Type", "Data")))
                    put("ARC_LEARNING", JSONArray(listOf("Timestamp", "Target", "Learned")))
                    put("ARC_AUDIT", JSONArray(listOf("Timestamp", "TraceID", "Event", "JobID", "Worker", "Status", "Detail")))
                    put("ARC_DEAD_JOBS", JSONArray(listOf("Timestamp", "JobID", "TraceID", "Executor", "Target", "Prompt", "RetryCount", "ErrorType", "ErrorData", "FailedWorker", "Reason", "Payload")))
                    put("ARC_ALERTS", JSONArray(listOf("Timestamp", "Level", "Type", "Message", "Value", "Threshold", "TraceID")))
                    put("ARC_COPILOT_DIAG", JSONArray(listOf("Timestamp", "WorkerID", "Target", "PageUrl", "PageTitle", "Webdriver", "UserAgent", "Platform", "Languages", "HardwareConcurrency", "WebglVendor", "WebglRenderer", "CanvasHash", "StorageFlags", "Headers", "ChallengeDetected", "ChallengeText", "Note", "TraceID")))
                    put("GATEWAY_LONG_MEMORY", JSONArray(listOf("Timestamp", "Key", "Value", "Source", "TraceID", "Tags")))
                    put("ARC_SHORT_MEMORY", JSONArray(listOf("Timestamp", "WorkerID", "SessionID", "Key", "Value", "TTL_SEC", "ExpiresAt", "TraceID")))
                })
            })
            put("suggested_script", generateSuggestedScript())
        }
        clientScope.launch {
            try {
                val response = Http.post(prefs.gasUrl, setupData.toString())
                withContext(Dispatchers.Main) { callback(true, response) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { callback(false, e.message ?: "Network Error") }
            }
        }
    }

    private fun generateSuggestedScript(): String {
        return """
            function doPost(e) {
              const data = JSON.parse(e.postData.contents);
              const ss = SpreadsheetApp.getActiveSpreadsheet();
              const ensureSheet = (name, header) => {
                let sh = ss.getSheetByName(name) || ss.insertSheet(name);
                if (sh.getLastRow() === 0 && header) sh.appendRow(header);
                return sh;
              };
              if (data.mode === 'arc_setup') {
                for (let name in data.blueprint.sheets) {
                  let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
                  if (sheet.getLastRow() === 0) sheet.appendRow(data.blueprint.sheets[name]);
                }
                return ContentService.createTextOutput('Setup Success');
              }
              if (data.mode === 'handshake') {
                return ContentService.createTextOutput('ACK');
              }
              if (data.mode === 'arc_result') {
                const sh = ensureSheet('ARC_RESULTS', ['Timestamp', 'MissionID', 'Target', 'Prompt', 'Result', 'ImageURL']);
                if (sh) sh.appendRow([new Date(), data.qid || '', '', '', data.text || '', data.image || '']);
                return ContentService.createTextOutput('ACK');
              }
              if (data.mode === 'arc_error') {
                const sh = ensureSheet('ARC_ERRORS', ['Timestamp', 'QID', 'Type', 'Data']);
                if (sh) sh.appendRow([new Date(), data.qid || '', data.error_type || '', data.data || '']);
                return ContentService.createTextOutput('ACK');
              }
              if (data.mode === 'arc_learning') {
                const sh = ensureSheet('ARC_LEARNING', ['Timestamp', 'Target', 'Learned']);
                if (sh) sh.appendRow([new Date(), data.target || '', data.learned || '']);
                return ContentService.createTextOutput('ACK');
              }
              if (data.mode === 'arc_heartbeat') {
                const sh = ensureSheet('ARC_NODES', ['LastSeen', 'IP', 'Port', 'Status', 'Capabilities', 'Version', 'WorkerID', 'Executor', 'CurrentHost', 'CurrentUrl', 'CurrentTitle', 'HudTail']);
                if (sh) {
                  const ip = data.ip || '';
                  const port = data.port || '';
                  const workerId = data.worker_id || '';
                  const rowValues = sh.getDataRange().getValues();
                  let foundRow = -1;
                  for (let i = 1; i < rowValues.length; i++) {
                    if ((workerId && String(rowValues[i][6] || '') === String(workerId)) ||
                        (String(rowValues[i][1] || '') === String(ip) && String(rowValues[i][2] || '') === String(port))) {
                      foundRow = i + 1;
                      break;
                    }
                  }
                  const payload = [
                    new Date(), ip, port, data.status || '', data.current_target || data.target || '', data.version || '',
                    workerId, data.executor || 'ARC', data.current_host || '', data.current_url || '', data.current_title || '', data.hud_tail || ''
                  ];
                  if (foundRow > 0) sh.getRange(foundRow, 1, 1, payload.length).setValues([payload]);
                  else sh.appendRow(payload);
                }
                return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }));
              }
              if (data.mode === 'arc_consult') {
                return ContentService.createTextOutput(JSON.stringify({ advice: '' }));
              }
              return ContentService.createTextOutput('ACK');
            }
        """.trimIndent()
    }

    fun sendArcResult(
        qid: String,
        result: String,
        image: String? = null,
        missionId: String? = null,
        target: String? = null,
        prompt: String? = null,
        evalSummary: String? = null,
        callback: (Boolean) -> Unit = {}
    ) {
        clientScope.launch {
            val payload = buildArcJobPayload(
                mode = "arc_result",
                qid = qid,
                missionId = missionId,
                target = target,
                prompt = prompt
            ).apply {
                put("text", result)
                if (!evalSummary.isNullOrBlank()) put("eval_summary", evalSummary.take(1200))
                // 大きいBase64画像は送信失敗の原因になるため省略
                if (!image.isNullOrBlank() && image.length <= maxInlineImageB64) {
                    put("image", image)
                }
            }
            val ok = sendWithFallback(payload, "report_result")
            withContext(Dispatchers.Main) { callback(ok) }
        }
    }

    fun sendArcError(
        qid: String,
        type: String,
        data: String? = null,
        missionId: String? = null,
        target: String? = null,
        prompt: String? = null,
        callback: (Boolean) -> Unit = {}
    ) {
        clientScope.launch {
            val payload = buildArcJobPayload(
                mode = "arc_error",
                qid = qid,
                missionId = missionId,
                target = target,
                prompt = prompt
            ).apply {
                put("error_type", type)
                if (!data.isNullOrBlank()) put("data", data)
            }
            val ok = sendWithFallback(payload, "report_error")
            withContext(Dispatchers.Main) { callback(ok) }
        }
    }

    fun reportLearning(target: String, learned: String) {
        clientScope.launch {
            send(JSONObject().apply {
                put("mode", "arc_learning")
                put("target", target)
                put("learned", learned.take(5000))
            })
        }
    }

    fun sendGatewayMemory(
        key: String,
        value: String,
        source: String = "arc",
        tags: String = "",
        callback: (Boolean) -> Unit = {}
    ) {
        clientScope.launch {
            val ok = send(JSONObject().apply {
                put("mode", "gateway_memory_put")
                put("key", key.take(120))
                put("value", value.take(3900))
                put("source", source.take(120))
                if (tags.isNotBlank()) put("tags", tags.take(300))
            })
            withContext(Dispatchers.Main) { callback(ok) }
        }
    }

    fun sendCopilotDiagnosticSnapshot(
        snapshot: JSONObject,
        callback: (Boolean, String) -> Unit = { _, _ -> }
    ) {
        clientScope.launch {
            val traceId = snapshot.optString("trace_id").ifBlank {
                "TRC_DIAG_" + UUID.randomUUID().toString().replace("-", "").take(12)
            }
            val ok = send(JSONObject(snapshot.toString()).apply {
                put("mode", "arc_diag_snapshot")
                put("trace_id", traceId)
                if (!has("target")) put("target", "copilot")
            })
            withContext(Dispatchers.Main) { callback(ok, traceId) }
        }
    }

    fun consultGateway(siteContext: String, problem: String, image: String? = null, callback: (String) -> Unit) {
        if (!prefs.consultGatewayEnabled) {
            callback("")
            return
        }
        clientScope.launch {
            try {
                val json = JSONObject().apply {
                    put("mode", "arc_consult")
                    put("context", siteContext)
                    put("problem", problem)
                    if (image != null) put("image", image)
                    put("auth_key", prefs.authToken)
                }
                val response = withTimeoutOrNull(8000L) { Http.post(prefs.gasUrl, json.toString()) }
                if (response.isNullOrBlank()) {
                    withContext(Dispatchers.Main) { callback("") }
                    return@launch
                }
                val advice = try {
                    JSONObject(response).optString("advice", "")
                } catch (_: Exception) {
                    ""
                }
                withContext(Dispatchers.Main) { callback(advice) }
            } catch (_: Exception) {
                withContext(Dispatchers.Main) { callback("") }
            }
        }
    }

    fun fetchAdaptiveAllOrder(callback: (List<AiTarget>) -> Unit) {
        val fallback = listOf(AiTarget.CHATGPT, AiTarget.GEMINI, AiTarget.COPILOT)
        if (prefs.gasUrl.isBlank()) {
            callback(fallback)
            return
        }
        clientScope.launch {
            val order = try {
                val json = JSONObject().apply {
                    put("mode", "admin_target_scores")
                    put("auth_key", prefs.authToken)
                }
                val response = Http.post(prefs.gasUrl, json.toString())
                val parsed = JSONObject(response)
                val scores = parsed.optJSONObject("scores")
                if (scores == null) {
                    fallback
                } else {
                    val names = listOf("chatgpt", "gemini", "copilot")
                    val ranked = names.sortedWith(compareByDescending<String> { name ->
                        val o = scores.optJSONObject(name)
                        val sr = if (o != null && !o.isNull("success_rate")) o.optDouble("success_rate", -1.0) else -1.0
                        sr
                    }.thenBy { name ->
                        val o = scores.optJSONObject(name)
                        val active = o?.optBoolean("cooldown_active", false) ?: false
                        if (active) 1 else 0
                    }.thenBy { name ->
                        val o = scores.optJSONObject(name)
                        if (o != null && !o.isNull("avg_latency_sec")) o.optDouble("avg_latency_sec", 999999.0) else 999999.0
                    }.thenByDescending { name ->
                        val o = scores.optJSONObject(name)
                        o?.optInt("success", 0) ?: 0
                    })
                    val mapped = ranked.mapNotNull {
                        when (it) {
                            "chatgpt" -> AiTarget.CHATGPT
                            "gemini" -> AiTarget.GEMINI
                            "copilot" -> AiTarget.COPILOT
                            else -> null
                        }
                    }.toMutableList()
                    fallback.forEach { if (!mapped.contains(it)) mapped.add(it) }
                    mapped
                }
            } catch (_: Exception) {
                fallback
            }
            withContext(Dispatchers.Main) { callback(order) }
        }
    }

    fun fetchSlotRegistry(callback: (JSONArray) -> Unit) {
        if (prefs.gasUrl.isBlank()) {
            callback(JSONArray())
            return
        }
        clientScope.launch {
            val slots = try {
                val json = JSONObject().apply {
                    put("mode", "admin_slot_list")
                    put("auth_key", prefs.authToken)
                }
                val response = Http.post(prefs.gasUrl, json.toString())
                val parsed = JSONObject(response)
                parsed.optJSONArray("slots") ?: JSONArray()
            } catch (_: Exception) {
                JSONArray()
            }
            withContext(Dispatchers.Main) { callback(slots) }
        }
    }

    fun sendHeartbeat(statusJson: String, onInstruction: (JSONObject) -> Unit = {}) {
        if (prefs.gasUrl.isBlank()) return
        val nextPriority = isPriorityHeartbeat(statusJson)
        if (nextPriority) {
            clientScope.launch {
                postHeartbeat(statusJson, onInstruction)
            }
            return
        }
        var shouldStartDrain = false
        synchronized(hbLock) {
            if (hbPendingStatusJson != null && hbPendingPriority && !nextPriority) {
                // 終端系(success/error)を待っている間は通常heartbeatで上書きしない
            } else {
                hbPendingStatusJson = statusJson
                hbPendingCallback = onInstruction
                hbPendingPriority = nextPriority
            }
            if (!hbSending) {
                hbSending = true
                shouldStartDrain = true
            }
        }
        if (!shouldStartDrain) return
        clientScope.launch {
            while (true) {
                val nextPayload: String?
                val nextCallback: ((JSONObject) -> Unit)?
                synchronized(hbLock) {
                    nextPayload = hbPendingStatusJson
                    nextCallback = hbPendingCallback
                    hbPendingStatusJson = null
                    hbPendingCallback = null
                    hbPendingPriority = false
                }
                if (nextPayload == null) {
                    synchronized(hbLock) {
                        hbSending = false
                    }
                    break
                }
                postHeartbeat(nextPayload, nextCallback ?: onInstruction)
            }
        }
    }

    private suspend fun postHeartbeat(statusJson: String, onInstruction: (JSONObject) -> Unit = {}) {
        try {
            val base = try { JSONObject(statusJson) } catch (_: Exception) { JSONObject().put("mode", "arc_heartbeat").put("status", "unknown") }
            try {
                val telemetry = telemetrySupplier?.invoke()
                if (telemetry != null) {
                    val names = telemetry.keys()
                    while (names.hasNext()) {
                        val key = names.next()
                        if (!base.has(key)) base.put(key, telemetry.opt(key))
                    }
                }
            } catch (_: Exception) {}
            base.put("auth_key", prefs.authToken)
            if (!base.has("worker_id")) base.put("worker_id", prefs.workerId)
            var response = Http.post(prefs.gasUrl, base.toString())
            var retriedMinimal = false
            if (!response.startsWith("{")) {
                val lower = response.lowercase()
                val isHtmlError =
                    lower.contains("<!doctype html") ||
                        lower.contains("<html") ||
                        lower.contains("<title>エラー") ||
                        lower.contains("<title>error")
                if (isHtmlError) {
                    retriedMinimal = true
                    val minimal = JSONObject().apply {
                        put("mode", "arc_heartbeat")
                        put("status", base.optString("status", "heartbeat"))
                        put("auth_key", prefs.authToken)
                        put("worker_id", prefs.workerId)
                        put("executor", base.optString("executor", "ARC"))
                    }
                    response = Http.post(prefs.gasUrl, minimal.toString())
                }
            }
            val head = response.take(180)
            if (retriedMinimal) Log.d("ARC_GW_HB", "response_head(minimal_retry)=$head")
            else Log.d("ARC_GW_HB", "response_head=$head")
            if (!response.startsWith("{")) return
            val parsed = JSONObject(response)
            withContext(Dispatchers.Main) {
                val instruction = parsed.optJSONObject("instruction")
                if (instruction != null) {
                    Log.d("ARC_GW_HB", "instruction mode=${instruction.optString("mode")} job_id=${instruction.optString("job_id")}")
                }
                onInstruction(instruction ?: parsed)
            }
        } catch (_: Exception) {}
    }

    private fun isPriorityHeartbeat(statusJson: String): Boolean {
        return try {
            val s = JSONObject(statusJson).optString("status", "").lowercase()
            s == "success" || s == "error"
        } catch (_: Exception) {
            false
        }
    }

    private fun isGatewayAck(response: String): Boolean {
        val raw = response.trim()
        if (raw.isEmpty()) return false

        if (raw.startsWith("{")) {
            try {
                val obj = JSONObject(raw)
                val status = obj.optString("status", "").trim().lowercase()
                val error = obj.optString("error", "").trim().lowercase()
                if (status == "error") return false
                if (error.isNotBlank() && status != "ok") return false
                if (status in setOf("ok", "ack", "retry_scheduled")) return true
                if (obj.has("instruction")) return true
            } catch (_: Exception) {
                // fallthrough
            }
        }

        val lower = raw.lowercase()
        if (lower.contains("unauthorized")) return false
        if (lower.contains("\"status\":\"error\"")) return false
        if (lower.contains("ack") || lower.contains("success")) return true
        return false
    }

    private fun buildArcJobPayload(
        mode: String,
        qid: String,
        missionId: String?,
        target: String?,
        prompt: String?
    ): JSONObject {
        return JSONObject().apply {
            put("mode", mode)
            put("qid", qid)
            if (!missionId.isNullOrBlank()) put("mission_id", missionId)
            if (!target.isNullOrBlank()) put("target", target)
            if (!prompt.isNullOrBlank()) put("prompt", prompt.take(2000))
            put("session_id", if (!missionId.isNullOrBlank()) missionId else qid)
        }
    }

    private fun cloneWithMode(base: JSONObject, mode: String): JSONObject {
        val cloned = JSONObject(base.toString())
        cloned.put("mode", mode)
        return cloned
    }

    private suspend fun sendWithFallback(primary: JSONObject, fallbackMode: String): Boolean {
        if (send(primary)) return true
        val primaryMode = primary.optString("mode")
        val fallback = cloneWithMode(primary, fallbackMode)
        val fallbackOk = send(fallback)
        if (fallbackOk) {
            Log.w("ARC_GW", "mode fallback applied: $primaryMode -> $fallbackMode")
        }
        return fallbackOk
    }

    private suspend fun send(json: JSONObject): Boolean {
        if (prefs.gasUrl.isEmpty()) return false
        try {
            val telemetry = telemetrySupplier?.invoke()
            if (telemetry != null) {
                val names = telemetry.keys()
                while (names.hasNext()) {
                    val key = names.next()
                    if (!json.has(key)) json.put(key, telemetry.opt(key))
                }
            }
        } catch (_: Exception) {}
        json.put("auth_key", prefs.authToken)
        if (!json.has("worker_id")) json.put("worker_id", prefs.workerId)
        val response = try {
            Http.post(prefs.gasUrl, json.toString())
        } catch (e: Exception) {
            Log.w("ARC_GW", "send failed: ${json.optString("mode")} / ${e.message}")
            return false
        }
        val ok = isGatewayAck(response)
        if (!ok) {
            val mode = json.optString("mode")
            val snippet = response.replace("\n", " ").take(240)
            Log.w("ARC_GW", "send rejected: $mode / $snippet")
        }
        return ok
    }
}
