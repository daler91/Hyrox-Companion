package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.nutrition.roundMacros
import com.fitai.coach.core.nutrition.scaleNutrition
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/** "Describe a meal" (DescribeMealDialog): plain English in, foods to review out. */
@Composable
fun DescribeMealSheet(state: DescribeState, vm: MealCaptureViewModel) {
    val colors = FitaiTheme.colors
    FitaiBottomSheet(onDismissRequest = vm::closeDescribe) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Text("Describe a meal", style = FitaiTheme.typography.h2, color = colors.text)
            Text(
                "Type what you ate in plain English — we'll identify the foods and estimate portions for you to review before logging.",
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
            )
            FitaiTextField(
                state.text,
                vm::editDescription,
                "Describe your meal",
                placeholder = "e.g. 2 scrambled eggs, a slice of toast with butter, and a black coffee",
                supportingText = "${state.text.length}/$MAX_MEAL_DESCRIPTION",
                singleLine = false,
                enabled = !state.reading,
            )
            if (state.noFoodsFound) {
                Text(
                    "No foods detected — add a little more detail (amounts and cooking style help) and try again.",
                    style = FitaiTheme.typography.bodySm,
                    color = colors.warning,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton("Cancel", onClick = vm::closeDescribe, variant = ButtonVariant.Ghost, enabled = !state.reading)
                FitaiButton(
                    if (state.reading) "Reading…" else "Review foods",
                    onClick = vm::parseDescription,
                    enabled = !state.reading && state.text.isNotBlank(),
                    loading = state.reading,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/**
 * Review and confirm a parsed meal (ParsedMealReviewSheet): each suggested
 * food with its grams, meal and match, any of which the athlete can change;
 * only matched rows are logged, together.
 */
@Composable
fun MealReviewSheet(review: MealReview, search: SearchState, vm: MealCaptureViewModel, date: String) {
    val colors = FitaiTheme.colors
    FitaiBottomSheet(onDismissRequest = vm::closeReview) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Text("Review parsed foods", style = FitaiTheme.typography.h2, color = colors.text)
            if (review.warnings.isNotEmpty()) {
                Text(
                    review.warnings.joinToString(" · "),
                    style = FitaiTheme.typography.bodySm,
                    color = colors.text,
                    modifier = Modifier.fillMaxWidth().background(
                        colors.warning.copy(alpha = WARNING_ALPHA),
                        Radius.Md,
                    ).padding(Spacing.Sm),
                )
            }
            if (review.rows.isEmpty()) {
                Text(
                    "No foods detected. Try describing the meal differently.",
                    style = FitaiTheme.typography.body,
                    color = colors.textMuted,
                )
            }
            review.rows.forEachIndexed { i, row ->
                ReviewRowCard(row, swapping = review.swapping == i, search = search, index = i, vm = vm)
            }
            unresolvedNote(review.unresolved)?.let { Text(it, style = FitaiTheme.typography.bodySm, color = colors.textMuted) }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton("Cancel", onClick = vm::closeReview, variant = ButtonVariant.Ghost, enabled = !review.logging)
                FitaiButton(
                    if (review.logging) "Logging…" else logItemsLabel(review.loggable.size),
                    onClick = { vm.logReview(date) },
                    enabled = review.loggable.isNotEmpty() && !review.logging,
                    loading = review.logging,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

private const val WARNING_ALPHA = 0.15f

@Composable
private fun ReviewRowCard(row: ReviewRow, swapping: Boolean, search: SearchState, index: Int, vm: MealCaptureViewModel) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(row.displayAmount, style = type.label, color = colors.text)
                    val food = row.food
                    if (food == null) {
                        Text("No match — choose a food to log this.", style = type.bodySm, color = colors.warning)
                    } else {
                        Text(food.name + food.brand?.let { " · $it" }.orEmpty(), style = type.bodySm, color = colors.textMuted)
                    }
                }
                IconButton(onClick = { vm.removeRow(index) }) {
                    Icon(LucideIcons.Trash, contentDescription = "Remove ${row.displayAmount}", tint = colors.textMuted)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiTextField(
                    row.grams,
                    { vm.editGrams(index, it) },
                    "Grams of ${row.displayAmount}",
                    modifier = Modifier.width(140.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                MealPicker(row.meal, "Meal for ${row.displayAmount}") { vm.setMeal(index, it) }
            }
            row.food?.let { food ->
                row.quantityG?.let { grams ->
                    val macros = roundMacros(scaleNutrition(food.per100g(), grams))
                    Text(
                        "${formatNumber(macros.calories)} kcal · P${formatNumber(macros.protein)} C${formatNumber(macros.carb)} " +
                            "F${formatNumber(macros.fat)}",
                        style = type.bodySm,
                        color = colors.textMuted,
                    )
                }
            }
            if (swapping) {
                SwapSearch(search, vm)
            } else {
                TextButton(onClick = { vm.swapRow(index) }) {
                    Text(if (row.food == null) "Find a match" else "Change food", color = colors.accentText)
                }
            }
        }
    }
}

/** The meal as a menu: seven chips per row would bury the review. */
@Composable
private fun MealPicker(meal: Meal, description: String, onPick: (Meal) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }, modifier = Modifier.semantics { contentDescription = "$description: ${meal.label}" }) {
            Text("${meal.label} ▾", color = FitaiTheme.colors.text, style = FitaiTheme.typography.body)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Meal.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label) },
                    onClick = {
                        open = false
                        onPick(option)
                    },
                )
            }
        }
    }
}

@Composable
private fun SwapSearch(search: SearchState, vm: MealCaptureViewModel) {
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        FitaiTextField(search.query, vm::searchFor, "Search foods", placeholder = "e.g., oats, banana, chicken breast")
        when {
            search.searching -> Text("Searching…", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            search.searched && search.results.isEmpty() -> Text(
                "No foods found.",
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
            )
        }
        Column(Modifier.heightIn(max = 280.dp).verticalScroll(rememberScrollState())) {
            search.results.forEach { food ->
                TextButton(onClick = { vm.pickFood(food) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth()) {
                        Text(food.name, style = FitaiTheme.typography.body, color = colors.text)
                        Text(
                            listOfNotNull(
                                food.brand,
                                "${food.caloriesPer100g?.let {
                                    formatNumber(it)
                                } ?: "—"} kcal/100g",
                            ).joinToString(" · "),
                            style = FitaiTheme.typography.bodySm,
                            color = colors.textMuted,
                        )
                    }
                }
            }
        }
        TextButton(onClick = { vm.swapRow(null) }) { Text("Done", color = colors.accentText) }
    }
}

/** AI consent before the first AI parse (AIConsentDialog): what is sent, and that it can be turned off. */
@Composable
fun AiConsentDialog(onAccept: () -> Unit, onDecline: () -> Unit) {
    FitaiDialog(
        title = "Enable AI Coach",
        text = "The AI Coach uses the configured AI provider to analyze your training and provide personalized coaching. " +
            "To do this, your recent workout history, training plan, performance metrics, the chat messages you send the coach, " +
            "and the meal descriptions and photos you submit for AI food logging are sent for processing. " +
            "Your data is used solely by this app to generate coaching responses. You can disable the AI Coach at any time in " +
            "Settings. By enabling, you consent to this data processing.",
        confirmLabel = "Enable AI Coach",
        onConfirm = onAccept,
        onDismiss = onDecline,
        dismissLabel = "Not now",
    )
}
