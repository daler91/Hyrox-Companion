package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * The recipe builder (RecipeBuilderDialog.tsx): a name, how many servings it
 * makes, its ingredients in grams (found by search), and one serving's
 * nutrition as it's built. The recipe is then logged like any food.
 */
@Composable
fun RecipeSheet(state: RecipeSheetState, search: SearchState, vm: MyFoodsViewModel) {
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    FitaiBottomSheet(onDismissRequest = vm::closeRecipe) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Text(
                if (state.editingId ==
                    null
                ) {
                    "New recipe"
                } else {
                    "Edit recipe"
                },
                style = FitaiTheme.typography.h2,
                color = FitaiTheme.colors.text,
            )
            if (state.loading) {
                LoadingState()
                return@Column
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiTextField(state.name, { v -> vm.editRecipeSheet { it.copy(name = v) } }, "Recipe name", Modifier.weight(2f))
                FitaiTextField(
                    state.servings,
                    { v -> vm.editRecipeSheet { it.copy(servings = v) } },
                    "Servings",
                    Modifier.weight(1f),
                    keyboardOptions = number,
                )
            }
            Text("Ingredients", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            if (state.ingredients.isEmpty()) {
                Text("Search below to add ingredients.", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
            }
            state.ingredients.forEachIndexed { i, ingredient -> IngredientRow(i, ingredient, vm) }
            IngredientSearch(search, vm)
            PerServing(state)
            FitaiButton(
                if (state.editingId == null) "Create recipe" else "Save",
                onClick = vm::saveRecipe,
                enabled = state.valid,
                loading = state.saving,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** One ingredient: its name, its grams, and a remove button. [index] is its place in the list. */
@Composable
private fun IngredientRow(index: Int, ingredient: IngredientDraft, vm: MyFoodsViewModel) {
    fun setGrams(grams: String) = vm.editRecipeSheet { sheet ->
        sheet.copy(ingredients = sheet.ingredients.mapIndexed { i, other -> if (i == index) other.copy(grams = grams) else other })
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Text(ingredient.name, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
        FitaiTextField(
            ingredient.grams,
            ::setGrams,
            "Grams",
            Modifier.weight(INGREDIENT_GRAMS_WEIGHT),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            description = "Grams of ${ingredient.name}",
        )
        IconButton(onClick = {
            vm.editRecipeSheet { sheet -> sheet.copy(ingredients = sheet.ingredients.filterIndexed { i, _ -> i != index }) }
        }) {
            Icon(LucideIcons.Trash, contentDescription = "Remove ${ingredient.name}", tint = FitaiTheme.colors.textMuted)
        }
    }
}

private const val INGREDIENT_GRAMS_WEIGHT = 0.5f
private const val SHOWN_RESULTS = 6

/** Finds the next ingredient; picking one adds it and clears the search. */
@Composable
private fun IngredientSearch(search: SearchState, vm: MyFoodsViewModel) {
    FitaiTextField(search.query, vm::searchIngredients, "Add an ingredient", placeholder = "Search foods")
    when {
        search.searching -> Text("Searching…", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        search.searched && search.results.isEmpty() -> Text(
            "No foods found.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
    }
    search.results.take(SHOWN_RESULTS).forEach { food ->
        TextButton(onClick = { vm.addIngredient(food) }, modifier = Modifier.fillMaxWidth()) {
            Text(
                listOfNotNull(food.name, food.brand).joinToString(" · "),
                style = FitaiTheme.typography.body,
                color = FitaiTheme.colors.text,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** One serving's nutrition as the recipe stands. */
@Composable
private fun PerServing(state: RecipeSheetState) {
    val serving = state.perServing()
    FitaiCard {
        Text("Per serving", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
        Text(
            "${formatNumber(serving.calories)} kcal · P ${formatNumber(serving.protein)} · C ${formatNumber(serving.carb)} · " +
                "F ${formatNumber(serving.fat)} · Fiber ${formatNumber(serving.fiber)}",
            style = FitaiTheme.typography.body,
            color = FitaiTheme.colors.text,
        )
    }
}
