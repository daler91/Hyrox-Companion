package com.fitai.coach.core.auth

import kotlin.io.encoding.Base64

/** SHA-256 of [bytes]. */
internal expect fun sha256(bytes: ByteArray): ByteArray

/** [size] bytes from the platform's cryptographically secure generator. */
internal expect fun secureRandomBytes(size: Int): ByteArray

private val BASE64_URL = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT)

/** Random bytes behind a verifier: 32 make 43 base64url characters, the RFC 7636 minimum. */
private const val VERIFIER_BYTES = 32

/**
 * A PKCE pair (RFC 7636, S256): the app keeps [verifier] and sends
 * [challenge] = base64url(SHA-256(verifier)), as the server checks it
 * (server/strava.ts codeChallengeFor).
 */
public data class Pkce(val verifier: String, val challenge: String) {
    public companion object {
        public fun create(): Pkce = fromVerifier(BASE64_URL.encode(secureRandomBytes(VERIFIER_BYTES)))

        public fun fromVerifier(verifier: String): Pkce = Pkce(verifier, BASE64_URL.encode(sha256(verifier.encodeToByteArray())))
    }
}
