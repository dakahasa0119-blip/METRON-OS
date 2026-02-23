package com.arc

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.*

/**
 * 外部(GAS/Gateway)との通信を統率し、フルログ整理と自動セットアップを司る (v13.5 - Zero-Touch Polished)
 */
class GatewayClient(private val prefs: Prefs) {

    private val clientScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val currentVersion = "13.5"

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
                put("api_modes", JSONArray(listOf("arc_info", "request_arc", "arc_execute_js", "arc_refresh", "arc_screenshot")))
                put("sheets", JSONObject().apply {
                    put("MAIN_CHAT", JSONArray(listOf("Timestamp", "User", "Content", "Status", "Response", "MissionID"))) 
                    put("ARC_NODES", JSONArray(listOf("LastSeen", "IP", "Port", "Status", "Capabilities", "Version")))
                    put("ARC_RESULTS", JSONArray(listOf("Timestamp", "MissionID", "Target", "Prompt", "Result", "ImageURL")))
                    put("ARC_ERRORS", JSONArray(listOf("Timestamp", "QID", "Type", "Data")))
                    put("ARC_LEARNING", JSONArray(listOf("Timestamp", "Target", "Learned")))
                    put("ARC_TRACES", JSONArray(listOf("Timestamp", "MissionID", "Level", "Step", "Message", "Data")))
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
                const sh = ensureSheet('ARC_NODES', ['LastSeen', 'IP', 'Port', 'Status', 'Capabilities', 'Version']);
                if (sh) {
                  const ip = data.ip || '';
                  const port = data.port || '';
                  const rowValues = sh.getDataRange().getValues();
                  let foundRow = -1;
                  for (let i = 1; i < rowValues.length; i++) {
                    if (String(rowValues[i][1] || '') === String(ip) && String(rowValues[i][2] || '') === String(port)) {
                      foundRow = i + 1;
                      break;
                    }
                  }
                  const payload = [new Date(), ip, port, data.status || '', data.target || '', data.version || ''];
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

    fun sendArcResult(qid: String, result: String, image: String? = null) {
        clientScope.launch {
            send(JSONObject().apply {
                put("mode", "arc_result")
                put("qid", qid)
                put("text", result)
                if (image != null) put("image", image)
            })
        }
    }

    fun sendArcError(qid: String, type: String, data: String? = null) {
        clientScope.launch {
            send(JSONObject().apply {
                put("mode", "arc_error")
                put("qid", qid)
                put("error_type", type)
                if (!data.isNullOrBlank()) put("data", data)
            })
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

    fun consultGateway(siteContext: String, problem: String, image: String? = null, callback: (String) -> Unit) {
        clientScope.launch {
            try {
                val json = JSONObject().apply {
                    put("mode", "arc_consult")
                    put("context", siteContext)
                    put("problem", problem)
                    if (image != null) put("image", image)
                    put("auth_key", prefs.authToken)
                }
                val response = Http.post(prefs.gasUrl, json.toString())
                withContext(Dispatchers.Main) { callback(JSONObject(response).optString("advice", "")) }
            } catch (_: Exception) { withContext(Dispatchers.Main) { callback("") } }
        }
    }

    fun sendHeartbeat(statusJson: String, onInstruction: (JSONObject) -> Unit = {}) {
        if (prefs.gasUrl.isBlank()) return
        clientScope.launch {
            try {
                val base = try { JSONObject(statusJson) } catch (_: Exception) { JSONObject().put("mode", "arc_heartbeat").put("status", "unknown") }
                base.put("auth_key", prefs.authToken)
                val response = Http.post(prefs.gasUrl, base.toString())
                if (response.startsWith("{")) {
                    val parsed = JSONObject(response)
                    withContext(Dispatchers.Main) {
                        val instruction = parsed.optJSONObject("instruction")
                        onInstruction(instruction ?: parsed)
                    }
                }
            } catch (_: Exception) {}
        }
    }

    private suspend fun send(json: JSONObject) {
        if (prefs.gasUrl.isEmpty()) return
        json.put("auth_key", prefs.authToken)
        try { Http.post(prefs.gasUrl, json.toString()) } catch (e: Exception) {}
    }
}
