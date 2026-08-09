package com.arc

import android.util.Log
import io.mockk.every
import io.mockk.mockkStatic
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.After
import org.junit.Before
import org.junit.Test



class UtilTest {

    @Before
    fun setup() {
        mockkStatic(Log::class)
        every { Log.d(any(), any()) } returns 0
        every { Log.w(any(), any<String>()) } returns 0
        every { Log.e(any(), any()) } returns 0
    }

    @After
    fun teardown() {
        unmockkAll()
    }

    @Test
    fun `checkAnomalies detects timeout and logs critical anomaly`() {
        val missionId = "test_mission_1"
        val step = "test_step_1"

        // Simulating a timeout: negative timeout sets deadline in the past
        Util.expect(missionId, step, -1000L)

        Util.checkAnomalies(missionId)

        // Verify trace triggers Log.d with CRITICAL log for this anomaly
        verify {
            Log.d("ARC_TRACE", match {
                it.contains("[CRITICAL]") &&
                it.contains("ANOMALY") &&
                it.contains("Expected milestone [$step] never arrived")
            })
        }
    }

    @Test
    fun `checkAnomalies does not trigger before timeout`() {
        val missionId = "test_mission_2"
        val step = "test_step_2"

        // Future deadline
        Util.expect(missionId, step, 10000L)

        Util.checkAnomalies(missionId)

        // Verify anomaly log is NOT triggered
        verify(exactly = 0) {
            Log.d("ARC_TRACE", match {
                it.contains("[CRITICAL]") &&
                it.contains("ANOMALY") &&
                it.contains("Expected milestone [$step] never arrived")
            })
        }
    }

    @Test
    fun `checkAnomalies ignores other missions`() {
        val missionId = "test_mission_3"
        val otherMissionId = "other_mission"
        val step = "test_step_3"

        // Create an anomaly for a DIFFERENT mission
        Util.expect(otherMissionId, step, -1000L)

        // Check anomalies for THIS mission (should not trigger for other_mission)
        Util.checkAnomalies(missionId)

        verify(exactly = 0) {
            Log.d("ARC_TRACE", match {
                it.contains("[CRITICAL]") &&
                it.contains("ANOMALY")
            })
        }
    }
}
