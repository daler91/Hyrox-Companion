package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiSwitchRow
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * The daily targets (TargetsDialog.tsx): four goals, typed or worked out from
 * the profile, and whether carbs follow each day's training.
 */
@Composable
fun TargetsSheet(state: TargetsSheetState, vm: TargetsViewModel) {
    FitaiBottomSheet(onDismissRequest = vm::closeDaily) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Text("Daily targets", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
            if (state.loading) {
                LoadingState()
                return@Column
            }
            Muted("Your daily goals. Leave a field blank to skip that goal; changes apply from today.")
            FitaiButton(
                "Calculate from profile",
                onClick = vm::calculateFromProfile,
                variant = ButtonVariant.Secondary,
                enabled = state.profile != null,
                leadingIcon = LucideIcons.Calculator,
            )
            when {
                state.profile == null ->
                    Muted("Add your bodyweight, height, age, activity level and weight goal in Settings to auto-calculate.")
                state.calcNote != null -> Muted(state.calcNote)
            }
            MacroInputs(state.fields, onChange = vm::editDailyFields)
            FitaiSwitchRow(
                "Scale carbs by training load",
                checked = state.periodize,
                onCheckedChange = { on -> vm.editDaily { it.copy(periodize = on) } },
                enabled = state.canPeriodize,
            )
            Muted(
                "Raise your carb target on hard days and lower it on rest days, based on each day's training. " +
                    "Protein and fat stay fixed.",
            )
            if (state.referenceAssumed) {
                Muted(
                    "You have no logged training yet, so this starts from a typical daily load rather than your own. " +
                        "It will read as a normal training day until you have some history; log a few sessions and " +
                        "open this again to calibrate it.",
                )
            }
            if (state.periodize) {
                FitaiSwitchRow(
                    "Adapt to recent & upcoming training",
                    checked = state.adaptive,
                    onCheckedChange = { on -> vm.editDaily { it.copy(adaptive = on) } },
                )
                Muted(
                    "Keep carbs (and a little extra protein) up while you recover from hard days, and load carbs " +
                        "ahead of big sessions, your taper and race week.",
                )
            }
            FitaiButton(
                "Save targets",
                onClick = vm::saveDaily,
                enabled = state.fields.parsed() != null,
                loading = state.saving,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/**
 * One meal's target (MealTargetDialog.tsx): pin any of its goals; a blank
 * field follows the figure shown in it. When all three macros are pinned, the
 * calories are theirs.
 */
@Composable
fun MealTargetSheet(state: MealTargetSheetState, vm: TargetsViewModel) {
    val preview = state.preview()
    val placeholders = preview.placeholders()
    FitaiBottomSheet(onDismissRequest = vm::closeMeal) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Text("Adjust ${state.meal.label.lowercase()} target", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
            Muted("Pin this meal's goals. A blank field follows the figure shown in it; changes apply from today.")
            MacroInputs(
                fields = if (state.caloriesLocked) state.fields.copy(calories = placeholders.calories) else state.fields,
                onChange = vm::editMealFields,
                placeholders = placeholders,
                caloriesLocked = state.caloriesLocked,
            )
            if (state.caloriesLocked) {
                Text(
                    "Calories follow the three macros you pinned. Clear a macro to set calories yourself.",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                    // Said as it happens: the field locks as the third macro is typed, away from it.
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            FitaiButton(
                "Save",
                onClick = vm::saveMeal,
                enabled = state.pins() != null && !state.busy,
                loading = state.saving,
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.overridden) {
                FitaiButton(
                    "Reset to suggested",
                    onClick = vm::resetMeal,
                    variant = ButtonVariant.Ghost,
                    enabled = !state.busy,
                    loading = state.resetting,
                    leadingIcon = LucideIcons.RotateCcw,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** The four goals, two to a row (MacroTargetInputs). A locked calorie field shows the macros' figure, read-only. */
@Composable
private fun MacroInputs(
    fields: MacroFields,
    onChange: ((MacroFields) -> MacroFields) -> Unit,
    placeholders: MacroFields? = null,
    caloriesLocked: Boolean = false,
) {
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiTextField(
            fields.calories,
            { v -> onChange { it.copy(calories = v) } },
            "Calories (kcal)",
            Modifier.weight(1f),
            placeholder = placeholders?.calories,
            readOnly = caloriesLocked,
            keyboardOptions = number,
            description = if (caloriesLocked) "Calories (kcal), set by the three macros you pinned" else "Calories (kcal)",
        )
        FitaiTextField(
            fields.protein,
            { v -> onChange { it.copy(protein = v) } },
            "Protein (g)",
            Modifier.weight(1f),
            placeholder = placeholders?.protein,
            keyboardOptions = number,
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiTextField(
            fields.carb,
            { v -> onChange { it.copy(carb = v) } },
            "Carbs (g)",
            Modifier.weight(1f),
            placeholder = placeholders?.carb,
            keyboardOptions = number,
        )
        FitaiTextField(
            fields.fat,
            { v -> onChange { it.copy(fat = v) } },
            "Fat (g)",
            Modifier.weight(1f),
            placeholder = placeholders?.fat,
            keyboardOptions = number,
        )
    }
}

@Composable
private fun Muted(text: String) {
    Text(text, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
}
