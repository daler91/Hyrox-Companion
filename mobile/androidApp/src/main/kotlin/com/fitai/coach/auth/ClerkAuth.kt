package com.fitai.coach.auth

import com.clerk.api.Clerk
import com.clerk.api.auth.types.VerificationType
import com.clerk.api.network.model.error.ClerkErrorResponse
import com.clerk.api.network.serialization.ClerkResult
import com.clerk.api.network.serialization.errorMessage
import com.clerk.api.signin.SignIn
import com.clerk.api.signin.sendCode
import com.clerk.api.signin.verifyCode
import com.clerk.api.signup.SignUp
import com.clerk.api.signup.sendCode
import com.clerk.api.signup.verifyCode
import com.fitai.coach.core.auth.AuthException
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.core.auth.AuthTokenProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

/**
 * Clerk's Android SDK behind the app's auth ports: [AuthTokenProvider] for
 * the API client and [AuthGateway] for the sign-in screens.
 *
 * The SDK keeps the session on disk, so it survives force-stop and reboot,
 * and caches and refreshes the 60-second session token itself.
 */
class ClerkAuth(scope: CoroutineScope) :
    AuthGateway,
    AuthTokenProvider {
    override val state: StateFlow<AuthState> =
        combine(Clerk.isInitialized, Clerk.sessionFlow, Clerk.userFlow) { initialized, session, user ->
            when {
                !initialized -> AuthState.Loading
                session == null || user == null -> AuthState.SignedOut
                else -> AuthState.SignedIn(user.id)
            }
        }.stateIn(scope, SharingStarted.Eagerly, AuthState.Loading)

    /** The email-code flow in progress: a sign-in for a known address, a sign-up for a new one. */
    private sealed interface Pending {
        data class ExistingAccount(val signIn: SignIn) : Pending

        data class NewAccount(val signUp: SignUp) : Pending
    }

    @Volatile private var pending: Pending? = null

    override suspend fun token(): String? {
        if (Clerk.session == null) return null
        return when (val result = Clerk.auth.getToken()) {
            is ClerkResult.Success -> result.value
            is ClerkResult.Failure -> null
        }
    }

    override suspend fun sendEmailCode(email: String) {
        pending = when (val started = Clerk.auth.signIn { this.email = email }) {
            is ClerkResult.Success -> Pending.ExistingAccount(started.value.sendCode { this.email = email }.orThrow())
            is ClerkResult.Failure -> {
                if (!started.isUnknownIdentifier()) throw started.toAuthException()
                val signUp = Clerk.auth.signUp { this.email = email }.orThrow()
                Pending.NewAccount(signUp.sendCode { this.email = email }.orThrow())
            }
        }
    }

    override suspend fun verifyEmailCode(code: String) {
        when (val flow = pending ?: throw AuthException("that code has expired. request a new one.")) {
            is Pending.ExistingAccount -> {
                val signIn = flow.signIn.verifyCode(code).orThrow()
                if (signIn.status != SignIn.Status.COMPLETE) throw AuthException(NEEDS_ANOTHER_STEP)
            }
            is Pending.NewAccount -> {
                val signUp = flow.signUp.verifyCode(code, VerificationType.EMAIL).orThrow()
                if (signUp.status != SignUp.Status.COMPLETE) throw AuthException(NEEDS_MORE_DETAILS)
            }
        }
        pending = null
    }

    override suspend fun signInWithGoogle() {
        Clerk.auth.signInWithGoogleOneTap().orThrow()
    }

    override suspend fun signOut() {
        pending = null
        Clerk.auth.signOut().orThrow()
    }
}

// Flows the email-code screens don't cover (second factor, required profile
// fields) are finished on the web for now.
private const val NEEDS_ANOTHER_STEP = "this account needs another sign-in step. use the web app."
private const val NEEDS_MORE_DETAILS = "this account needs more details. finish signing up on the web."

private fun <T : Any> ClerkResult<T, ClerkErrorResponse>.orThrow(): T = when (this) {
    is ClerkResult.Success -> value
    is ClerkResult.Failure -> throw toAuthException()
}

private fun ClerkResult.Failure<ClerkErrorResponse>.toAuthException(): AuthException =
    AuthException(errorMessage, error?.errors?.firstOrNull()?.code)

/** Clerk's code for a sign-in whose email has no account. */
private fun ClerkResult.Failure<ClerkErrorResponse>.isUnknownIdentifier(): Boolean =
    error?.errors?.any { it.code == "form_identifier_not_found" } == true
