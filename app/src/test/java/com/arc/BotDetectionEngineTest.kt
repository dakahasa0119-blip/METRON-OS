package com.arc

import org.junit.Assert.*
import org.junit.Test

class BotDetectionEngineTest {

    @Test
    fun testIsLoginRequiredUrl() {
        // Test gemini
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://accounts.google.com/"))
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://myaccount.google.com/"))
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://servicelogin.google.com/"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://gemini.google.com/"))

        // Test chatgpt
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("chatgpt", "https://auth.openai.com/"))
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("chatgpt", "https://chatgpt.com/auth"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("chatgpt", "https://chatgpt.com/"))

        // Test copilot
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("copilot", "https://claude.ai/login"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("copilot", "https://claude.ai/login/app-google-auth"))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("copilot", "https://copilot.microsoft.com/"))

        // Edge cases
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("gemini", null))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("gemini", ""))
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("gemini", "   "))

        // Target case insensitivity
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("GEMINI", "https://accounts.google.com/"))

        // URL case insensitivity
        assertTrue(BotDetectionEngine.isLoginRequiredUrl("gemini", "https://ACCOUNTS.GOOGLE.COM/"))

        // Unknown target
        assertFalse(BotDetectionEngine.isLoginRequiredUrl("unknown", "https://accounts.google.com/"))
    }
}
