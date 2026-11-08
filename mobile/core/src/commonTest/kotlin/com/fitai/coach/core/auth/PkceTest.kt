package com.fitai.coach.core.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PkceTest {
    @Test
    fun theChallengeIsTheS256OfTheVerifier() {
        // RFC 7636, appendix B.
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            Pkce.fromVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk").challenge,
        )
    }

    @Test
    fun aFreshPairMeetsTheServersPatterns() {
        val pkce = Pkce.create()
        assertTrue(Regex("^[A-Za-z0-9._~-]{43,128}$").matches(pkce.verifier))
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(pkce.challenge))
        assertNotEquals(pkce.verifier, Pkce.create().verifier)
    }
}
