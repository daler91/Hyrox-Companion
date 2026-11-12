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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import com.fitai.coach.core.api.generated.GetNutritionRecipesResponseItem
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiSwitchRow
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** A new custom food, or an edit of one (CustomFoodDialog.tsx). Nutrition is per 100 g. */
@Composable
fun CustomFoodSheet(state: CustomFoodSheetState, vm: MyFoodsViewModel) {
    val number = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    fun edit(change: (CustomFoodSheetState) -> CustomFoodSheetState) = vm.editCustomFoodSheet(change)
    FitaiBottomSheet(onDismissRequest = vm::closeCustomFood) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Text(
                if (state.editing == null) "New custom food" else "Edit custom food",
                style = FitaiTheme.typography.h2,
                color = FitaiTheme.colors.text,
            )
            FitaiTextField(state.name, { v -> edit { it.copy(name = v) } }, "Name")
            FitaiTextField(state.brand, { v -> edit { it.copy(brand = v) } }, "Brand (optional)")
            Text("Nutrition per 100 g", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiTextField(state.calories, { v ->
                    edit { it.copy(calories = v) }
                }, "Calories", Modifier.weight(1f), keyboardOptions = number)
                FitaiTextField(state.protein, { v ->
                    edit { it.copy(protein = v) }
                }, "Protein (g)", Modifier.weight(1f), keyboardOptions = number)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiTextField(state.carb, { v -> edit { it.copy(carb = v) } }, "Carbs (g)", Modifier.weight(1f), keyboardOptions = number)
                FitaiTextField(state.fat, { v -> edit { it.copy(fat = v) } }, "Fat (g)", Modifier.weight(1f), keyboardOptions = number)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiTextField(state.fiber, { v ->
                    edit { it.copy(fiber = v) }
                }, "Fiber (g)", Modifier.weight(1f), keyboardOptions = number)
                FitaiTextField(
                    state.servingSize,
                    { v -> edit { it.copy(servingSize = v) } },
                    "Serving (g)",
                    Modifier.weight(1f),
                    keyboardOptions = number,
                )
            }
            if (state.editing != null) {
                FitaiSwitchRow("Share publicly", checked = state.isPublic, onCheckedChange = { on -> edit { it.copy(isPublic = on) } })
                Text(
                    "Anyone can find and log this food. It stays available to others even if you delete your account.",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                )
            } else {
                NamedServings(state.portions) { portions -> edit { it.copy(portions = portions) } }
            }
            FitaiButton(
                if (state.editing == null) "Save food" else "Save",
                onClick = vm::saveCustomFood,
                enabled = state.valid,
                loading = state.saving,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** A new food's named portions: rows of a label and its grams, each removable. */
@Composable
private fun NamedServings(portions: List<PortionDraft>, onChange: (List<PortionDraft>) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "Named servings (optional)",
            style = FitaiTheme.typography.label,
            color = FitaiTheme.colors.textMuted,
            modifier = Modifier.weight(1f),
        )
        FitaiButton("Add", onClick = { onChange(portions + PortionDraft()) }, variant = ButtonVariant.Ghost, leadingIcon = LucideIcons.Plus)
    }
    portions.forEachIndexed { i, portion ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            FitaiTextField(
                portion.label,
                { v -> onChange(portions.mapIndexed { j, p -> if (j == i) p.copy(label = v) else p }) },
                "Name",
                Modifier.weight(1f),
                placeholder = "e.g. 1 cup",
                description = "Serving ${i + 1} name",
            )
            FitaiTextField(
                portion.grams,
                { v -> onChange(portions.mapIndexed { j, p -> if (j == i) p.copy(grams = v) else p }) },
                "Grams",
                Modifier.weight(SERVING_GRAMS_WEIGHT),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                description = "Serving ${i + 1} weight in grams",
            )
            IconButton(onClick = { onChange(portions.filterIndexed { j, _ -> j != i }) }) {
                Icon(LucideIcons.Trash, contentDescription = "Remove serving ${i + 1}", tint = FitaiTheme.colors.textMuted)
            }
        }
    }
}

private const val SERVING_GRAMS_WEIGHT = 0.6f

/**
 * The athlete's recipes and custom foods, to edit or delete (MyFoodsSection.tsx).
 * Logging one goes through search, like any food.
 */
@Composable
fun MyFoodsSection(
    customFoods: List<NutritionFood>,
    recipes: List<GetNutritionRecipesResponseItem>,
    favoriteIds: Set<String>,
    onToggleFavorite: (String) -> Unit,
    actions: MyFoodsActions,
) {
    FitaiCard {
        Text(
            "My foods & recipes",
            style = FitaiTheme.typography.h3,
            color = FitaiTheme.colors.text,
            modifier = Modifier.semantics {
                heading()
            },
        )
        if (recipes.isNotEmpty()) {
            Text("Recipes", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            recipes.forEach { recipe ->
                MyFoodRow(recipe.name, onEdit = { actions.editRecipe(recipe) }, onDelete = { actions.deleteRecipe(recipe) })
            }
        }
        if (customFoods.isNotEmpty()) {
            Text("Custom foods", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            customFoods.forEach { food ->
                MyFoodRow(food.name, onEdit = { actions.editFood(food) }, onDelete = { actions.deleteFood(food) }) {
                    FavoriteStar(food.id, food.name, food.id in favoriteIds, onToggleFavorite)
                }
            }
        }
    }
}

/** What the My foods rows do. */
class MyFoodsActions(
    val editFood: (NutritionFood) -> Unit,
    val deleteFood: (NutritionFood) -> Unit,
    val editRecipe: (GetNutritionRecipesResponseItem) -> Unit,
    val deleteRecipe: (GetNutritionRecipesResponseItem) -> Unit,
)

/** The My foods section's lists (from [myFoods]), the favourite stars, and what its rows do. */
class OwnFoods(
    val myFoods: MyFoodsViewModel,
    val favoriteIds: Set<String>,
    val onToggleFavorite: (String) -> Unit,
    val actions: MyFoodsActions,
)

@Composable
private fun MyFoodRow(name: String, onEdit: () -> Unit, onDelete: () -> Unit, leading: @Composable () -> Unit = {}) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(name, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
        leading()
        IconButton(onClick = onEdit) {
            Icon(LucideIcons.Pencil, contentDescription = "Edit $name", tint = FitaiTheme.colors.textMuted)
        }
        IconButton(onClick = onDelete) {
            Icon(LucideIcons.Trash, contentDescription = "Delete $name", tint = FitaiTheme.colors.textMuted)
        }
    }
}
