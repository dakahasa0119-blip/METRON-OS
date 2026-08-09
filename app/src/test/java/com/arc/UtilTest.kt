package com.arc

import android.util.Log
import io.mockk.every
import io.mockk.mockkStatic
import io.mockk.unmockkAll
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import java.lang.reflect.Field
import java.util.concurrent.ConcurrentHashMap

class UtilTest {

    @Before
    fun setUp() {
        // Mock android.util.Log
        mockkStatic(Log::class)
        every { Log.d(any(), any()) } returns 0
        every { Log.w(any(), any<String>()) } returns 0
    }

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `expect should insert expected milestone correctly`() {
        // Arrange
        val missionId = "TEST_MISSION_123"
        val step = "INITIALIZATION"
        val timeoutMs = 5000L
        val startTime = System.currentTimeMillis()

        // Use reflection to access the private expectedMilestones field
        val expectedMilestonesField: Field = Util::class.java.getDeclaredField("expectedMilestones")
        expectedMilestonesField.isAccessible = true

        @Suppress("UNCHECKED_CAST")
        val expectedMilestones = expectedMilestonesField.get(Util) as ConcurrentHashMap<String, Long>

        // Clear before test to avoid interference
        expectedMilestones.clear()

        // Act
        Util.expect(missionId, step, timeoutMs)

        // Assert
        val key = "${missionId}_$step"
        assertTrue("Key should exist in expectedMilestones", expectedMilestones.containsKey(key))

        val deadline = expectedMilestones[key]!!
        val endTime = System.currentTimeMillis()

        // Deadline should be approx startTime + timeoutMs
        assertTrue("Deadline should be greater than or equal to startTime + timeoutMs", deadline >= startTime + timeoutMs)
        assertTrue("Deadline should be reasonably close to startTime + timeoutMs", deadline <= endTime + timeoutMs)
    }
}
