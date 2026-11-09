package com.fitai.coach.ui.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import com.fitai.coach.core.push.PushRegistration
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
import com.fitai.coach.ui.planday.PlanDayScreen
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.settings.SettingsScreen
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
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
    var shellMessage by remember { mutableStateOf<String?>(null) }
    val toasts = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val colors = FitaiTheme.colors
    // Links from emails and notifications: the tab, and what to open on it.
    val deepLinks = koinInject<DeepLinks>()
    val link by deepLinks.current.collectAsStateWithLifecycle()
    var openPlanDayId by rememberSaveable { mutableStateOf<String?>(null) }
    var openNutritionDate by rememberSaveable { mutableStateOf<String?>(null) }
    var stravaReturn by remember { mutableStateOf<DeepLink.StravaReturn?>(null) }

    LaunchedEffect(link) {
        val current = link ?: return@LaunchedEffect
        coachOpen = false
        when (current) {
            is DeepLink.Training -> {
                openPlanDayId = current.planDayId
                backStack.select(TopLevel.Training)
            }
            DeepLink.LogWorkout -> backStack.select(TopLevel.LogWorkout)
            is DeepLink.Nutrition -> {
                openNutritionDate = current.date
                backStack.select(TopLevel.Nutrition)
            }
            DeepLink.Analytics -> backStack.select(TopLevel.Analytics)
            DeepLink.Settings -> backStack.select(TopLevel.Settings)
            is DeepLink.StravaReturn -> {
                stravaReturn = current
                backStack.select(TopLevel.Settings)
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
        shellMessage?.let {
            toasts.showSnackbar(it)
            shellMessage = null
        }
    }

    if (setupOpen) {
        OnboardingScreen(run = setupRun) { result ->
            setupOpen = false
            if (result.madePlan) backStack.select(TopLevel.Training)
            shellMessage = result.message
        }
        return
    }

    Scaffold(
        containerColor = colors.background,
        snackbarHost = { FitaiToastHost(toasts) },
        bottomBar = { BottomBar(current = backStack.currentTab, onSelect = backStack::select) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { openCoach(null) },
                shape = Radius.Lg,
                containerColor = colors.primary,
                contentColor = colors.onPrimary,
                modifier = Modifier.semantics { contentDescription = "open coach" },
            ) { Icon(LucideIcons.MessageSquare, contentDescription = null) }
        },
    ) { padding ->
        NavDisplay(
            backStack = backStack.entries,
            onBack = { backStack.pop() },
            modifier = Modifier.padding(padding),
            entryProvider = entryProvider {
                entry<Route.Training> {
                    TimelineScreen(
                        TimelineNavigation(
                            openWorkout = { backStack.push(Route.WorkoutDetail(it)) },
                            askCoach = { openCoach(CoachThread.of(it)) },
                            logWorkout = { backStack.select(TopLevel.LogWorkout) },
                            editPlanDay = { backStack.push(Route.PlanDay(it)) },
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
                        onDeleted = { binId ->
                            backStack.pop()
                            scope.launch {
                                offerUndo(toasts, "Workout deleted") { session.timeline.restore(binId) }
                            }
                        },
                    )
                }
                entry<Route.PlanDay> { route -> PlanDayScreen(route.entryId, onBack = { backStack.pop() }) }
                entry<Route.LogWorkout> { LogWorkoutScreen(onSaved = { backStack.select(TopLevel.Training) }) }
                entry<Route.Nutrition> { NutritionScreen(openDate = openNutritionDate, onDateOpened = { openNutritionDate = null }) }
                entry<Route.Analytics> { AnalyticsScreen(onLogWorkout = { backStack.select(TopLevel.LogWorkout) }) }
                entry<Route.Settings> {
                    SettingsScreen(
                        onRunSetup = {
                            setupRun++
                            setupOpen = true
                        },
                        stravaReturn = stravaReturn,
                        onStravaReturnHandled = { stravaReturn = null },
                    )
                }
            },
        )
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
