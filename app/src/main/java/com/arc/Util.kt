package com.arc

import android.util.Log
import java.net.NetworkInterface
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

/**
 * ARC 自律システム・トレーサー (v23.0 - Expectation Watchdog)
 */
object Util {

    private const val TAG = "ARC_TRACE"
    enum class Level { THOUGHT, SUMMARY, CRITICAL }

    // 🕒 期待値（シグナル）管理用
    private val expectedMilestones = ConcurrentHashMap<String, Long>()

    /**
     * 🚀 自律判断付きトレース関数
     */
    fun trace(missionId: String?, level: Level, step: String, message: String, data: JSONObject? = null) {
        val now = System.currentTimeMillis()
        val logObj = JSONObject().apply {
            put("ts", now)
            put("missionId", missionId ?: "SYSTEM")
            put("lvl", level.name)
            put("step", step)
            put("msg", message)
            if (data != null) put("data", data)
        }
        
        // 🧐 期待値との差分チェック (Watchdog)
        missionId?.let { mid ->
            val key = "${mid}_$step"
            if (expectedMilestones.containsKey(key)) {
                val expectedAt = expectedMilestones.remove(key)!!
                val delta = now - expectedAt
                if (delta > 0) {
                    Log.w(TAG, "⚠️ DELAY DETECTED: Step [$step] was expected ${delta}ms earlier.")
                    logObj.put("watchdog_delta", delta)
                } else {
                    Log.d(TAG, "✅ ON TIME: Step [$step] arrived ${-delta}ms earlier than deadline.")
                }
            }
        }

        Log.d(TAG, "[$level] $step: $message")
    }

    /**
     * ⏳ 特定のステップが完了すべき「期待時刻」を登録する
     */
    fun expect(missionId: String, step: String, timeoutMs: Long) {
        val deadline = System.currentTimeMillis() + timeoutMs
        expectedMilestones["${missionId}_$step"] = deadline
        Log.d(TAG, "⏳ EXPECTED: Step [$step] should complete within ${timeoutMs}ms")
    }

    /**
     * 🚨 期待されたステップが完了しなかった「未達」をチェックする
     */
    fun checkAnomalies(missionId: String) {
        val now = System.currentTimeMillis()
        expectedMilestones.keys().asSequence()
            .filter { it.startsWith(missionId) }
            .forEach { key ->
                val deadline = expectedMilestones[key]!!
                if (now > deadline) {
                    val step = key.removePrefix("${missionId}_")
                    trace(missionId, Level.CRITICAL, "ANOMALY", "Expected milestone [$step] never arrived (Timeout).")
                    expectedMilestones.remove(key)
                }
            }
    }

    // --- Utils ---
    const val TAG_ALL = "ALL"; const val TAG_GEMINI = "GEMINI"; const val TAG_GPT = "GPT"; const val TAG_COPILOT = "COPILOT"
    
    fun parseTarget(tag: String): AiTarget? = when (tag.uppercase()) {
        TAG_GEMINI -> AiTarget.GEMINI
        "GPT", "CHATGPT" -> AiTarget.CHATGPT
        TAG_COPILOT -> AiTarget.COPILOT
        "FULL_BROWSER" -> AiTarget.FULL_BROWSER
        "MOBILE_BROWSER" -> AiTarget.MOBILE_BROWSER
        "GATEWAY_ADVISOR" -> AiTarget.GATEWAY_ADVISOR
        else -> null
    }

    private var cachedIpAddress: String? = null
    private var lastIpFetchTime: Long = 0
    private const val IP_CACHE_DURATION_MS = 300_000L // 5 minutes

    fun getLocalIpAddress(): String {
        val now = System.currentTimeMillis()
        synchronized(this) {
            if (cachedIpAddress != null && (now - lastIpFetchTime < IP_CACHE_DURATION_MS)) {
                return cachedIpAddress!!
            }
        }

        var result = "unknown"
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (networkInterface in interfaces) {
                val addresses = Collections.list(networkInterface.inetAddresses)
                for (address in addresses) {
                    if (!address.isLoopbackAddress && address.hostAddress?.indexOf(':') ?: 0 < 0) {
                        result = address.hostAddress ?: "unknown"
                        break
                    }
                }
                if (result != "unknown") break
            }
        } catch (e: Exception) { }

        synchronized(this) {
            cachedIpAddress = result
            lastIpFetchTime = now
        }
        return result
    }

    fun escapeJs(text: String?): String = text?.replace("\\", "\\\\")?.replace("\"", "\\\"")?.replace("'", "\\'")?.replace("\n", "\\n")?.replace("\r", "") ?: ""
}
