package com.arc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BotDetectionEngineTest {

    @Test
    fun testClassifyGeminiErrorType_nullInput() {
        assertNull(BotDetectionEngine.classifyGeminiErrorType(null))
    }

    @Test
    fun testClassifyGeminiErrorType_emptyInput() {
        assertNull(BotDetectionEngine.classifyGeminiErrorType(""))
        assertNull(BotDetectionEngine.classifyGeminiErrorType("   "))
    }

    @Test
    fun testClassifyGeminiErrorType_codeMatch_code() {
        assertEquals("GEMINI_FAIL_429", BotDetectionEngine.classifyGeminiErrorType("code:429"))
        assertEquals("GEMINI_FAIL_500", BotDetectionEngine.classifyGeminiErrorType("Code_500"))
        // Regex matches "code:" or "code_" followed immediately by digits.
        assertEquals("GEMINI_FAIL_403", BotDetectionEngine.classifyGeminiErrorType("error code:403"))
    }

    @Test
    fun testClassifyGeminiErrorType_codeMatch_geminiFail() {
        assertEquals("GEMINI_FAIL_429", BotDetectionEngine.classifyGeminiErrorType("gemini_fail_429"))
        assertEquals("GEMINI_FAIL_500", BotDetectionEngine.classifyGeminiErrorType("GEMINI_FAIL_500"))
    }

    @Test
    fun testClassifyGeminiErrorType_generic_strongTokens() {
        assertEquals("GEMINI_FAIL_GENERIC", BotDetectionEngine.classifyGeminiErrorType("generic: network error occurred"))
        assertEquals("GEMINI_FAIL_GENERIC", BotDetectionEngine.classifyGeminiErrorType("generic: temporarily unavailable right now"))
        assertEquals("GEMINI_FAIL_GENERIC", BotDetectionEngine.classifyGeminiErrorType("generic: problem generating response"))
        assertEquals("GEMINI_FAIL_GENERIC", BotDetectionEngine.classifyGeminiErrorType("generic: something went wrong..."))
    }

    @Test
    fun testClassifyGeminiErrorType_generic_noStrongTokens() {
        assertNull(BotDetectionEngine.classifyGeminiErrorType("generic: just a regular error"))
        assertNull(BotDetectionEngine.classifyGeminiErrorType("generic: 404 not found"))
    }

    @Test
    fun testClassifyGeminiErrorType_unrelatedString() {
        assertNull(BotDetectionEngine.classifyGeminiErrorType("random error text"))
    }
}
