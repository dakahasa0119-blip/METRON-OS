package com.arc

import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalCoroutinesApi::class)
class ArcTaskQueueTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var worker: ArcWorker
    private lateinit var queue: ArcTaskQueue

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        worker = mockk(relaxed = true)
        queue = ArcTaskQueue(worker)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `clearAll when running forces fail on current task`() {
        // Mock the worker to simulate it taking some time to process the task,
        // so that isRunning remains true.
        every { worker.process(any(), any()) } answers {
            // Do not call the callback immediately so the task stays running
        }

        // Enqueue a task. This triggers processNext() which sets isRunning to true.
        val task = mockk<ArcTask>()
        queue.enqueue(task)
        testDispatcher.scheduler.advanceUntilIdle()

        // Verify the task is running
        assertEquals(1, queue.pendingCount())

        // Now call clearAll
        queue.clearAll()

        // Verify that queue is cleared and pendingCount is 0
        assertEquals(0, queue.pendingCount())

        // Verify forceFailCurrent was called, meaning it was aborted while running
        verify { worker.forceFailCurrent("QUEUE_CLEARED", "manual_override") }

        // Ensure abortCurrent was NOT called
        verify(exactly = 0) { worker.abortCurrent() }
    }

    @Test
    fun `clearAll when not running aborts current worker`() {
        // Initial state is not running
        assertEquals(0, queue.pendingCount())

        // Call clearAll
        queue.clearAll()

        // Verify pending count is still 0
        assertEquals(0, queue.pendingCount())

        // Verify abortCurrent was called
        verify { worker.abortCurrent() }

        // Ensure forceFailCurrent was NOT called
        verify(exactly = 0) { worker.forceFailCurrent(any(), any()) }
    }
}
