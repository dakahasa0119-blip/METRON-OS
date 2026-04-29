package com.arc

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.*

@OptIn(ExperimentalCoroutinesApi::class)
class ArcTaskQueueTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var mockWorker: ArcWorker
    private lateinit var mockWeb: WebViewManager
    private lateinit var taskQueue: ArcTaskQueue

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        mockWeb = mock()
        mockWorker = mock {
            on { web } doReturn mockWeb
        }
        taskQueue = ArcTaskQueue(mockWorker)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `test enqueue starts processing when idle`() = runTest(testDispatcher) {
        val task = ArcTask.Pipeline("test prompt")

        // Setup mockWorker.process to just call the completion callback immediately
        whenever(mockWorker.process(any(), any())).thenAnswer {
            @Suppress("UNCHECKED_CAST")
            val callback = it.arguments[1] as () -> Unit
            callback()
        }

        taskQueue.enqueue(task)

        // Let coroutines run
        advanceUntilIdle()

        verify(mockWeb).setMonitoring(false)
        verify(mockWorker).process(eq(task), any())
        assertEquals(0, taskQueue.pendingCount())
    }

    @Test
    fun `test clearAll cancels running task and queue`() = runTest(testDispatcher) {
        val task1 = ArcTask.Pipeline("task1")
        val task2 = ArcTask.Pipeline("task2")

        // Setup mockWorker.process to simulate a long running task
        whenever(mockWorker.process(any(), any())).thenAnswer {
            // Not calling callback to keep isRunning = true
        }

        taskQueue.enqueue(task1)
        taskQueue.enqueue(task2)

        advanceUntilIdle()

        // 1 running + 1 in queue
        assertEquals(2, taskQueue.pendingCount())

        taskQueue.clearAll()

        assertEquals(0, taskQueue.pendingCount())
        verify(mockWorker).forceFailCurrent("QUEUE_CLEARED", "manual_override")
    }

    @Test
    fun `test clearAll when idle`() = runTest(testDispatcher) {
        assertEquals(0, taskQueue.pendingCount())

        taskQueue.clearAll()

        assertEquals(0, taskQueue.pendingCount())
        verify(mockWorker).abortCurrent()
        verify(mockWorker, never()).forceFailCurrent(any(), any())
    }

    @Test
    fun `test pendingCount correctly reflects queue size and running state`() = runTest(testDispatcher) {
        val task1 = ArcTask.Pipeline("task1")
        val task2 = ArcTask.Pipeline("task2")
        val task3 = ArcTask.Pipeline("task3")

        whenever(mockWorker.process(any(), any())).thenAnswer {
            // Keep running
        }

        assertEquals(0, taskQueue.pendingCount())

        taskQueue.enqueue(task1)
        advanceUntilIdle()

        // 1 running, 0 in queue
        assertEquals(1, taskQueue.pendingCount())

        taskQueue.enqueue(task2)
        taskQueue.enqueue(task3)
        advanceUntilIdle()

        // 1 running, 2 in queue
        assertEquals(3, taskQueue.pendingCount())
    }

    @Test
    fun `test next task is processed after current task finishes`() = runTest(testDispatcher) {
        val task1 = ArcTask.Pipeline("task1")
        val task2 = ArcTask.Pipeline("task2")

        var finishTask1: (() -> Unit)? = null

        whenever(mockWorker.process(any(), any())).thenAnswer {
            val t = it.arguments[0] as ArcTask
            if (t == task1) {
                @Suppress("UNCHECKED_CAST")
                finishTask1 = it.arguments[1] as () -> Unit
            } else {
                @Suppress("UNCHECKED_CAST")
                val callback = it.arguments[1] as () -> Unit
                callback()
            }
        }

        taskQueue.enqueue(task1)
        taskQueue.enqueue(task2)

        advanceUntilIdle()

        // Only task1 should be processed initially
        verify(mockWorker, times(1)).process(any(), any())
        assertEquals(2, taskQueue.pendingCount()) // 1 running + 1 in queue

        // Finish task1
        finishTask1?.invoke()

        advanceUntilIdle()

        // Now task2 should have been processed
        verify(mockWorker, times(2)).process(any(), any())
        assertEquals(0, taskQueue.pendingCount())
    }
}
