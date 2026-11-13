package com.fitai.coach.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigationevent.NavigationEventInfo
import androidx.navigationevent.compose.NavigationBackHandler
import androidx.navigationevent.compose.rememberNavigationEventState
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDateField
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.NexusMark
import com.fitai.coach.ui.format.longDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private val TITLES = mapOf(
    SetupStep.Welcome to "Welcome to fitai.coach",
    SetupStep.Units to "Set your preferences",
    SetupStep.Goal to "What's your goal?",
    SetupStep.Coach to "Meet your AI Coach",
    SetupStep.Plan to "Choose your path",
    SetupStep.AiPlan to "Generate an AI plan",
    SetupStep.Generating to "Building your plan",
    SetupStep.Schedule to "When do you start?",
)

private val DESCRIPTIONS = mapOf(
    SetupStep.Welcome to "Let's get you set up in just a few steps.",
    SetupStep.Units to "Choose your measurement units and HYROX race profile.",
    SetupStep.Goal to "This helps us tailor your experience.",
    SetupStep.Coach to "Choose whether the AI Coach can use your training data.",
    SetupStep.Plan to "How would you like to start training?",
    SetupStep.AiPlan to "Your goal, schedule and anything the coach should plan around.",
    SetupStep.Generating to "This takes 1–2 minutes.",
    SetupStep.Schedule to "Pick the first day of your 8-week program.",
)

/**
 * First-run setup, full screen. [run] tells one opening from the next, so
 * "Run setup again" starts fresh. [onFinished] gets what to tell the athlete.
 */
@Composable
fun OnboardingScreen(run: Int, onFinished: (SetupResult) -> Unit) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "onboarding-${session.userId}-$run") { OnboardingViewModel(session, ::todayIn) }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    var confirmLeave by remember { mutableStateOf(false) }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    LaunchedEffect(vm) { vm.finished.collect(onFinished) }

    // System back steps back through setup; from the first step it asks to leave.
    NavigationBackHandler(
        state = rememberNavigationEventState(NavigationEventInfo.None),
        isBackEnabled = state.step != SetupStep.Generating,
        onBackCompleted = { if (state.step == SetupStep.Welcome) confirmLeave = true else vm.back() },
    )

    Box(Modifier.fillMaxSize().background(FitaiTheme.colors.background)) {
        Column(Modifier.fillMaxSize().imePadding()) {
            Header(state.step, onBack = vm::back, onClose = { confirmLeave = true })
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.Lg),
                verticalArrangement = Arrangement.spacedBy(Spacing.Md),
            ) {
                Text(
                    TITLES.getValue(state.step),
                    style = FitaiTheme.typography.h2,
                    color = FitaiTheme.colors.text,
                    modifier = Modifier.semantics { heading() },
                )
                Text(DESCRIPTIONS.getValue(state.step), style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
                StepContent(state, vm)
                Spacer(Modifier.height(Spacing.Md))
            }
            Footer(state, vm)
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }

    if (confirmLeave) {
        FitaiDialog(
            title = "Leave setup?",
            text = "What you have saved so far is kept. You can run setup again anytime from Settings.",
            confirmLabel = "Leave setup",
            dismissLabel = "Keep going",
            onConfirm = {
                confirmLeave = false
                vm.leave()
            },
            onDismiss = { confirmLeave = false },
        )
    }
}

@Composable
private fun Header(step: SetupStep, onBack: () -> Unit, onClose: () -> Unit) {
    val hasBack = step in setOf(SetupStep.Units, SetupStep.Goal, SetupStep.Coach, SetupStep.Plan, SetupStep.AiPlan, SetupStep.Schedule)
    Column(Modifier.fillMaxWidth().padding(horizontal = Spacing.Xs, vertical = Spacing.Xs)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (hasBack) {
                IconButton(onClick = onBack) { Icon(LucideIcons.ArrowLeft, contentDescription = "back", tint = FitaiTheme.colors.text) }
            } else {
                Spacer(Modifier.size(48.dp))
            }
            Text(
                "Step ${stepNumber(step)} of ${NUMBERED_STEPS.size}",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
                modifier = Modifier.weight(1f),
            )
            if (step != SetupStep.Generating) {
                IconButton(onClick = onClose) { Icon(LucideIcons.X, contentDescription = "leave setup", tint = FitaiTheme.colors.text) }
            }
        }
        LinearProgressIndicator(
            progress = { stepNumber(step).toFloat() / NUMBERED_STEPS.size },
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.Md),
            color = FitaiTheme.colors.primary,
            trackColor = FitaiTheme.colors.muted,
            drawStopIndicator = {},
        )
    }
}

@Composable
private fun StepContent(state: OnboardingUiState, vm: OnboardingViewModel) {
    when (state.step) {
        SetupStep.Welcome -> Welcome()
        SetupStep.Units -> Units(state, vm::edit)
        SetupStep.Goal -> Goal(state, vm)
        SetupStep.Coach -> Coach(state.profile.aiCoachEnabled) { on -> vm.edit { it.copy(aiCoachEnabled = on) } }
        SetupStep.Plan -> PlanChoice(state.aiCoachSaved, vm)
        SetupStep.AiPlan -> state.planForm?.let { form ->
            AiPlanFields(form, state.today, vm::editPlan, overlapping = state.overlapping(form))
        }
        SetupStep.Generating -> Generating()
        SetupStep.Schedule -> Schedule(state, vm::setStartDate)
    }
}

@Composable
private fun Footer(state: OnboardingUiState, vm: OnboardingViewModel) {
    val (label, action, enabled) = when (state.step) {
        SetupStep.Welcome, SetupStep.Units, SetupStep.Goal, SetupStep.Coach -> Triple("Continue", vm::next, true)
        SetupStep.AiPlan -> Triple("Generate plan", vm::generate, state.planForm?.canGenerate == true)
        SetupStep.Schedule -> Triple("Start training", vm::startTraining, state.startDate.isNotEmpty())
        SetupStep.Generating -> Triple("Keep it generating in the background", vm::keepGeneratingInBackground, true)
        SetupStep.Plan -> return
    }
    FitaiButton(
        label,
        onClick = action,
        enabled = enabled,
        loading = state.busy,
        variant = if (state.step == SetupStep.Generating) ButtonVariant.Secondary else ButtonVariant.Primary,
        modifier = Modifier.fillMaxWidth().padding(Spacing.Lg),
    )
}

@Composable
private fun Welcome() {
    Box(Modifier.fillMaxWidth().padding(vertical = Spacing.Lg), contentAlignment = Alignment.Center) { NexusMark(size = 72.dp) }
    Text(
        "fitai.coach helps you train smarter with structured plans, workout logging, and AI-powered coaching for any fitness goal.",
        style = FitaiTheme.typography.body,
        color = FitaiTheme.colors.text,
    )
    Text(
        "Takes about 2 minutes: your units, goal and AI Coach choice, then a training plan on your calendar.",
        style = FitaiTheme.typography.body,
        color = FitaiTheme.colors.textMuted,
    )
}

@Composable
internal fun Label(text: String) = Text(text, style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun Options(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        options.forEach { (value, label) -> FitaiChip(label, selected = value == selected, onClick = { onSelect(value) }) }
    }
}

@Composable
private fun Units(state: OnboardingUiState, edit: ((SetupProfile) -> SetupProfile) -> Unit) {
    val profile = state.profile
    Label("Weight")
    Options(listOf("kg" to "Kilograms (kg)", "lbs" to "Pounds (lbs)"), profile.weightUnit) { v -> edit { it.copy(weightUnit = v) } }
    Label("Distance")
    Options(listOf("km" to "Kilometers (km)", "miles" to "Miles"), profile.distanceUnit) { v -> edit { it.copy(distanceUnit = v) } }
    Label("Division")
    Options(listOf("open" to "Open", "pro" to "Pro"), profile.division) { v -> edit { it.copy(division = v) } }
    Label("Gender")
    Options(listOf("male" to "Men", "female" to "Women", "prefer_not_to_say" to "Prefer not to say"), profile.gender) { v ->
        edit { it.copy(gender = v) }
    }
    FitaiTextField(
        profile.age,
        { v -> edit { it.copy(age = v.filter(Char::isDigit).take(3)) } },
        "Age (optional)",
        error = state.ageError,
        supportingText = "Picks your age group for race predictions and estimates your max heart rate.",
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    )
}

@Composable
private fun Goal(state: OnboardingUiState, vm: OnboardingViewModel) {
    ONBOARDING_GOALS.forEach { goal ->
        ChoiceCard(goal.label, goal.description, selected = goal.id == state.goalId, onClick = { vm.setGoal(goal.id) })
    }
    FitaiDateField(
        state.raceDate,
        vm::setRaceDate,
        "Race date (optional)",
        placeholder = "No race booked",
        minDate = state.today,
        error = state.raceDateError,
        supportingText = "Booked a race? Your plan builds to it.",
    )
    if (state.raceDate.isNotEmpty()) {
        FitaiButton("Clear race date", onClick = { vm.setRaceDate("") }, variant = ButtonVariant.Ghost)
    }
}

@Composable
private fun ChoiceCard(title: String, description: String, selected: Boolean, onClick: () -> Unit) {
    FitaiCard(modifier = Modifier.fillMaxWidth().selectable(selected = selected, onClick = onClick, role = Role.RadioButton)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            RadioButton(selected = selected, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = FitaiTheme.colors.primary))
            Column(Modifier.weight(1f)) {
                Text(title, style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
                Text(description, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
            }
        }
    }
}

@Composable
private fun Coach(enabled: Boolean, onChange: (Boolean) -> Unit) {
    ChoiceCard(
        "Turn on the AI Coach",
        "AI-built plans, plan adjustments as your training goes, and coach chat.",
        selected = enabled,
        onClick = { onChange(true) },
    )
    ChoiceCard(
        "Not now",
        "Plans and logging work without it. You can turn it on later in Settings.",
        selected = !enabled,
        onClick = { onChange(false) },
    )
}

@Composable
private fun PlanChoice(aiCoachOn: Boolean, vm: OnboardingViewModel) {
    val ai: @Composable () -> Unit = {
        PlanOption(
            if (aiCoachOn) "Generate AI plan (recommended)" else "Generate AI plan",
            if (aiCoachOn) {
                "A few quick questions, then 1–2 minutes to build a plan around your goal"
            } else {
                "Needs the AI Coach. Go back a step to turn it on."
            },
            primary = aiCoachOn,
            enabled = aiCoachOn,
            onClick = vm::chooseAiPlan,
        )
    }
    val template: @Composable () -> Unit = {
        PlanOption(
            "Use 8-week template",
            "Structured program with running, strength, and functional exercises",
            primary = !aiCoachOn,
            onClick = vm::chooseTemplate,
        )
    }
    if (aiCoachOn) {
        ai()
        template()
    } else {
        template()
        ai()
    }
    FitaiButton("Skip for now — I'll log workouts manually", onClick = {
        vm.skip()
    }, variant = ButtonVariant.Ghost, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun PlanOption(title: String, description: String, primary: Boolean, onClick: () -> Unit, enabled: Boolean = true) {
    val colors = FitaiTheme.colors
    FitaiCard(modifier = Modifier.fillMaxWidth(), onClick = onClick.takeIf { enabled }) {
        Text(
            title,
            style = FitaiTheme.typography.label,
            color = if (!enabled) {
                colors.textMuted
            } else if (primary) {
                colors.accent
            } else {
                colors.text
            },
        )
        Text(description, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
    }
}

@Composable
private fun Generating() {
    Column(Modifier.fillMaxWidth().padding(vertical = Spacing.Xl), horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = FitaiTheme.colors.primary)
        Spacer(Modifier.height(Spacing.Md))
        Text(
            "Your plan keeps generating if you leave; it appears on your timeline when it's ready.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
    }
}

@Composable
private fun Schedule(state: OnboardingUiState, onStartDate: (String) -> Unit) {
    FitaiDateField(state.startDate, onStartDate, "Start date", minDate = state.today)
    if (state.startDate.isNotEmpty()) {
        Text("Your plan will start on ${longDate(state.startDate)}", style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
        weekOneStartNote(state.startDate)?.let {
            Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        }
    }
}
