package com.arc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UtilTest {

    @Test
    fun parseTarget_happyPath_returnsCorrectTarget() {
        assertEquals(AiTarget.GEMINI, Util.parseTarget(Util.TAG_GEMINI))
        assertEquals(AiTarget.CHATGPT, Util.parseTarget("GPT"))
        assertEquals(AiTarget.CHATGPT, Util.parseTarget("CHATGPT"))
        assertEquals(AiTarget.COPILOT, Util.parseTarget(Util.TAG_COPILOT))
        assertEquals(AiTarget.FULL_BROWSER, Util.parseTarget("FULL_BROWSER"))
        assertEquals(AiTarget.MOBILE_BROWSER, Util.parseTarget("MOBILE_BROWSER"))
        assertEquals(AiTarget.GATEWAY_ADVISOR, Util.parseTarget("GATEWAY_ADVISOR"))
    }

    @Test
    fun parseTarget_caseInsensitive_returnsCorrectTarget() {
        assertEquals(AiTarget.GEMINI, Util.parseTarget("gemini"))
        assertEquals(AiTarget.CHATGPT, Util.parseTarget("gpt"))
        assertEquals(AiTarget.CHATGPT, Util.parseTarget("ChatGpt"))
        assertEquals(AiTarget.COPILOT, Util.parseTarget("CoPiLoT"))
        assertEquals(AiTarget.FULL_BROWSER, Util.parseTarget("full_browser"))
        assertEquals(AiTarget.MOBILE_BROWSER, Util.parseTarget("Mobile_Browser"))
        assertEquals(AiTarget.GATEWAY_ADVISOR, Util.parseTarget("gateway_advisor"))
    }

    @Test
    fun parseTarget_invalidString_returnsNull() {
        assertNull(Util.parseTarget("INVALID"))
        assertNull(Util.parseTarget("CLAUDE"))
        assertNull(Util.parseTarget("SOMETHING_ELSE"))
    }

    @Test
    fun parseTarget_emptyString_returnsNull() {
        assertNull(Util.parseTarget(""))
        assertNull(Util.parseTarget("   "))
    }
}
