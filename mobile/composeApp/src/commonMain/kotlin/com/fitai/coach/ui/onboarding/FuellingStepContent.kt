package com.fitai.coach.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.nutrition.calculateNutritionTarget
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiSwitchRow
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private val DECIMAL = KeyboardOptions(keyboardType = KeyboardType.Decimal)
private val WHOLE = KeyboardOptions(keyboardType = KeyboardType.Number)
private const val MAX_AGE_DIGITS = 3

/**
 * Setup's optional fuelling step (FuellingStep.tsx): weight, age, height,
 * activity and weight goal, with the daily targets they suggest worked out as
 * the athlete types, and a switch to set them. Left blank, the step is skipped.
 */
@Composable
internal fun FuellingStep(state: OnboardingUiState, vm: OnboardingViewModel) {
    val colors = FitaiTheme.colors
    val fields = state.fuelling
    val unit = state.profile.weightUnit
    Text(
        "Optional — fill this in and we'll suggest daily calorie and macro targets to fuel your training. " +
            "Skip it and you can set targets anytime in Nutrition.",
        style = FitaiTheme.typography.body,
        color = colors.textMuted,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiTextField(
            fields.bodyweight,
            { v -> vm.editFuelling { it.copy(bodyweight = v) } },
            "Weight ($unit)",
            Modifier.weight(1f),
            keyboardOptions = DECIMAL,
        )
        // The units step's age: one answer, asked again here because the targets need it.
        FitaiTextField(
            state.profile.age,
            { v -> vm.edit { it.copy(age = v.filter(Char::isDigit).take(MAX_AGE_DIGITS)) } },
            "Age",
            Modifier.weight(1f),
            error = state.ageError,
            keyboardOptions = WHOLE,
        )
    }
    HeightFields(fields, imperial = unit == "lbs", onChange = vm::editFuelling)
    Label("Activity level")
    Column {
        ACTIVITY_OPTIONS.forEach { (level, label) ->
            RadioRow(label, selected = fields.activityLevel == level) { vm.editFuelling { it.copy(activityLevel = level) } }
        }
    }
    Label("Weight goal")
    Options(WEIGHT_GOAL_OPTIONS.map { (direction, label) -> direction.wireValue to label }, fields.goalDirection.wireValue) { wire ->
        WEIGHT_GOAL_OPTIONS.firstOrNull {
            it.first.wireValue == wire
        }?.let { (direction) -> vm.editFuelling { it.copy(goalDirection = direction) } }
    }
    state.fuellingProfile?.let(::calculateNutritionTarget)?.let { suggested ->
        val applyLabel = if (state.currentTarget != null) "Replace my daily targets with these" else "Set these as my daily targets"
        FitaiCard(Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Text(
                    "Suggested daily targets: ${jsNumberToString(
                        suggested.calories,
                    )} kcal · ${jsNumberToString(suggested.proteinG)} g protein · " +
                        "${jsNumberToString(suggested.carbG)} g carbs · ${jsNumberToString(suggested.fatG)} g fat",
                    style = FitaiTheme.typography.label,
                    color = colors.text,
                )
                Text(suggested.warning ?: suggested.explanation, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
                FitaiSwitchRow(applyLabel, checked = state.applyTargets, onCheckedChange = vm::setApplyTargets)
                if (state.currentTarget?.periodizationEnabled == true) {
                    Text(
                        "Your training-load carb settings carry over to the new targets.",
                        style = FitaiTheme.typography.bodySm,
                        color = colors.textMuted,
                    )
                }
            }
        }
    }
}

/** Height in centimetres, or in feet and inches for an athlete who weighs in pounds (as Settings asks it). */
@Composable
private fun HeightFields(fields: FuellingFields, imperial: Boolean, onChange: ((FuellingFields) -> FuellingFields) -> Unit) {
    if (!imperial) {
        FitaiTextField(fields.heightCm, { v -> onChange { it.copy(heightCm = v) } }, "Height (cm)", keyboardOptions = DECIMAL)
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiTextField(fields.heightFt, { v ->
            onChange { it.copy(heightFt = v) }
        }, "Height (ft)", Modifier.weight(1f), keyboardOptions = WHOLE)
        FitaiTextField(fields.heightIn, { v ->
            onChange { it.copy(heightIn = v) }
        }, "Height (in)", Modifier.weight(1f), keyboardOptions = DECIMAL)
    }
}

@Composable
private fun RadioRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = selected, onClick = onClick, role = Role.RadioButton),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
    ) {
        RadioButton(selected = selected, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = FitaiTheme.colors.primary))
        Text(label, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
    }
}
