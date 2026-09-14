package com.arc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BotDetectionEngineTest {

    @Test
    fun isLoginRequiredUrl_gemini_matchesCorrectUrls() {
        // True cases
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://accounts.google.com/signin"))
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("GEMINI", "https://myaccount.google.com/"))
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://www.google.com/ServiceLogin"))

        // False cases
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://gemini.google.com"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://google.com"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("gemini", ""))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("gemini", null))
    }

    @Test
    fun isLoginRequiredUrl_chatgpt_matchesCorrectUrls() {
        // True cases
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("chatgpt", "https://auth.openai.com/login"))
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("CHATGPT", "https://chatgpt.com/auth/login"))

        // False cases
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("chatgpt", "https://chatgpt.com"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("chatgpt", "https://openai.com"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("chatgpt", ""))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("chatgpt", null))
    }

    @Test
    fun isLoginRequiredUrl_copilot_matchesCorrectUrls() {
        // True cases
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("copilot", "https://claude.ai/login"))

        // False cases - exclusion condition
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("copilot", "https://claude.ai/login?app-google-auth=1"))

        // False cases - general
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("copilot", "https://claude.ai"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("copilot", "https://copilot.microsoft.com"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("copilot", ""))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("copilot", null))
    }

    @Test
    fun isLoginRequiredUrl_unknownTarget_returnsFalse() {
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("unknown", "https://accounts.google.com/signin"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("", "https://accounts.google.com/signin"))
    }
}
