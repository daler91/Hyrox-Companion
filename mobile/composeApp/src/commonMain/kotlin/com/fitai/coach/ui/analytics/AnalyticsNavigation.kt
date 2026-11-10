package com.fitai.coach.ui.analytics

/** What Analytics asks of the shell. */
data class AnalyticsNavigation(
    val logWorkout: () -> Unit,
    /** The weekly review, a fixed Monday-to-Sunday week beside this page's range. */
    val openReview: () -> Unit = {},
    /** A logged workout, from a graded run. */
    val openWorkout: (workoutId: String) -> Unit = {},
    /** Settings, where the AI Coach is turned on. */
    val openSettings: () -> Unit = {},
)
