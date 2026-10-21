package com.arc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UtilTest {

    @Test
    fun parseTarget_happyPath() {
        assertEquals(AiTarget.GEMINI, Util.parseTarget("GEMINI"))
        assertEquals(AiTarget.CHATGPT, Util.parseTarget("GPT"))
        assertEquals(AiTarget.CHATGPT, Util.parseTarget("CHATGPT"))
        assertEquals(AiTarget.COPILOT, Util.parseTarget("COPILOT"))
        assertEquals(AiTarget.FULL_BROWSER, Util.parseTarget("FULL_BROWSER"))
        assertEquals(AiTarget.MOBILE_BROWSER, Util.parseTarget("MOBILE_BROWSER"))
        assertEquals(AiTarget.GATEWAY_ADVISOR, Util.parseTarget("GATEWAY_ADVISOR"))
    }

    @Test
    fun parseTarget_caseInsensitive() {
        assertEquals(AiTarget.GEMINI, Util.parseTarget("gemini"))
        assertEquals(AiTarget.CHATGPT, Util.parseTarget("gpt"))
        assertEquals(AiTarget.CHATGPT, Util.parseTarget("ChatGpt"))
        assertEquals(AiTarget.COPILOT, Util.parseTarget("CoPilot"))
        assertEquals(AiTarget.FULL_BROWSER, Util.parseTarget("full_browser"))
        assertEquals(AiTarget.MOBILE_BROWSER, Util.parseTarget("mobile_browser"))
        assertEquals(AiTarget.GATEWAY_ADVISOR, Util.parseTarget("gateway_advisor"))
    }

    @Test
    fun parseTarget_edgeCases() {
        assertNull(Util.parseTarget(""))
        assertNull(Util.parseTarget("INVALID_TARGET"))
        assertNull(Util.parseTarget("GEMINI_PRO")) // Assuming this is invalid based on current logic
        assertNull(Util.parseTarget("    "))
    }
}
