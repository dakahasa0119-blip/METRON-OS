package com.arc

import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.json.JSONObject

@OptIn(ExperimentalCoroutinesApi::class)
class GatewayClientTest {

    private lateinit var prefs: Prefs
    private lateinit var client: GatewayClient
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        prefs = mockk(relaxed = true)
        mockkObject(Http)
        mockkObject(Util)
        mockkObject(MainActivity.Companion)
        client = GatewayClient(prefs)
    }

    @After
    fun tearDown() {
        unmockkAll()
        Dispatchers.resetMain()
    }

    @Test
    fun performHandshake_callsCallbackWithFalse_whenGasUrlIsBlank() = runTest(testDispatcher) {
        every { prefs.gasUrl } returns ""

        var result: Boolean? = null
        client.performHandshake {
            result = it
        }

        advanceUntilIdle()
        assertEquals(false, result)
    }

    @Test
    fun performHandshake_callsCallbackWithTrue_whenHttpResponseContainsACK() = runTest(testDispatcher) {
        every { prefs.gasUrl } returns "http://example.com"
        every { Util.getLocalIpAddress() } returns "127.0.0.1"
        every { MainActivity.serverPort } returns 8080
        coEvery { Http.post("http://example.com", any()) } returns "ACK from gateway"

        var result: Boolean? = null
        client.performHandshake {
            result = it
        }

        advanceUntilIdle()
        assertEquals(true, result)
    }

    @Test
    fun performHandshake_callsCallbackWithTrue_whenHttpResponseContainsSuccess() = runTest(testDispatcher) {
        every { prefs.gasUrl } returns "http://example.com"
        every { Util.getLocalIpAddress() } returns "127.0.0.1"
        every { MainActivity.serverPort } returns 8080
        coEvery { Http.post("http://example.com", any()) } returns "Success received"

        var result: Boolean? = null
        client.performHandshake {
            result = it
        }

        advanceUntilIdle()
        assertEquals(true, result)
    }

    @Test
    fun performHandshake_callsCallbackWithTrue_whenHttpResponseContainsStatusOk() = runTest(testDispatcher) {
        every { prefs.gasUrl } returns "http://example.com"
        every { Util.getLocalIpAddress() } returns "127.0.0.1"
        every { MainActivity.serverPort } returns 8080
        coEvery { Http.post("http://example.com", any()) } returns """{"status":"ok"}"""

        var result: Boolean? = null
        client.performHandshake {
            result = it
        }

        advanceUntilIdle()
        assertEquals(true, result)
    }

    @Test
    fun performHandshake_callsCallbackWithFalse_whenHttpResponseDoesNotContainSuccessIndicators() = runTest(testDispatcher) {
        every { prefs.gasUrl } returns "http://example.com"
        every { Util.getLocalIpAddress() } returns "127.0.0.1"
        every { MainActivity.serverPort } returns 8080
        coEvery { Http.post("http://example.com", any()) } returns """{"status":"error"}"""

        var result: Boolean? = null
        client.performHandshake {
            result = it
        }

        advanceUntilIdle()
        assertEquals(false, result)
    }

    @Test
    fun performHandshake_callsCallbackWithFalse_whenHttpPostThrowsException() = runTest(testDispatcher) {
        every { prefs.gasUrl } returns "http://example.com"
        every { Util.getLocalIpAddress() } returns "127.0.0.1"
        every { MainActivity.serverPort } returns 8080
        coEvery { Http.post("http://example.com", any()) } throws RuntimeException("Network error")

        var result: Boolean? = null
        client.performHandshake {
            result = it
        }

        advanceUntilIdle()
        assertEquals(false, result)
    }
}
