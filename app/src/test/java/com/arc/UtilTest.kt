package com.arc

import org.junit.After
import org.junit.Test
import org.junit.Assert.assertEquals
import io.mockk.*
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.Collections

class UtilTest {

    @After
    fun tearDown() {
        unmockkStatic(NetworkInterface::class)
    }

    @Test
    fun testGetLocalIpAddress_mockedSuccess() {
        mockkStatic(NetworkInterface::class)

        val mockInterface = mockk<NetworkInterface>()
        val mockAddress = mockk<InetAddress>()

        every { NetworkInterface.getNetworkInterfaces() } returns Collections.enumeration(listOf(mockInterface))
        every { mockInterface.inetAddresses } returns Collections.enumeration(listOf(mockAddress))
        every { mockAddress.isLoopbackAddress } returns false
        every { mockAddress.hostAddress } returns "192.168.1.100"

        val ipAddress = Util.getLocalIpAddress()
        assertEquals("192.168.1.100", ipAddress)
    }

    @Test
    fun testGetLocalIpAddress_mockedLoopback() {
        mockkStatic(NetworkInterface::class)

        val mockInterface = mockk<NetworkInterface>()
        val mockAddress = mockk<InetAddress>()

        every { NetworkInterface.getNetworkInterfaces() } returns Collections.enumeration(listOf(mockInterface))
        every { mockInterface.inetAddresses } returns Collections.enumeration(listOf(mockAddress))
        every { mockAddress.isLoopbackAddress } returns true
        every { mockAddress.hostAddress } returns "127.0.0.1"

        val ipAddress = Util.getLocalIpAddress()
        assertEquals("unknown", ipAddress)
    }

    @Test
    fun testGetLocalIpAddress_mockedIpv6() {
        mockkStatic(NetworkInterface::class)

        val mockInterface = mockk<NetworkInterface>()
        val mockAddress = mockk<InetAddress>()

        every { NetworkInterface.getNetworkInterfaces() } returns Collections.enumeration(listOf(mockInterface))
        every { mockInterface.inetAddresses } returns Collections.enumeration(listOf(mockAddress))
        every { mockAddress.isLoopbackAddress } returns false
        every { mockAddress.hostAddress } returns "fe80::1ff:fe23:4567:890a"

        val ipAddress = Util.getLocalIpAddress()
        assertEquals("unknown", ipAddress)
    }

    @Test
    fun testGetLocalIpAddress_mockedException() {
        mockkStatic(NetworkInterface::class)

        every { NetworkInterface.getNetworkInterfaces() } throws RuntimeException("Network error")

        val ipAddress = Util.getLocalIpAddress()
        assertEquals("unknown", ipAddress)
    }
}
