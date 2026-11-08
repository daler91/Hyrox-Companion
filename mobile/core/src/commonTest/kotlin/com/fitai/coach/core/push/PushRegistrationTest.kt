package com.fitai.coach.core.push

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.data.FakeServer
import com.fitai.coach.core.data.Reply
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PushRegistrationTest {
    private val server = FakeServer()

    private class FakeTokens : PushTokens {
        var token = "t1"
        var deleted = 0

        override suspend fun current(): String = token

        override suspend fun delete() {
            deleted++
        }
    }

    private class MemoryPreference(override var enabledFor: String? = null) : PushPreference

    private val tokens = FakeTokens()
    private val preference = MemoryPreference()
    private val push = PushRegistration(server.api, tokens, preference)

    private fun registrations() = server.sentTo("POST", "/api/v1/push/devices").map { it.body }

    @Test
    fun turningPushOnRegistersThisInstallForTheUser() = runTest {
        server.on("POST", "/api/v1/push/devices", 200, """{"success":true}""")
        push.enable("u1")
        assertEquals(listOf("""{"token":"t1","platform":"android"}"""), registrations())
        assertEquals("u1", push.enabledFor.value)
        assertEquals("u1", preference.enabledFor)
    }

    @Test
    fun aServerWithoutPushLeavesItOff() = runTest {
        server.on("POST", "/api/v1/push/devices", 404, """{"error":"Push notifications not configured","code":"PUSH_NOT_CONFIGURED"}""")
        assertFailsWith<ApiException> { push.enable("u1") }
        assertNull(push.enabledFor.value)
    }

    @Test
    fun launchesAndNewTokensRegisterOnlyForTheUserWhoTurnedItOn() = runTest {
        server.on("POST", "/api/v1/push/devices", 200, """{"success":true}""")
        push.refresh("u1")
        push.onNewToken("t2", "u1")
        assertTrue(registrations().isEmpty())

        push.enable("u1")
        push.refresh("u2")
        push.onNewToken("t2", null)
        push.onNewToken("t3", "u1")
        push.refresh("u1")
        assertEquals(3, registrations().size)
        assertTrue(registrations()[1]!!.contains("\"t3\""))
    }

    @Test
    fun turningPushOffUnregistersAndDeletesTheTokenEvenOffline() = runTest {
        server.on("POST", "/api/v1/push/devices", 200, """{"success":true}""")
        push.enable("u1")
        server.on("DELETE", "/api/v1/push/devices") { Reply.NoAnswer }

        push.disable()

        assertEquals(listOf("""{"token":"t1"}"""), server.sentTo("DELETE", "/api/v1/push/devices").map { it.body })
        assertEquals(1, tokens.deleted)
        assertNull(push.enabledFor.value)
        assertNull(preference.enabledFor)
    }

    @Test
    fun aBuildWithoutPushHasNothingToTurnOn() = runTest {
        val none = PushRegistration(server.api, null, MemoryPreference())
        assertFalse(none.available)
        assertFailsWith<IllegalStateException> { none.enable("u1") }
        none.disable()
        assertTrue(server.requests.isEmpty())
    }
}
