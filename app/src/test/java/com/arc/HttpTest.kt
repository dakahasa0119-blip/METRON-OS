package com.arc

import android.util.Log
import io.mockk.every
import io.mockk.mockkObject
import io.mockk.mockkStatic
import io.mockk.unmockkAll
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.io.IOException

class HttpTest {

    @Before
    fun setUp() {
        mockkStatic(Log::class)
        every { Log.w(any(), any<String>()) } returns 0
        every { Log.e(any(), any<String>()) } returns 0
        every { Log.d(any(), any<String>()) } returns 0

        mockkObject(Http)
    }

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `post succeeds on first attempt`() = runTest {
        val url = "http://example.com"
        val json = "{}"
        val expectedResponse = """{"status":"OK"}"""

        every { Http.executePost(url, json) } returns expectedResponse

        val response = Http.post(url, json)

        assertEquals(expectedResponse, response)
        verify(exactly = 1) { Http.executePost(url, json) }
    }

    @Test
    fun `post retries on failure and eventually succeeds`() = runTest {
        val url = "http://example.com"
        val json = "{}"
        val expectedResponse = """{"status":"OK"}"""

        every { Http.executePost(url, json) } throws IOException("Network error") andThen expectedResponse

        val response = Http.post(url, json)

        assertEquals(expectedResponse, response)
        verify(exactly = 2) { Http.executePost(url, json) }
        verify(exactly = 1) { Log.w("Http", "Attempt 1 failed: Network error") }
    }

    @Test
    fun `post exhausts max retries and returns error JSON`() = runTest {
        val url = "http://example.com"
        val json = "{}"

        every { Http.executePost(url, json) } throws IOException("Network error")

        val response = Http.post(url, json)

        val expectedErrorJson = """{"status":"ERROR","message":"Network error"}"""
        assertEquals(expectedErrorJson, response)
        verify(exactly = 3) { Http.executePost(url, json) }
        verify(exactly = 1) { Log.w("Http", "Attempt 1 failed: Network error") }
        verify(exactly = 1) { Log.w("Http", "Attempt 2 failed: Network error") }
        verify(exactly = 1) { Log.w("Http", "Attempt 3 failed: Network error") }
        verify(exactly = 1) { Log.e("Http", "All 3 attempts failed for $url") }
    }

    @Test
    fun `post respects custom maxRetries parameter`() = runTest {
        val url = "http://example.com"
        val json = "{}"
        val customMaxRetries = 5

        every { Http.executePost(url, json) } throws IOException("Network error")

        val response = Http.post(url, json, customMaxRetries)

        val expectedErrorJson = """{"status":"ERROR","message":"Network error"}"""
        assertEquals(expectedErrorJson, response)
        verify(exactly = 5) { Http.executePost(url, json) }
        verify(exactly = 1) { Log.e("Http", "All 5 attempts failed for $url") }
    }
}
