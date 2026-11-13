package com.fitai.coach.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.dates.formatInstant
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiSwitchRow
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** Settings → Training: the web Training tab's cards, in its order. */
@Composable
fun TrainingSettings(toasts: SnackbarHostState) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "training-settings-${session.userId}") { TrainingSettingsViewModel(session) }
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    val prefs = state.preferences ?: return

    Text(
        "Training",
        style = FitaiTheme.typography.h2,
        color = FitaiTheme.colors.text,
        modifier = Modifier.padding(top = Spacing.Sm).semantics { heading() },
    )
    RaceProfileCard(prefs, state.saving == "race") { vm.saveCard("race", it) }
    BodyCompositionCard(prefs, state.saving == "body") { vm.saveCard("body", it) }
    HeartRateCard(prefs, state.saving == "heart") { vm.saveCard("heart", it) }
    ChoiceCard(
        "Nutrition",
        "Meals per day: how many meals your per-meal fuel targets are spread across.",
        MEAL_SCHEDULES.map { it to "$it meals" },
        prefs.mealSchedule,
    ) { vm.choose(UpdateUserPreferences(mealSchedule = it)) }
    ChoiceCard(
        "Training goals",
        "Weekly workout goal: the number of workouts you aim for each week.",
        WEEKLY_GOALS.map { it to "$it" },
        prefs.weeklyGoal,
    ) { vm.choose(UpdateUserPreferences(weeklyGoal = it)) }
    TrainingStyle(state, prefs, vm)
    TrainingCard("Workout review", "Control adherence indicators on the timeline and workout details.") {
        FitaiSwitchRow("Show adherence insights", prefs.showAdherenceInsights == true, {
            vm.choose(UpdateUserPreferences(showAdherenceInsights = it))
        })
    }
    state.mafSetup?.let { MafSetupSheet(it, saving = state.saving != null, vm) }
}

@Composable
private fun TrainingCard(title: String, description: String, content: @Composable () -> Unit) {
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Text(title, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
            Text(description, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
            content()
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun <T> Chips(options: List<Pair<T, String>>, selected: T?, onSelect: (T) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        options.forEach { (value, label) -> FitaiChip(label, selected = value == selected, onClick = { onSelect(value) }) }
    }
}

@Composable
private fun Label(text: String) = Text(text, style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)

@Composable
private fun NumberField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    error: String?,
    modifier: Modifier = Modifier,
    hint: String? = null,
) {
    FitaiTextField(
        value,
        onChange,
        label,
        modifier = modifier,
        supportingText = hint,
        error = error,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
    )
}

@Composable
private fun SaveButton(enabled: Boolean, saving: Boolean, onSave: () -> Unit) {
    FitaiButton("Save", onClick = onSave, enabled = enabled && !saving, loading = saving, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun RaceProfileCard(prefs: PreferencesResponse, saving: Boolean, save: (UpdateUserPreferences) -> Unit) {
    val saved = RaceProfileForm.from(prefs)
    var form by remember(saved) { mutableStateOf(saved) }
    TrainingCard(
        "Race profile",
        "Your HYROX division and gender set the station loads and benchmark times used by the Race Predictor.",
    ) {
        Label("Division")
        Chips(DIVISIONS, form.division) { form = form.copy(division = it) }
        Label("Gender")
        Chips(GENDERS, form.gender) { form = form.copy(gender = it) }
        NumberField(
            form.age,
            { form = form.copy(age = it) },
            "Age",
            form.ageError,
            hint = "Sets your Race Predictor age cohort for more accurate benchmark times.",
        )
        SaveButton(form != saved && form.ageError == null, saving) { save(form.patch(saved)) }
    }
}

@Composable
private fun BodyCompositionCard(prefs: PreferencesResponse, saving: Boolean, save: (UpdateUserPreferences) -> Unit) {
    val saved = BodyForm.from(prefs)
    var form by remember(saved) { mutableStateOf(saved) }
    TrainingCard(
        "Body composition",
        "Used to calculate your daily calorie and macro targets. All optional — your numbers stay on your account.",
    ) {
        NumberField(form.weight, { form = form.copy(weight = it) }, "Bodyweight (${form.unit})", form.weightError)
        if (form.imperial) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                NumberField(form.heightFt, { form = form.copy(heightFt = it) }, "Height (ft)", null, Modifier.weight(1f))
                NumberField(form.heightIn, { form = form.copy(heightIn = it) }, "Height (in)", null, Modifier.weight(1f))
            }
            form.heightError?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.danger) }
        } else {
            NumberField(form.heightCm, { form = form.copy(heightCm = it) }, "Height (cm)", form.heightError)
        }
        Label("Activity level")
        Text(
            "Day-to-day activity outside training; sets your baseline calorie burn.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
        Chips(ACTIVITY_LEVELS.map { it.first.wireValue to it.second }, form.activity) { form = form.copy(activity = it) }
        Label("Weight goal")
        Chips(WEIGHT_GOALS.map { it.first.wireValue to it.second }, form.goal) { form = form.copy(goal = it) }
        if (form.showsRate) {
            NumberField(
                form.rate,
                { form = form.copy(rate = it) },
                "Weekly rate (${form.unit}/week)",
                form.rateError,
                hint = "Target weight change per week.",
            )
        }
        SaveButton(form != saved && !form.hasErrors, saving) { save(form.patch(saved)) }
    }
}

@Composable
private fun HeartRateCard(prefs: PreferencesResponse, saving: Boolean, save: (UpdateUserPreferences) -> Unit) {
    val saved = HeartForm.from(prefs)
    var form by remember(saved) { mutableStateOf(saved) }
    TrainingCard(
        "Heart rate & power",
        "Optional — improves the accuracy of objective training load (hrTSS/TSS) when your workouts carry heart-rate or " +
            "power data. Left blank, we estimate from your age.",
    ) {
        NumberField(
            form.restingHr,
            { form = form.copy(restingHr = it) },
            "Resting heart rate (bpm)",
            form.restingError,
            hint = "Measured on waking.",
        )
        NumberField(
            form.maxHr,
            { form = form.copy(maxHr = it) },
            "Max heart rate (bpm)",
            form.maxError,
            hint = "Your true max, if known — otherwise estimated from age.",
        )
        NumberField(
            form.ftp,
            { form = form.copy(ftp = it) },
            "Functional threshold power (W)",
            form.ftpError,
            hint = "Unlocks power-based load (TSS).",
        )
        SaveButton(form != saved && !form.hasErrors, saving) { save(form.patch(saved)) }
    }
}

@Composable
private fun ChoiceCard(title: String, description: String, options: List<Pair<Int, String>>, selected: Int?, onSelect: (Int) -> Unit) {
    TrainingCard(title, description) { Chips(options, selected, onSelect) }
}

@Composable
private fun TrainingStyle(state: TrainingSettingsState, prefs: PreferencesResponse, vm: TrainingSettingsViewModel) {
    val current = prefs.trainingStyleId ?: BALANCED_STYLE
    var pending by remember { mutableStateOf<String?>(null) }
    val colors = FitaiTheme.colors
    TrainingCard("Training style", "Changing style updates future analysis and plan generation behavior.") {
        Chips(listOf(BALANCED_STYLE to styleLabel(BALANCED_STYLE), MAF_STYLE to styleLabel(MAF_STYLE)), current) {
            if (it != current) pending = it
        }
        state.transitionNotice?.let {
            Text(
                it,
                style = FitaiTheme.typography.bodySm,
                color = colors.text,
                modifier = Modifier.semantics {
                    liveRegion =
                        LiveRegionMode.Polite
                },
            )
        }
    }
    TrainingCard("Why this recommendation", "Active style: ${styleLabel(current)}. Key constraints: ${styleConstraint(current)}") {
        Text(
            "Recommendations are explained using your current style first, then filtered by saved constraints and available baseline data.",
            style = FitaiTheme.typography.bodySm,
            color = colors.textMuted,
        )
        if (current == MAF_STYLE) {
            prefs.mafHr?.let {
                Text(
                    "Your MAF ceiling is $it bpm — 180 minus your age, adjusted by your Maffetone health and training category. " +
                        "Aerobic sessions are scored against it, so keep easy runs at or under it.",
                    style = FitaiTheme.typography.bodySm,
                    color = colors.text,
                )
            }
            FitaiButton("Edit MAF setup", onClick = vm::editMafSetup, variant = ButtonVariant.Secondary)
        }
    }
    TrainingCard("Settings audit", "Training-style changes made on this device, and what each one set off.") {
        if (state.audit.isEmpty()) {
            Text("No training-style changes recorded yet.", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
        }
        state.audit.forEach { entry ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xxs)) {
                Text(
                    "${formatInstant(entry.changedAt, prefs.userTimezone) ?: entry.changedAt} — " +
                        "${styleLabel(entry.fromStyleId)} to ${styleLabel(entry.toStyleId)}",
                    style = FitaiTheme.typography.label,
                    color = colors.text,
                )
                entry.recalculations.forEach { Text("• $it", style = FitaiTheme.typography.bodySm, color = colors.textMuted) }
            }
        }
    }
    pending?.let { to ->
        FitaiDialog(
            title = "Change training style?",
            text = "This will change how your AI analysis works and affect future plans. We'll re-baseline MAF settings when needed.",
            confirmLabel = "Confirm",
            onConfirm = {
                pending = null
                vm.switchStyle(to)
            },
            onDismiss = { pending = null },
        )
    }
}

/** The MAF setup (the web's "Complete MAF setup" dialog): age, Maffetone's category, and whether HR data is available. */
@Composable
private fun MafSetupSheet(sheet: MafSetupSheet, saving: Boolean, vm: TrainingSettingsViewModel) {
    val colors = FitaiTheme.colors
    val setup = sheet.setup
    FitaiBottomSheet(onDismissRequest = vm::closeMafSetup) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Text("Complete MAF setup", style = FitaiTheme.typography.h3, color = colors.text, modifier = Modifier.semantics { heading() })
            sheet.blocked?.let { Text(it, style = FitaiTheme.typography.bodySm, color = colors.danger) }
            Text(
                "Your MAF ceiling is 180 minus your age, adjusted by your category. HR data available is optional.",
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
            )
            NumberField(setup.age, { v -> vm.editMaf { it.copy(age = v) } }, "Age (required)", null)
            Label("Health and training category (required)")
            MAF_CATEGORIES.forEach { option ->
                Row(
                    Modifier.fillMaxWidth().selectable(
                        selected = setup.category == option.category,
                        onClick = { vm.editMaf { it.copy(category = option.category) } },
                        role = Role.RadioButton,
                    ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(
                        selected = setup.category == option.category,
                        onClick = null,
                        colors = RadioButtonDefaults.colors(selectedColor = colors.primary),
                    )
                    Text(
                        option.label,
                        style = FitaiTheme.typography.bodySm,
                        color = colors.text,
                        modifier = Modifier.padding(start = Spacing.Xs),
                    )
                }
            }
            Label("HR data available (optional)")
            Chips(listOf(true to "Yes", false to "No"), setup.hrDataAvailable) { v -> vm.editMaf { it.copy(hrDataAvailable = v) } }
            sheet.error?.let {
                Text(
                    it,
                    style = FitaiTheme.typography.bodySm,
                    color = colors.danger,
                    modifier = Modifier.semantics {
                        liveRegion =
                            LiveRegionMode.Polite
                    },
                )
            }
            FitaiButton(
                "Save MAF setup",
                onClick = vm::saveMafSetup,
                loading = saving,
                enabled = !saving,
                modifier = Modifier.fillMaxWidth(),
            )
            FitaiButton("Cancel", onClick = vm::closeMafSetup, variant = ButtonVariant.Ghost, modifier = Modifier.fillMaxWidth())
        }
    }
}
