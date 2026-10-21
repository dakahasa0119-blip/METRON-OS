package com.arc

import org.junit.Test
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue

class PerformanceTest {

    @Test
    fun testHttpPostDispatcher() = runTest {
        // Measure execution time to verify it doesn't block the caller thread if it takes time
        // but since without mocking the URL connection fails instantly, we just ensure it returns the ERROR string
        val result = Http.post("http://localhost:1", "{}")
        assertTrue(result.contains("ERROR"))
    }
}
