package com.fitai.coach.core.auth

/**
 * Supplies the session token sent as `Authorization: Bearer` on API calls.
 * Clerk's Android SDK implements it (androidApp); a Swift bridge to Clerk's
 * iOS SDK will later (docs/mobile-app-plan.md, Phase 7).
 */
public fun interface AuthTokenProvider {
    /**
     * A currently valid session token, or null when nobody is signed in.
     * Called before every request; implementations cache and refresh (Clerk
     * tokens live 60 seconds, and its SDK refreshes them).
     */
    public suspend fun token(): String?
}
