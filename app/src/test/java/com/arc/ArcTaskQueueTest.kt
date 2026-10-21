package com.arc

import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ArcTaskQueueTest {

    private lateinit var queue: ArcTaskQueue
    private lateinit var worker: ArcWorker
    private lateinit var web: WebViewManager

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)

        web = mockk(relaxed = true)
        worker = mockk(relaxed = true)
        every { worker.web } returns web

        // Mock process to invoke the completion callback immediately to simulate task completion
        every { worker.process(any(), any()) } answers {
            val callback = secondArg<() -> Unit>()
            callback.invoke()
        }

        queue = ArcTaskQueue(worker)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun testEnqueueStartsProcessingWhenNotRunning() = runTest(testDispatcher) {
        val task = ArcTask.AI("q1", "target", "prompt")

        assertEquals(0, queue.pendingCount())

        queue.enqueue(task)

        // After enqueuing, the item is popped and processed,
        // process invokes callback immediately, which launches processNext
        // in queueScope. Let's run all pending tasks in the dispatcher
        testDispatcher.scheduler.advanceUntilIdle()

        verify { worker.process(task, any()) }
        assertEquals(0, queue.pendingCount())
    }

    @Test
    fun testClearAllWhenNotRunning() = runTest(testDispatcher) {
        val task = ArcTask.AI("q1", "target", "prompt")

        // Disable auto-process mock to keep the queue in a specific state
        // if needed, but since it's not running, we just need to avoid enqueue
        // Or enqueue and then immediately clear
        every { worker.process(any(), any()) } answers {
            // Do not call callback immediately so it stays running
        }

        queue.enqueue(task) // This starts processNext, makes isRunning = true

        // If we want to test isRunning = false, we shouldn't enqueue or we can wait
        // Let's create a fresh queue and just clear it
        val queue2 = ArcTaskQueue(worker)
        queue2.clearAll()

        verify { worker.abortCurrent() }
        assertEquals(0, queue2.pendingCount())
    }

    @Test
    fun testClearAllWhenRunning() = runTest(testDispatcher) {
        val task = ArcTask.AI("q1", "target", "prompt")

        // Prevent completion callback to keep isRunning = true
        every { worker.process(any(), any()) } answers {}

        queue.enqueue(task) // starts processing, isRunning becomes true
        assertEquals(1, queue.pendingCount())

        queue.clearAll()

        verify { worker.forceFailCurrent("QUEUE_CLEARED", "manual_override") }
        assertEquals(0, queue.pendingCount())
    }

    @Test
    fun testPendingCountIncludesRunningTask() = runTest(testDispatcher) {
        val task1 = ArcTask.AI("q1", "target", "prompt")
        val task2 = ArcTask.AI("q2", "target", "prompt")

        // Prevent completion callback so task1 stays running
        every { worker.process(any(), any()) } answers {}

        queue.enqueue(task1)
        queue.enqueue(task2) // Queued but not processed since task1 is running

        // 1 running + 1 in queue = 2
        assertEquals(2, queue.pendingCount())
    }
}
