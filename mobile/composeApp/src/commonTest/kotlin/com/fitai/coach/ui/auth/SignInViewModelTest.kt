package com.fitai.coach.ui.auth

import com.fitai.coach.core.auth.AuthException
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class FakeAuth : AuthGateway {
    override val state: StateFlow<AuthState> = MutableStateFlow(AuthState.SignedOut)
    val sentTo = mutableListOf<String>()
    val verified = mutableListOf<String>()
    var failWith: Exception? = null

    override suspend fun sendEmailCode(email: String) {
        failWith?.let { throw it }
        sentTo += email
    }

    override suspend fun verifyEmailCode(code: String) {
        failWith?.let { throw it }
        verified += code
    }

    override suspend fun signInWithGoogle() {
        failWith?.let { throw it }
    }

    override suspend fun signOut() = Unit
}

@OptIn(ExperimentalCoroutinesApi::class)
class SignInViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val auth = FakeAuth()

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun rejectsAnIncompleteEmailWithoutCallingTheGateway() = runTest(dispatcher) {
        val vm = SignInViewModel(auth)
        vm.onEmailChange("you@")

        vm.submitEmail()
        advanceUntilIdle()

        assertTrue(auth.sentTo.isEmpty())
        assertEquals(SignInStep.EnterEmail, vm.state.value.step)
        assertTrue(vm.state.value.error!!.isNotEmpty())
    }

    @Test
    fun sendsTheTrimmedEmailAndMovesToTheCodeStep() = runTest(dispatcher) {
        val vm = SignInViewModel(auth)
        vm.onEmailChange("  you@example.com ")

        vm.submitEmail()
        advanceUntilIdle()

        assertEquals(listOf("you@example.com"), auth.sentTo)
        assertEquals(SignInStep.EnterCode("you@example.com"), vm.state.value.step)
        assertFalse(vm.state.value.busy)
    }

    @Test
    fun keepsOnlySixDigitsOfTheCode() {
        val vm = SignInViewModel(auth)

        vm.onCodeChange("12a 3456789")

        assertEquals("123456", vm.state.value.code)
    }

    @Test
    fun verifiesAFullCode() = runTest(dispatcher) {
        val vm = SignInViewModel(auth)
        vm.onEmailChange("you@example.com")
        vm.submitEmail()
        advanceUntilIdle()
        vm.onCodeChange("123456")

        vm.submitCode()
        advanceUntilIdle()

        assertEquals(listOf("123456"), auth.verified)
        assertNull(vm.state.value.error)
    }

    @Test
    fun showsTheGatewayMessageWhenACodeIsWrong() = runTest(dispatcher) {
        val vm = SignInViewModel(auth)
        vm.onEmailChange("you@example.com")
        vm.submitEmail()
        advanceUntilIdle()
        auth.failWith = AuthException("that code is incorrect.")
        vm.onCodeChange("000000")

        vm.submitCode()
        advanceUntilIdle()

        assertEquals("that code is incorrect.", vm.state.value.error)
        assertFalse(vm.state.value.busy)
    }

    @Test
    fun turnsOtherFailuresIntoARetryMessage() = runTest(dispatcher) {
        val vm = SignInViewModel(auth)
        auth.failWith = IllegalStateException("socket closed")
        vm.onEmailChange("you@example.com")

        vm.submitEmail()
        advanceUntilIdle()

        assertEquals("something went wrong. check your connection and retry.", vm.state.value.error)
        assertEquals(SignInStep.EnterEmail, vm.state.value.step)
    }

    @Test
    fun ignoresASecondSubmitWhileTheFirstIsRunning() = runTest(dispatcher) {
        val vm = SignInViewModel(auth)
        vm.onEmailChange("you@example.com")

        vm.submitEmail()
        vm.submitEmail()
        advanceUntilIdle()

        assertEquals(1, auth.sentTo.size)
    }

    @Test
    fun resendsToTheSameAddressAndSaysSo() = runTest(dispatcher) {
        val vm = SignInViewModel(auth)
        vm.onEmailChange("you@example.com")
        vm.submitEmail()
        advanceUntilIdle()

        vm.resendCode()
        advanceUntilIdle()

        assertEquals(listOf("you@example.com", "you@example.com"), auth.sentTo)
        assertEquals("new code sent to you@example.com.", vm.state.value.notice)
    }
}
