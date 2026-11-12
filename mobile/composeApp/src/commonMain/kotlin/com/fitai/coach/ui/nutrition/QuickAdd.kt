package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.core.api.generated.NutritionFoodWithPortionMemory
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * The favourites and recent foods as chips (QuickAddBar.tsx). A favourite
 * logs at once in its usual portion; a recent food opens the log sheet.
 * Shown once there are some ([QuickAddState.hasFoods]).
 */
@Composable
fun QuickAddRows(
    state: QuickAddState,
    quickLogging: Boolean,
    onFavorite: (NutritionFoodWithPortionMemory) -> Unit,
    onRecent: (NutritionFoodWithPortionMemory) -> Unit,
) {
    val favorites = state.favorites.orEmpty()
    val recent = state.recent.orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        if (favorites.isNotEmpty()) FoodChipRow("Favorites", favorites, action = "Quick log", enabled = !quickLogging, onFavorite)
        if (recent.isNotEmpty()) FoodChipRow("Recent", recent, action = "Add", enabled = true, onRecent)
    }
}

@Composable
private fun FoodChipRow(
    title: String,
    foods: List<NutritionFoodWithPortionMemory>,
    action: String,
    enabled: Boolean,
    onPick: (NutritionFoodWithPortionMemory) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text(title, style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            items(foods, key = { it.id }) { food ->
                // The verb says what a tap does, and the name is whole when the chip cuts it short.
                FitaiChip(
                    chipLabel(food.name),
                    selected = false,
                    onClick = { onPick(food) },
                    enabled = enabled,
                    modifier = Modifier.semantics { contentDescription = "$action ${food.name}" },
                )
            }
        }
    }
}

/**
 * Stars a food for the quick-add row (FavoriteStarButton.tsx): the same
 * control on every food surface, filled once starred.
 */
@Composable
fun FavoriteStar(foodId: String, foodName: String, favorite: Boolean, onToggle: (String) -> Unit) {
    IconToggleButton(checked = favorite, onCheckedChange = { onToggle(foodId) }) {
        Icon(
            if (favorite) LucideIcons.StarFilled else LucideIcons.Star,
            contentDescription = if (favorite) "Remove $foodName from favourites" else "Add $foodName to favourites",
            tint = if (favorite) FitaiTheme.colors.warning else FitaiTheme.colors.textMuted,
        )
    }
}
