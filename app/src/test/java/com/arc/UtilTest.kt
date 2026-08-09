package com.arc

import org.junit.Assert.assertEquals
import org.junit.Test

class UtilTest {

    @Test
    fun testEscapeJs_nullInput() {
        assertEquals("", Util.escapeJs(null))
    }

    @Test
    fun testEscapeJs_emptyString() {
        assertEquals("", Util.escapeJs(""))
    }

    @Test
    fun testEscapeJs_normalText() {
        assertEquals("Hello World", Util.escapeJs("Hello World"))
    }

    @Test
    fun testEscapeJs_escapeBackslash() {
        assertEquals("C:\\\\Windows\\\\Path", Util.escapeJs("C:\\Windows\\Path"))
    }

    @Test
    fun testEscapeJs_escapeDoubleQuote() {
        assertEquals("Hello \\\"World\\\"", Util.escapeJs("Hello \"World\""))
    }

    @Test
    fun testEscapeJs_escapeSingleQuote() {
        assertEquals("It\\'s a test", Util.escapeJs("It's a test"))
    }

    @Test
    fun testEscapeJs_escapeNewline() {
        assertEquals("Line1\\nLine2", Util.escapeJs("Line1\nLine2"))
    }

    @Test
    fun testEscapeJs_removeCarriageReturn() {
        assertEquals("Line1\\nLine2", Util.escapeJs("Line1\r\nLine2"))
        assertEquals("JustText", Util.escapeJs("Just\rText"))
    }

    @Test
    fun testEscapeJs_mixedCharacters() {
        val input = "It's a \"test\"\\path\r\nwith multiple\nlines."
        val expected = "It\\'s a \\\"test\\\"\\\\path\\nwith multiple\\nlines."
        assertEquals(expected, Util.escapeJs(input))
    }
}
