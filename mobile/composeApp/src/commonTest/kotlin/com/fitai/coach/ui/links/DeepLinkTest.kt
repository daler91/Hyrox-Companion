package com.fitai.coach.ui.links

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DeepLinkTest {
    private val origin = "https://fitai.coach"

    private fun push(raw: String?) = parseDeepLink(raw, origin, LinkSource.Notification)

    private fun appLink(raw: String) = parseDeepLink(raw, origin, LinkSource.AppLink)

    @Test
    fun pathsFromNotificationsOpenTheirScreens() {
        assertEquals(DeepLink.Training(), push("/"))
        assertEquals(DeepLink.Training("pd-1"), push("/?workout=pd-1"))
        assertEquals(DeepLink.LogWorkout, push("/log"))
        assertEquals(DeepLink.Nutrition("2026-11-08"), push("/nutrition?date=2026-11-08&meal=post_workout"))
        assertEquals(DeepLink.Nutrition(), push("/nutrition?date=yesterday"))
        assertEquals(DeepLink.Analytics, push("/analytics"))
        assertEquals(DeepLink.Settings, push("/settings/"))
        assertEquals(DeepLink.Review("2026-11-02"), push("/review?week=2026-11-02"))
        assertEquals(DeepLink.Review(), push("/review?week=last"))
        assertEquals(DeepLink.Review(), push("/review"))
    }

    @Test
    fun emailLinksOnTheAppsOwnOriginOpenTheirScreens() {
        assertEquals(DeepLink.LogWorkout, appLink("https://fitai.coach/log"))
        assertEquals(DeepLink.Training("pd-2"), appLink("https://FITAI.coach/?workout=pd-2"))
        assertEquals(DeepLink.Review("2026-11-02"), appLink("https://fitai.coach/review?week=2026-11-02"))
    }

    @Test
    fun anythingElseOpensTheTimeline() {
        assertEquals(DeepLink.Training(), push(null))
        assertEquals(DeepLink.Training(), push("https://evil.example/log"))
        assertEquals(DeepLink.Training(), push("http://fitai.coach/log"))
        assertEquals(DeepLink.Training(), push("//evil.example/log"))
        assertEquals(DeepLink.Training(), push("/unsubscribe?token=abc"))
        assertEquals(DeepLink.Training(), push("javascript:alert(1)"))
    }

    @Test
    fun onlyAVerifiedAppLinkCarriesAStravaReturn() {
        val link = appLink("https://fitai.coach/strava/mobile-callback?code=c1&state=s1&scope=read")
        assertEquals(DeepLink.StravaReturn("c1", "s1", null), link)
        assertEquals(
            DeepLink.StravaReturn(null, "s1", "access_denied"),
            appLink("https://fitai.coach/strava/mobile-callback?state=s1&error=access_denied"),
        )
        assertEquals(DeepLink.Training(), push("/strava/mobile-callback?code=c1&state=s1"))
    }

    @Test
    fun aLinkIsClearedOnlyOnceOpened() {
        val links = DeepLinks()
        links.open(DeepLink.LogWorkout)
        links.open(DeepLink.Analytics)
        links.consumed(DeepLink.LogWorkout)
        assertEquals(DeepLink.Analytics, links.current.value)
        links.consumed(DeepLink.Analytics)
        assertNull(links.current.value)
    }
}
