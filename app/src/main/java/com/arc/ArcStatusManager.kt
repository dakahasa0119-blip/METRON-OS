package com.arc

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

class ArcStatusManager(
    private val web: WebViewManager,
    private val prefs: Prefs,
    private val inferTargetFromUrl: (String) -> String,
    private val getTarget: () -> String,
    private val getQid: () -> String?,
    private val getMissionId: () -> String?,
    private val getSlotId: () -> String,
    private val isAborted: () -> Boolean,
    var onSystemStatusUpdate: ((String) -> Unit)?,
    private val announceStatusFunc: (String) -> Unit
) {
    private val statusTrail = ArrayDeque<String>()
    private var statusSeq: Long = 0L

    @Synchronized
    fun rememberStatus(status: String) {
        val ts = System.currentTimeMillis()
        statusTrail.addLast("${ts}:${status.take(120)}")
        while (statusTrail.size > 20) statusTrail.removeFirst()
    }

    fun emitStatus(status: String) {
        rememberStatus(status)
        val seq = nextStatusSeq()
        val url = web.currentUrl()
        val lastTarget = getTarget()
        val inferred = inferTargetFromUrl(url).ifBlank { lastTarget }
        val shortUrl = if (url.length > 180) url.take(180) + "...(len=" + url.length + ")" else url
        Log.d(
            "ARC_HUD_EVT",
            "seq=$seq qid=${getQid() ?: "-"} target=${inferred.ifBlank { "-" }} status=${status.take(120)} url=$shortUrl"
        )
        onSystemStatusUpdate?.invoke(status)
        requestFastHeartbeat(status)
    }

    private fun requestFastHeartbeat(status: String) {
        if (isAborted()) return
        if (getQid() == null && getMissionId().isNullOrBlank()) return
        val statusHint = when {
            status.startsWith("MISSION OK") || status.startsWith("PIPE_STEP_DONE") -> "success"
            status.startsWith("ERROR") || status.startsWith("BOT_BLOCKED") -> "error"
            else -> "running"
        }

        if (statusHint == "success" || statusHint == "error") {
            announceStatusFunc(statusHint)
        }
    }

    @Synchronized
    fun snapshotStatusTrail(): JSONArray {
        return JSONArray(statusTrail.toList())
    }

    @Synchronized
    fun latestStatus(): String {
        return statusTrail.lastOrNull() ?: ""
    }

    @Synchronized
    fun nextStatusSeq(): Long {
        statusSeq += 1
        return statusSeq
    }

    @Synchronized
    fun currentStatusSeq(): Long {
        return statusSeq
    }
}
