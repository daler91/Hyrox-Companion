package com.fitai.coach.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import com.fitai.coach.core.push.PushRegistration
import com.fitai.coach.ui.analytics.AnalyticsNavigation
import com.fitai.coach.ui.analytics.AnalyticsScreen
import com.fitai.coach.ui.coach.CoachPanel
import com.fitai.coach.ui.coach.CoachThread
import com.fitai.coach.ui.coach.CoachThreadSaver
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.offerUndo
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.links.DeepLinks
import com.fitai.coach.ui.log.LogWorkoutScreen
import com.fitai.coach.ui.nutrition.NutritionScreen
import com.fitai.coach.ui.onboarding.OnboardingScreen
import com.fitai.coach.ui.onboarding.SetupResult
import com.fitai.coach.ui.planday.PlanDayScreen
import com.fitai.coach.ui.review.WeeklyReviewScreen
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.settings.SettingsScreen
import com.fitai.coach.ui.settings.SettingsTab
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.timeline.TimelineNavigation
import com.fitai.coach.ui.timeline.TimelineScreen
import com.fitai.coach.ui.workout.WorkoutDetailScreen
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

/**
 * The signed-in app: the bottom bar's five destinations, and the coach,
 * which opens as a panel over any of them, as CoachPanel does on the web.
 */
@Composable
fun AppShell() {
    val session = LocalUserSession.current
    val backStack = remember { AppBackStack() }
    var coachOpen by rememberSaveable { mutableStateOf(false) }
    // "Ask coach" on a workout opens its own thread; the floating button, the main conversation.
    var coachThread by rememberSaveable(stateSaver = CoachThreadSaver) { mutableStateOf<CoachThread?>(null) }
    val openCoach: (CoachThread?) -> Unit = {
        coachThread = it
        coachOpen = true
    }
    // Setup (onboarding): opens by itself once for a new account, and again
    // from Settings. Each opening is a new run, so it starts fresh.
    var setupOpen by rememberSaveable { mutableStateOf(false) }
    var setupRun by rememberSaveable { mutableIntStateOf(0) }
    var setupChecked by rememberSaveable { mutableStateOf(false) }
    // How setup closed: its message, and "Connect a device" where it offers one.
    var shellMessage by remember { mutableStateOf<SetupResult?>(null) }
    val toasts = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val colors = FitaiTheme.colors
    // Links from emails and notifications: the tab, and what to open on it.
    val deepLinks = koinInject<DeepLinks>()
    val link by deepLinks.current.collectAsStateWithLifecycle()
    var openPlanDayId by rememberSaveable { mutableStateOf<String?>(null) }
    var openNutrition by remember { mutableStateOf<DeepLink.Nutrition?>(null) }
    val showNutrition: (DeepLink.Nutrition) -> Unit = {
        openNutrition = it
        backStack.select(TopLevel.Nutrition)
    }
    var stravaReturn by remember { mutableStateOf<DeepLink.StravaReturn?>(null) }
    // Settings is six pages; a link that came for one opens on it.
    var settingsTab by remember { mutableStateOf<SettingsTab?>(null) }
    val showSettings: (SettingsTab) -> Unit = {
        settingsTab = it
        backStack.select(TopLevel.Settings)
    }

    LaunchedEffect(link) {
        val current = link ?: return@LaunchedEffect
        coachOpen = false
        when (current) {
            is DeepLink.Training -> {
                openPlanDayId = current.planDayId
                backStack.select(TopLevel.Training)
            }
            DeepLink.LogWorkout -> backStack.select(TopLevel.LogWorkout)
            is DeepLink.Nutrition -> showNutrition(current)
            DeepLink.Analytics -> backStack.select(TopLevel.Analytics)
            is DeepLink.Review -> {
                backStack.select(TopLevel.Training)
                backStack.push(Route.WeeklyReview(current.week))
            }
            DeepLink.Settings -> backStack.select(TopLevel.Settings)
            is DeepLink.StravaReturn -> {
                stravaReturn = current
                showSettings(SettingsTab.Integrations)
            }
        }
        deepLinks.consumed(current)
    }

    // Push, when this athlete turned it on here, re-registers at each launch.
    val push = koinInject<PushRegistration>()
    LaunchedEffect(session.userId) { push.refresh(session.userId) }

    LaunchedEffect(session.userId) {
        if (setupChecked) return@LaunchedEffect
        // Offline or failed: not now. A returning athlete is never shown setup on a guess.
        if (runCatching { session.onboarding.shouldStart() }.getOrDefault(false)) setupOpen = true
        setupChecked = true
    }
    LaunchedEffect(shellMessage) {
        shellMessage?.let { result ->
            val outcome = toasts.showSnackbar(
                result.message,
                actionLabel = CONNECT_DEVICE.takeIf { result.offerConnect },
                duration = SnackbarDuration.Long,
            )
            // Strava and Garmin connect on Settings' Integrations page.
            if (outcome == SnackbarResult.ActionPerformed) showSettings(SettingsTab.Integrations)
            shellMessage = null
        }
    }

    if (setupOpen) {
        OnboardingScreen(run = setupRun) { result ->
            setupOpen = false
            if (result.madePlan) backStack.select(TopLevel.Training)
            shellMessage = result
        }
        return
    }

    Scaffold(
        containerColor = colors.background,
        snackbarHost = { FitaiToastHost(toasts) },
        bottomBar = { BottomBar(current = backStack.currentTab, onSelect = backStack::select) },
        floatingActionButton = {
            // Not over the log form: the web offers the coach from the timeline, and here it sat on the form's own Continue button.
            if (backStack.currentTab != TopLevel.LogWorkout) {
                CoachButton(onClick = { openCoach(null) })
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            SyncStatusBanner(session)
            NavDisplay(
                backStack = backStack.entries,
                onBack = { backStack.pop() },
                modifier = Modifier.weight(1f),
                entryProvider = entryProvider {
                    entry<Route.Training> {
                        TimelineScreen(
                            TimelineNavigation(
                                openWorkout = { backStack.push(Route.WorkoutDetail(it)) },
                                askCoach = { openCoach(CoachThread.of(it)) },
                                logWorkout = { backStack.select(TopLevel.LogWorkout) },
                                editPlanDay = { backStack.push(Route.PlanDay(it)) },
                                openReview = { backStack.push(Route.WeeklyReview(it)) },
                                openNutrition = { showNutrition(DeepLink.Nutrition(it)) },
                            ),
                            openPlanDayId = openPlanDayId,
                            onPlanDayOpened = { openPlanDayId = null },
                        )
                    }
                    entry<Route.WorkoutDetail> { route ->
                        WorkoutDetailScreen(
                            route.workoutId,
                            onBack = { backStack.pop() },
                            onAskCoach = { openCoach(it) },
                            onOpenNutrition = { date, meal -> showNutrition(DeepLink.Nutrition(date, meal)) },
                            onDeleted = { binId ->
                                backStack.pop()
                                scope.launch {
                                    offerUndo(toasts, "Workout deleted") { session.timeline.restore(binId) }
                                }
                            },
                            onCombined = { combinedId ->
                                // Both workouts are gone; the combined one takes this one's place.
                                backStack.pop()
                                backStack.push(Route.WorkoutDetail(combinedId))
                                scope.launch { toasts.showSnackbar("Workouts combined") }
                            },
                        )
                    }
                    entry<Route.PlanDay> { route -> PlanDayScreen(route.entryId, onBack = { backStack.pop() }) }
                    entry<Route.WeeklyReview> { route -> WeeklyReviewScreen(route.week, onBack = { backStack.pop() }) }
                    entry<Route.LogWorkout> { LogWorkoutScreen(onSaved = { backStack.select(TopLevel.Training) }) }
                    entry<Route.Nutrition> {
                        NutritionScreen(
                            open = openNutrition,
                            onOpened = { openNutrition = null },
                            openSettings = { showSettings(SettingsTab.Training) },
                        )
                    }
                    entry<Route.Analytics> {
                        AnalyticsScreen(
                            AnalyticsNavigation(
                                logWorkout = { backStack.select(TopLevel.LogWorkout) },
                                openReview = { backStack.push(Route.WeeklyReview()) },
                                openWorkout = { backStack.push(Route.WorkoutDetail(it)) },
                                openSettings = { showSettings(SettingsTab.Training) },
                            ),
                        )
                    }
                    entry<Route.Settings> {
                        SettingsScreen(
                            onRunSetup = {
                                setupRun++
                                setupOpen = true
                            },
                            stravaReturn = stravaReturn,
                            onStravaReturnHandled = { stravaReturn = null },
                            openTab = settingsTab,
                            onTabOpened = { settingsTab = null },
                        )
                    }
                },
            )
        }
    }

    if (coachOpen) CoachPanel(onClose = { coachOpen = false }, thread = coachThread)
}

@Composable
private fun BottomBar(current: TopLevel, onSelect: (TopLevel) -> Unit) {
    val colors = FitaiTheme.colors
    Column {
        HorizontalDivider(color = colors.border)
        NavigationBar(containerColor = colors.background, tonalElevation = 0.dp) {
            TopLevel.entries.forEach { tab ->
                NavigationBarItem(
                    selected = tab == current,
                    onClick = { onSelect(tab) },
                    icon = { Icon(tab.icon, contentDescription = null) },
                    label = {
                        Text(
                            tab.shortTitle,
                            style = FitaiTheme.typography.label.copy(letterSpacing = FitaiTheme.typography.bodySm.letterSpacing),
                        )
                    },
                    modifier = Modifier.semantics { contentDescription = tab.title },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = colors.text,
                        selectedTextColor = colors.text,
                        indicatorColor = colors.muted,
                        unselectedIconColor = colors.textMuted,
                        unselectedTextColor = colors.textMuted,
                    ),
                )
            }
        }
    }
}

/** On the toasts that end setup (connectDeviceToastAction.tsx): connecting a device is what brings athletes back in week one. */
private const val CONNECT_DEVICE = "Connect a device"

/**
 * The floating way in to the coach: a pill that says what it is, at the size
 * of the web's "AI Coach" button rather than Material's taller one.
 */
@Composable
private fun CoachButton(onClick: () -> Unit) {
    val colors = FitaiTheme.colors
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = colors.primary,
        contentColor = colors.onPrimary,
        shadowElevation = COACH_BUTTON_ELEVATION,
        // Spoken with the words it shows, so "tap AI Coach" finds it by voice.
        modifier = Modifier.semantics { contentDescription = "open AI Coach" },
    ) {
        Row(
            Modifier.padding(horizontal = Spacing.Lg, vertical = Spacing.Md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Icon(LucideIcons.MessageSquare, contentDescription = null, modifier = Modifier.size(18.dp))
            Text("AI Coach", style = FitaiTheme.typography.button)
        }
    }
}

private val COACH_BUTTON_ELEVATION = 6.dp
