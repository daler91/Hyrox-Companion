package com.fitai.coach.ui.links

import com.fitai.coach.core.dates.isIsoCalendarDate
import io.ktor.http.URLBuilder
import io.ktor.http.Url
import io.ktor.http.takeFrom
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A place in the app a link can open: from an email (App Link) or a tapped notification. */
sealed interface DeepLink {
    /** The timeline; with a plan day, that day's session opens. */
    data class Training(val planDayId: String? = null) : DeepLink

    data object LogWorkout : DeepLink

    /** Nutrition, on [date] when the link names a real one. */
    data class Nutrition(val date: String? = null) : DeepLink

    data object Analytics : DeepLink

    /** The weekly review of the week holding [week]; the last completed week when null. */
    data class Review(val week: String? = null) : DeepLink

    data object Settings : DeepLink

    /** Strava sending its consent back (the native connect flow's App Link). */
    data class StravaReturn(val code: String?, val state: String?, val error: String?) : DeepLink
}

/** Where a link came from: only a verified App Link may finish a Strava connection. */
enum class LinkSource { AppLink, Notification }

/** The path Strava returns the native connect flow to (server/strava.ts STRAVA_NATIVE_CALLBACK_PATH). */
const val STRAVA_CALLBACK_PATH = "/strava/mobile-callback"

/**
 * The app screen for [raw], an absolute URL or a path, resolved against
 * [origin] (the server, e.g. https://fitai.coach). A link to another origin,
 * one that doesn't parse, or a path the app has no screen for opens the
 * timeline, as client/public/sw-push.js falls back to "/" (toSameOriginUrl).
 */
fun parseDeepLink(raw: String?, origin: String, source: LinkSource): DeepLink =
    sameOriginUrl(raw, origin)?.let { screenFor(it, source) } ?: DeepLink.Training()

/** [raw] resolved against [origin], or null when it doesn't parse or leaves the origin. */
private fun sameOriginUrl(raw: String?, origin: String): Url? {
    val base = runCatching { Url(origin) }.getOrNull()
    val url = if (raw.isNullOrEmpty() || base == null) null else runCatching { URLBuilder(base).takeFrom(raw).build() }.getOrNull()
    return url?.takeIf { it.protocol == base?.protocol && it.host.equals(base.host, ignoreCase = true) && it.port == base.port }
}

private fun screenFor(url: Url, source: LinkSource): DeepLink? {
    val query = url.parameters
    return when (url.encodedPath.trimEnd('/').ifEmpty { "/" }) {
        "/" -> DeepLink.Training(query["workout"]?.takeIf { it.isNotBlank() })
        "/log" -> DeepLink.LogWorkout
        "/nutrition" -> DeepLink.Nutrition(query["date"]?.takeIf(::isIsoCalendarDate))
        "/analytics" -> DeepLink.Analytics
        "/review" -> DeepLink.Review(query["week"]?.takeIf(::isIsoCalendarDate))
        "/settings" -> DeepLink.Settings
        STRAVA_CALLBACK_PATH -> DeepLink.StravaReturn(query["code"], query["state"], query["error"]).takeIf { source == LinkSource.AppLink }
        else -> null
    }
}

/**
 * The link waiting to be opened. The activity puts one here; the signed-in
 * shell opens it and clears it, so a link that arrives before sign-in waits
 * for it.
 */
class DeepLinks {
    private val pending = MutableStateFlow<DeepLink?>(null)
    val current: StateFlow<DeepLink?> = pending.asStateFlow()

    fun open(link: DeepLink) {
        pending.value = link
    }

    /** Clears [link] once opened; a newer link that arrived meanwhile stays. */
    fun consumed(link: DeepLink) {
        pending.compareAndSet(link, null)
    }
}
