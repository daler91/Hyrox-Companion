package com.fitai.coach.ui.shell

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation3.runtime.NavKey
import com.fitai.coach.ui.icons.generated.LucideIcons
import kotlinx.serialization.Serializable

/** The app's destinations: type-safe Navigation 3 keys. */
@Serializable
sealed interface Route : NavKey {
    @Serializable data object Training : Route

    @Serializable data object LogWorkout : Route

    @Serializable data object Nutrition : Route

    @Serializable data object Analytics : Route

    @Serializable data object Settings : Route

    /** A logged workout and its sets. */
    @Serializable data class WorkoutDetail(val workoutId: String) : Route

    /** Editing a planned session, by its timeline entry. */
    @Serializable data class PlanDay(val entryId: String) : Route
}

/**
 * The bottom bar's destinations, matching the web's PRIMARY_NAV_ITEMS
 * (client/src/lib/navItems.ts): same order, short labels and icons.
 */
enum class TopLevel(val route: Route, val title: String, val shortTitle: String, val icon: ImageVector) {
    Training(Route.Training, "Training", "Training", LucideIcons.CalendarRange),
    LogWorkout(Route.LogWorkout, "Log Workout", "Log", LucideIcons.PlusCircle),
    Nutrition(Route.Nutrition, "Nutrition", "Nutrition", LucideIcons.Apple),
    Analytics(Route.Analytics, "Analytics", "Analytics", LucideIcons.BarChart3),
    Settings(Route.Settings, "Settings", "Settings", LucideIcons.Settings),
}

/**
 * The navigation back stack, with bottom-bar semantics: picking a tab starts
 * a fresh stack at its root, and picking the current tab again pops back to
 * that root. Screens push detail routes on top (Phase 4).
 */
class AppBackStack(start: TopLevel = TopLevel.Training) {
    val entries = mutableStateListOf<NavKey>(start.route)

    val currentTab: TopLevel
        get() = TopLevel.entries.first { it.route == entries.first() }

    fun select(tab: TopLevel) {
        entries.clear()
        entries.add(tab.route)
    }

    fun push(route: NavKey) {
        entries.add(route)
    }

    /** Back: pops a detail route; at a tab's root, returns false so the system handles it. */
    fun pop(): Boolean {
        if (entries.size <= 1) return false
        entries.removeAt(entries.lastIndex)
        return true
    }
}
