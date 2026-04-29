package com.arc

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.Mock
import org.mockito.MockitoAnnotations

class WebViewDiagnosticProbeTest {

    @Mock
    private lateinit var mockWeb: WebViewManager
    @Mock
    private lateinit var mockGateway: GatewayClient
    @Mock
    private lateinit var mockPrefs: Prefs

    private lateinit var probe: WebViewDiagnosticProbe

    @Before
    fun setup() {
        MockitoAnnotations.openMocks(this)
        probe = WebViewDiagnosticProbe(mockWeb, mockGateway, mockPrefs, CoroutineScope(Dispatchers.Unconfined))
    }

    @Test
    fun testSha256Hex_empty() {
        val result = probe.sha256Hex("")
        assertEquals("", result)
    }

    @Test
    fun testSha256Hex_blank() {
        val result = probe.sha256Hex("   ")
        assertEquals("", result)
    }

    @Test
    fun testSha256Hex_valid() {
        val text = "hello world"
        val expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        val result = probe.sha256Hex(text)
        assertEquals(expected, result)
    }

    @Test
    fun testParseJsJsonString_empty() {
        val result = probe.parseJsJsonString("")
        assertEquals(0, result.length())
    }

    @Test
    fun testParseJsJsonString_nullString() {
        val result = probe.parseJsJsonString("null")
        assertEquals(0, result.length())
    }

    @Test
    fun testParseJsJsonString_valid() {
        val raw = "{\"key\":\"value\"}"
        val result = probe.parseJsJsonString(raw)
        assertEquals("value", result.optString("key"))
    }

    @Test
    fun testParseJsJsonString_invalid() {
        val raw = "invalid json"
        val result = probe.parseJsJsonString(raw)
        assertEquals("invalid json", result.optString("raw"))
    }
}
