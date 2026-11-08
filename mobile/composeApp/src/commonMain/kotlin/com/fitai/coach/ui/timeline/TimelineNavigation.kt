package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.TimelineEntry

/** What the timeline asks of the shell. */
data class TimelineNavigation(
    val openWorkout: (workoutId: String) -> Unit,
    val askCoach: (TimelineEntry) -> Unit,
    val logWorkout: () -> Unit,
)
