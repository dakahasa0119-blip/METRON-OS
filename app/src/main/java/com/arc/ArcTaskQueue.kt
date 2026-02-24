package com.arc

import kotlinx.coroutines.*
import java.util.LinkedList

/**
 * タスクの順次実行を管理するキュー (v5.0 - Coroutine Integrated)
 */
class ArcTaskQueue(private val worker: ArcWorker) {
    private val queue = LinkedList<ArcTask>()
    private var isRunning = false
    private val queueScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var watchdogJob: Job? = null
    // 生成系ターゲットの応答遅延で誤タイムアウトしないよう、強制打ち切りは3分に延長
    private val taskHardTimeoutMs = 180_000L

    fun enqueue(task: ArcTask) {
        synchronized(queue) {
            queue.add(task)
            if (!isRunning) {
                processNext()
            }
        }
    }

    fun clearAll() {
        synchronized(queue) {
            queue.clear()
            watchdogJob?.cancel()
            watchdogJob = null
            if (isRunning) {
                // 実行中タスクを無言で捨てない。Gateway側へ明示エラーを返して整合性を保つ。
                worker.forceFailCurrent("QUEUE_CLEARED", "manual_override")
            } else {
                worker.abortCurrent()
            }
            isRunning = false
        }
    }

    fun pendingCount(): Int = synchronized(queue) { queue.size + if (isRunning) 1 else 0 }

    private fun processNext() {
        val task = synchronized(queue) { queue.poll() } ?: run {
            isRunning = false
            worker.web.setMonitoring(true)
            worker.announceStatus("idle")
            return
        }
        isRunning = true
        worker.web.setMonitoring(false)

        watchdogJob?.cancel()
        watchdogJob = CoroutineScope(Dispatchers.Default).launch {
            delay(taskHardTimeoutMs)
            val shouldFail = synchronized(queue) { isRunning }
            if (shouldFail) {
                worker.forceFailCurrent("WATCHDOG_TIMEOUT", "task_hard_timeout")
            }
        }

        // 🚀 ArcWorker と同じタイムラインで実行
        worker.process(task) {
            watchdogJob?.cancel()
            watchdogJob = null
            queueScope.launch {
                processNext()
            }
        }
    }
}
