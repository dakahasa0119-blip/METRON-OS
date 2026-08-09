package com.arc

import io.mockk.mockk
import io.mockk.verify
import io.mockk.every
import io.mockk.just
import io.mockk.runs
import io.mockk.slot
import io.mockk.spyk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay

@OptIn(ExperimentalCoroutinesApi::class)
class ArcTaskQueueTest {

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun testEnqueue_addsTaskAndStartsProcessingWhenNotRunning() {
        val worker = mockk<ArcWorker>(relaxed = true)
        val queue = ArcTaskQueue(worker)
        val task = ArcTask.AI(qid = "1", target = "gemini", prompt = "Hello")

        queue.enqueue(task)

        // enqueue triggers processNext synchronously since it's not running
        assertEquals(1, queue.pendingCount())

        verify(exactly = 1) { worker.process(task, any()) }
    }

    @Test
    fun testEnqueue_addsTaskButDoesNotStartProcessingWhenRunning() = runTest {
        val worker = mockk<ArcWorker>(relaxed = true)

        // Capture the callback passed to worker.process
        val callbackSlot = slot<() -> Unit>()
        every { worker.process(any(), capture(callbackSlot)) } just runs

        val queue = ArcTaskQueue(worker)
        val task1 = ArcTask.AI(qid = "1", target = "gemini", prompt = "Task 1")
        val task2 = ArcTask.AI(qid = "2", target = "gemini", prompt = "Task 2")

        // First task gets processed
        queue.enqueue(task1)
        verify(exactly = 1) { worker.process(task1, any()) }
        assertEquals(1, queue.pendingCount()) // isRunning is true, queue is empty -> size 0 + 1 = 1

        // Second task is added to queue but processNext is NOT called again
        queue.enqueue(task2)
        assertEquals(2, queue.pendingCount()) // isRunning is true, queue has 1 -> size 1 + 1 = 2
        verify(exactly = 0) { worker.process(task2, any()) }

        // Now simulate the first task finishing
        callbackSlot.captured.invoke()
        testScheduler.advanceUntilIdle() // Process coroutine launched in callback

        // Now the second task should be processed
        verify(exactly = 1) { worker.process(task2, any()) }
        assertEquals(1, queue.pendingCount()) // isRunning is true, queue is empty -> size 0 + 1 = 1

        // Finish second task
        callbackSlot.captured.invoke()
        testScheduler.advanceUntilIdle()

        // Queue is now completely empty
        assertEquals(0, queue.pendingCount())
    }

    @Test
    fun testClearAll_whenNotRunning() {
        val worker = mockk<ArcWorker>(relaxed = true)
        val queue = ArcTaskQueue(worker)

        queue.clearAll()

        verify(exactly = 1) { worker.abortCurrent() }
        assertEquals(0, queue.pendingCount())
    }

    @Test
    fun testClearAll_whenRunning() {
        val worker = mockk<ArcWorker>(relaxed = true)

        val callbackSlot = slot<() -> Unit>()
        every { worker.process(any(), capture(callbackSlot)) } just runs

        val queue = ArcTaskQueue(worker)
        val task = ArcTask.AI(qid = "1", target = "gemini", prompt = "Hello")
        queue.enqueue(task)

        // At this point it is running
        queue.clearAll()

        verify(exactly = 1) { worker.forceFailCurrent("QUEUE_CLEARED", "manual_override") }
        assertEquals(0, queue.pendingCount())
    }
}
