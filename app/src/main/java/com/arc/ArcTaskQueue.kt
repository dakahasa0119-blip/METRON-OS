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
            isRunning = false
            worker.abortCurrent()
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
        
        // 🚀 ArcWorker と同じタイムラインで実行
        worker.process(task) { 
            queueScope.launch {
                processNext()
            }
        }
    }
}
