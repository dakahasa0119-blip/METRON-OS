package com.arc

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsActivityTest {

    @Test
    fun testIsValidJson() {
        val validJson = "{\"key\": \"value\"}"
        val invalidJson = "invalid json"

        assertTrue(SettingsActivity.isValidJson(validJson))
        assertFalse(SettingsActivity.isValidJson(invalidJson))
    }
}
