package com.fitai.coach.core.auth

import kotlinx.coroutines.flow.StateFlow

/** Whether someone is signed in. */
public sealed interface AuthState {
    /** The auth SDK is still restoring its session from disk. */
    public data object Loading : AuthState

    public data object SignedOut : AuthState

    /** [userId] is the Clerk user id, which the server also keys data by. */
    public data class SignedIn(val userId: String) : AuthState
}

/** A failed auth step, with a message fit to show the user. */
public class AuthException(message: String, public val code: String? = null) : Exception(message)

/**
 * The sign-in operations the shared UI drives. Clerk implements it on Android
 * (androidApp); a Swift bridge will on iOS. It covers the two flows the plan
 * names: an email code, and native Google sign-in.
 */
public interface AuthGateway {
    public val state: StateFlow<AuthState>

    /**
     * Emails a one-time code to [email]. An address with no account starts a
     * sign-up instead, so the same two steps create an account.
     */
    public suspend fun sendEmailCode(email: String)

    /** Completes the flow [sendEmailCode] started; on success [state] becomes [AuthState.SignedIn]. */
    public suspend fun verifyEmailCode(code: String)

    /** Native Google sign-in (Credential Manager on Android). */
    public suspend fun signInWithGoogle()

    public suspend fun signOut()
}
