package com.arc

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Test
import kotlin.system.measureTimeMillis
import kotlin.concurrent.thread

class DispatcherBenchmarkTest {

    // Simulate a blocking HTTP call
    private fun blockingCall() {
        Thread.sleep(100) // 100ms blocking
    }

    @Test
    fun testDefaultDispatcherStarvation() = runBlocking {
        // Find number of cores to saturate the Default dispatcher
        val cores = Runtime.getRuntime().availableProcessors()

        val timeWithoutIO = measureTimeMillis {
            val jobs = List(cores * 2) {
                launch(Dispatchers.Default) {
                    blockingCall()
                }
            }
            jobs.forEach { it.join() }
        }

        val timeWithIO = measureTimeMillis {
            val jobs = List(cores * 2) {
                launch(Dispatchers.Default) {
                    withContext(Dispatchers.IO) {
                        blockingCall()
                    }
                }
            }
            jobs.forEach { it.join() }
        }

        println("Time without withContext(Dispatchers.IO): $timeWithoutIO ms")
        println("Time with withContext(Dispatchers.IO): $timeWithIO ms")
    }
}
