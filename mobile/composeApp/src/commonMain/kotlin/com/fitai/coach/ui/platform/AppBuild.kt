package com.fitai.coach.ui.platform

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Which build of the app is running, shown at the foot of Settings so an
 * athlete testing the app can tell one install from the next. [version] is
 * the release version (what the server's version gate reads); [label] marks a
 * CI test build, e.g. "test build #42 (abc1234)", and is empty in a release.
 */
data class AppBuild(val version: String = "", val label: String = "") {
    /** "Version 0.1.0 · test build #42 (abc1234)"; empty when the platform didn't say. */
    val description: String
        get() = when {
            version.isBlank() -> ""
            label.isBlank() -> "Version $version"
            else -> "Version $version · $label"
        }
}

/** The running build; the Android activity provides it. */
val LocalAppBuild = staticCompositionLocalOf { AppBuild() }
