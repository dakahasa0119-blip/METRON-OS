package com.arc

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class BotDetectionEngineTest {

    @Test
    fun decideRecoveryAction_emptyAdvice_returnsRetry() {
        val result = BotDetectionEngine.decideRecoveryAction("   ")
        assertEquals(RecoveryAction.RETRY, result.action)
        assertEquals("empty_advice", result.note)
    }

    @Test
    fun decideRecoveryAction_validJson_returnsParsedAction() {
        val json = """{"action": "REFRESH", "note": "manual refresh"}"""
        val result = BotDetectionEngine.decideRecoveryAction(json)
        assertEquals(RecoveryAction.REFRESH, result.action)
        assertEquals("manual refresh", result.note)
    }

    @Test
    fun decideRecoveryAction_validJsonEmptyNote_returnsJsonNote() {
        val json = """{"action": "CLICK_UNBLOCK"}"""
        val result = BotDetectionEngine.decideRecoveryAction(json)
        assertEquals(RecoveryAction.CLICK_UNBLOCK, result.action)
        assertEquals("json", result.note)
    }

    @Test
    fun decideRecoveryAction_botBlockedSignal_returnsEscalate() {
        // "cloudflare_challenge_persistent" is a hardMark (60 points) which makes it BOT_BLOCKED
        val result = BotDetectionEngine.decideRecoveryAction("cloudflare_challenge_persistent")
        assertEquals(RecoveryAction.ESCALATE, result.action)
        assertNotNull(result.signal)
        assertEquals(BotDecision.BOT_BLOCKED, result.signal?.decision)
    }

    @Test
    fun decideRecoveryAction_cookieKeyword_returnsClickUnblock() {
        val result = BotDetectionEngine.decideRecoveryAction("please accept cookie consent")
        assertEquals(RecoveryAction.CLICK_UNBLOCK, result.action)
        assertEquals("consent", result.note)
    }

    @Test
    fun decideRecoveryAction_refreshKeyword_returnsRefresh() {
        val result = BotDetectionEngine.decideRecoveryAction("reload the page")
        assertEquals(RecoveryAction.REFRESH, result.action)
        assertEquals("refresh", result.note)
    }

    @Test
    fun decideRecoveryAction_switchKeyword_returnsRetry() {
        val result = BotDetectionEngine.decideRecoveryAction("switch to gemini")
        assertEquals(RecoveryAction.RETRY, result.action)
        assertEquals("target_switch_blocked", result.note)
    }

    @Test
    fun decideRecoveryAction_loginKeyword_returnsEscalate() {
        val result = BotDetectionEngine.decideRecoveryAction("login required")
        assertEquals(RecoveryAction.ESCALATE, result.action)
        assertEquals("blocked", result.note)
    }

    @Test
    fun decideRecoveryAction_waitKeyword_returnsWait() {
        val result = BotDetectionEngine.decideRecoveryAction("wait a moment")
        assertEquals(RecoveryAction.WAIT, result.action)
        assertEquals("wait", result.note)
    }

    @Test
    fun decideRecoveryAction_fallback_returnsRetry() {
        val result = BotDetectionEngine.decideRecoveryAction("some random string without keywords")
        assertEquals(RecoveryAction.RETRY, result.action)
        assertEquals("fallback", result.note)
    }
}
