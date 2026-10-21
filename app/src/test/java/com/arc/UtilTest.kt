package com.arc

import org.junit.Assert.assertEquals
import org.junit.Test

class UtilTest {

    @Test
    fun escapeJs_handlesNull() {
        assertEquals("", Util.escapeJs(null))
    }

    @Test
    fun escapeJs_handlesEmptyString() {
        assertEquals("", Util.escapeJs(""))
    }

    @Test
    fun escapeJs_escapesBackslash() {
        assertEquals("\\\\", Util.escapeJs("\\"))
    }

    @Test
    fun escapeJs_escapesDoubleQuote() {
        assertEquals("\\\"", Util.escapeJs("\""))
    }

    @Test
    fun escapeJs_escapesSingleQuote() {
        assertEquals("\\'", Util.escapeJs("'"))
    }

    @Test
    fun escapeJs_escapesNewline() {
        assertEquals("\\n", Util.escapeJs("\n"))
    }

    @Test
    fun escapeJs_removesCarriageReturn() {
        assertEquals("", Util.escapeJs("\r"))
        assertEquals("a", Util.escapeJs("a\r"))
    }

    @Test
    fun escapeJs_handlesComplexString() {
        val input = "This is a \"test\" string\nwith 'quotes' and \\backslashes\r."
        val expected = "This is a \\\"test\\\" string\\nwith \\'quotes\\' and \\\\backslashes."
        assertEquals(expected, Util.escapeJs(input))
    }
}
