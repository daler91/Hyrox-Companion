package com.fitai.coach.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.auth.AuthException
import com.fitai.coach.core.auth.AuthGateway
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Where the sign-in flow is. */
sealed interface SignInStep {
    data object EnterEmail : SignInStep

    /** A code has been emailed to [email]. */
    data class EnterCode(val email: String) : SignInStep
}

data class SignInUiState(
    val step: SignInStep = SignInStep.EnterEmail,
    val email: String = "",
    val code: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    /** A non-error confirmation, e.g. after resending the code. */
    val notice: String? = null,
)

/**
 * Drives the sign-in screen: an emailed one-time code, or Google. A new
 * address gets the same two steps (the gateway signs it up). Signing in
 * succeeds by changing [AuthGateway.state]; this view model only tracks the
 * form.
 */
class SignInViewModel(private val auth: AuthGateway) : ViewModel() {
    private val mutableState = MutableStateFlow(SignInUiState())
    val state: StateFlow<SignInUiState> = mutableState.asStateFlow()

    fun onEmailChange(value: String) = mutableState.update { it.copy(email = value, error = null) }

    fun onCodeChange(value: String) = mutableState.update {
        it.copy(code = value.filter(Char::isDigit).take(CODE_LENGTH), error = null)
    }

    fun submitEmail() {
        val email = state.value.email.trim()
        if (!EMAIL.matches(email)) {
            mutableState.update { it.copy(error = "enter a full email address, like you@example.com.") }
            return
        }
        run {
            auth.sendEmailCode(email)
            mutableState.update { it.copy(step = SignInStep.EnterCode(email), code = "", notice = null) }
        }
    }

    fun submitCode() {
        if (state.value.code.length != CODE_LENGTH) {
            mutableState.update { it.copy(error = "enter the $CODE_LENGTH-digit code from the email.") }
            return
        }
        run { auth.verifyEmailCode(state.value.code) }
    }

    fun resendCode() {
        val step = state.value.step as? SignInStep.EnterCode ?: return
        run {
            auth.sendEmailCode(step.email)
            mutableState.update { it.copy(code = "", notice = "new code sent to ${step.email}.") }
        }
    }

    fun changeEmail() = mutableState.update { it.copy(step = SignInStep.EnterEmail, code = "", error = null, notice = null) }

    fun signInWithGoogle() = run { auth.signInWithGoogle() }

    /**
     * Runs one auth step: no double submits, and any failure becomes a message
     * on screen. Network and SDK failures are caught broadly on purpose: the
     * user's only recourse is to retry, so they all get the same message.
     */
    @Suppress("TooGenericExceptionCaught", "SwallowedException")
    private fun run(step: suspend () -> Unit) {
        if (state.value.busy) return
        mutableState.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val error = try {
                step()
                null
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthException) {
                e.message ?: GENERIC_ERROR
            } catch (e: Exception) {
                GENERIC_ERROR
            }
            mutableState.update { it.copy(busy = false, error = error) }
        }
    }

    private companion object {
        const val CODE_LENGTH = 6
        const val GENERIC_ERROR = "something went wrong. check your connection and retry."
        val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
    }
}
