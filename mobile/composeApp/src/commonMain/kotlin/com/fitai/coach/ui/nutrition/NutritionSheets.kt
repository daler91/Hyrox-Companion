package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.nutrition.roundMacros
import com.fitai.coach.core.nutrition.scaleNutrition
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

@Composable
fun SearchSheet(
    state: SearchState,
    favoriteIds: Set<String>,
    onToggleFavorite: (String) -> Unit,
    onQuery: (String) -> Unit,
    onPick: (NutritionFood) -> Unit,
    onDismiss: () -> Unit,
) {
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Text("Add food", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
            FitaiTextField(state.query, onQuery, "Search foods", placeholder = "e.g., oats, banana, chicken breast")
            if (state.degraded) {
                Text(
                    "The food database is slow right now; results may be incomplete.",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.warning,
                )
            }
            when {
                state.searching -> Text("Searching…", style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
                state.searched && state.results.isEmpty() -> Text(
                    "No foods found.",
                    style = FitaiTheme.typography.body,
                    color = FitaiTheme.colors.textMuted,
                )
            }
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                items(state.results, key = { it.id }) { food ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SearchResult(food, onPick, Modifier.weight(1f))
                        FavoriteStar(food.id, food.name, food.id in favoriteIds, onToggleFavorite)
                    }
                }
            }
        }
    }
}

@Composable
private fun SearchResult(food: NutritionFood, onPick: (NutritionFood) -> Unit, modifier: Modifier) {
    TextButton(onClick = { onPick(food) }, modifier = modifier) {
        Column(Modifier.fillMaxWidth()) {
            Text(food.name, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
            Text(
                listOfNotNull(
                    food.brand,
                    "${food.caloriesPer100g?.let { formatNumber(it) } ?: "—"} kcal/100g",
                    food.proteinPer100g?.let { "P ${formatNumber(it)}" },
                ).joinToString(" · "),
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LogSheet(state: LogSheetState, favorite: Boolean, vm: NutritionViewModel) {
    FitaiBottomSheet(onDismissRequest = vm::closeLog) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(state.food.name, style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
                FavoriteStar(state.food.id, state.food.name, favorite, vm::toggleFavorite)
            }
            state.food.brand?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted) }
            FitaiTextField(
                state.amount,
                { amount -> vm.editLog { it.copy(amount = amount) } },
                "Amount",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                state.units.forEach { unit ->
                    FitaiChip(unit.label, selected = unit == state.unit, onClick = { vm.editLog { it.copy(unit = unit) } })
                }
            }
            Portions(state, vm)
            Text("Meal", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Meal.entries.forEach { meal ->
                    FitaiChip(meal.label, selected = meal == state.meal, onClick = {
                        vm.preferredMeal = meal
                        vm.editLog { it.copy(meal = meal) }
                    })
                }
            }
            state.quantityG?.let { grams ->
                val macros = roundMacros(scaleNutrition(state.food.per100g(), grams))
                Text(
                    "${formatNumber(grams)} g · ${formatNumber(macros.calories)} kcal · P ${formatNumber(macros.protein)} " +
                        "C ${formatNumber(macros.carb)} F ${formatNumber(macros.fat)}",
                    style = FitaiTheme.typography.body,
                    color = FitaiTheme.colors.text,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton(
                    if (state.editing == null) "Log food" else "Save",
                    onClick = vm::submitLog,
                    enabled = state.quantityG != null && (state.quantityG ?: 0.0) <= MAX_GRAMS,
                    loading = state.saving,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

private const val MAX_GRAMS = 100_000.0

/**
 * The athlete's own portions of the food, each removable, and the form that
 * adds one (LogFoodDialog.tsx AddPortionForm, PersonalPortions).
 */
@Composable
private fun Portions(state: LogSheetState, vm: NutritionViewModel) {
    val own = state.units.filter { it.own }
    if (own.isNotEmpty()) {
        Text("Your portions", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
        own.forEach { unit ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(unit.label, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.removePortion(unit) }) {
                    Icon(
                        LucideIcons.Trash,
                        contentDescription = "Remove ${unit.serving?.label ?: unit.label}",
                        tint = FitaiTheme.colors.textMuted,
                    )
                }
            }
        }
    }
    val draft = state.newPortion
    if (draft == null) {
        FitaiButton("Add portion", onClick = {
            vm.editNewPortion { PortionDraft() }
        }, variant = ButtonVariant.Ghost, leadingIcon = LucideIcons.Plus)
        return
    }
    Text("New portion", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiTextField(
            draft.label,
            { label -> vm.editNewPortion { it?.copy(label = label) } },
            "Portion label",
            placeholder = "e.g. 1 slice",
            modifier = Modifier.weight(1f),
        )
        FitaiTextField(
            draft.grams,
            { grams -> vm.editNewPortion { it?.copy(grams = grams) } },
            "Grams",
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.weight(PORTION_GRAMS_WEIGHT),
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiButton("Cancel", onClick = { vm.editNewPortion { null } }, variant = ButtonVariant.Ghost)
        FitaiButton(
            if (state.addingPortion) "Adding…" else "Add",
            onClick = vm::saveNewPortion,
            variant = ButtonVariant.Secondary,
            enabled = draft.portion() != null,
            loading = state.addingPortion,
        )
    }
}

private const val PORTION_GRAMS_WEIGHT = 0.6f

@Composable
fun TargetsSheet(state: TargetsSheetState, vm: NutritionViewModel) {
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    FitaiBottomSheet(onDismissRequest = vm::closeTargets) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Text("Daily targets", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
            if (state.loading) {
                LoadingState()
                return@Column
            }
            Text(
                "Set any you want to track; leave the rest blank. Your training-load settings stay as they are.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            FitaiTextField(state.calories, { v -> vm.editTargets { it.copy(calories = v) } }, "Calories (kcal)", keyboardOptions = number)
            FitaiTextField(state.protein, { v -> vm.editTargets { it.copy(protein = v) } }, "Protein (g)", keyboardOptions = number)
            FitaiTextField(state.carb, { v -> vm.editTargets { it.copy(carb = v) } }, "Carbs (g)", keyboardOptions = number)
            FitaiTextField(state.fat, { v -> vm.editTargets { it.copy(fat = v) } }, "Fat (g)", keyboardOptions = number)
            FitaiButton(
                "Save targets",
                onClick = vm::saveTargets,
                enabled = state.toTargets() != null,
                loading = state.saving,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
