package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.GetNutritionRecipesResponseItem
import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.api.generated.NutritionMealFuelTarget
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.dates.currentHourIn
import com.fitai.coach.core.dates.loggedAtFor
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.EmptyState
import com.fitai.coach.ui.components.ErrorState
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.components.offerUndo
import com.fitai.coach.ui.format.dayLabel
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.media.rememberCamera
import com.fitai.coach.ui.media.rememberPhotoPicker
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NutritionScreen(openDate: String? = null, onDateOpened: () -> Unit = {}) {
    val session = LocalUserSession.current
    val prefs by session.preferences.preferences.collectAsStateWithLifecycle(null)
    val timeZone = prefs?.userTimezone
    val vm = viewModel(key = "nutrition-${session.userId}") {
        NutritionViewModel(
            nutrition = session.nutrition,
            today = todayIn(timeZone),
            currentHour = { currentHourIn(timeZone) },
            loggedAt = { date -> loggedAtFor(date, todayIn(timeZone), timeZone) },
        )
    }
    val capture = viewModel(key = "meal-capture-${session.userId}") {
        MealCaptureViewModel(
            nutrition = session.nutrition,
            aiEnabled = session.preferences.preferences.map { it?.aiCoachEnabled },
            enableAi = { session.preferences.update(UpdateUserPreferences(aiCoachEnabled = true)) },
            currentHour = { currentHourIn(timeZone) },
            loggedAt = { date -> loggedAtFor(date, todayIn(timeZone), timeZone) },
        )
    }
    val myFoods = viewModel(key = "my-foods-${session.userId}") {
        MyFoodsViewModel(session.nutrition.myFoods, search = session.nutrition::search, openDate = { vm.state.value.date })
    }
    val targetsVm = viewModel(key = "targets-${session.userId}") {
        TargetsViewModel(
            session.nutrition.targets,
            profile = { session.preferences.preferences.first() ?: session.preferences.refresh() },
            openDate = { vm.state.value.date },
        )
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val customFoods by myFoods.customFoods.collectAsStateWithLifecycle()
    val recipes by myFoods.recipes.collectAsStateWithLifecycle()
    val customFoodSheet by myFoods.customFood.collectAsStateWithLifecycle()
    val recipeSheet by myFoods.recipe.collectAsStateWithLifecycle()
    val logSheet by vm.logSheet.collectAsStateWithLifecycle()
    val dailyTargets by targetsVm.daily.collectAsStateWithLifecycle()
    val mealTarget by targetsVm.meal.collectAsStateWithLifecycle()
    val captured by capture.state.collectAsStateWithLifecycle()
    val quickAdd by vm.quickAdd.collectAsStateWithLifecycle()
    val favoriteIds by vm.favoriteIds.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val toast: (String) -> Unit = { message -> scope.launch { toasts.showSnackbar(message) } }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    LaunchedEffect(vm) { vm.undos.collect { offerUndo(toasts, it) } }
    LaunchedEffect(capture) { capture.messages.collect { toasts.showSnackbar(it) } }
    LaunchedEffect(myFoods) { myFoods.messages.collect { toasts.showSnackbar(it) } }
    LaunchedEffect(targetsVm) { targetsVm.messages.collect { toasts.showSnackbar(it) } }
    val choosePhoto = rememberPhotoPicker(onPicked = capture::parsePhoto, onError = toast)
    val takePhoto = rememberCamera(onPicked = capture::parsePhoto, onError = toast)
    var logFoodOpen by remember { mutableStateOf(false) }
    LaunchedEffect(openDate) {
        openDate?.let {
            vm.goTo(it)
            onDateOpened()
        }
    }
    var searching by remember { mutableStateOf<Meal?>(null) }
    var searchOpen by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<NutritionLogEntryWithNutrition?>(null) }
    var deletingFood by remember { mutableStateOf<NutritionFood?>(null) }
    var deletingRecipe by remember { mutableStateOf<GetNutritionRecipesResponseItem?>(null) }

    Box(Modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = state.loading && state.summary != null,
            onRefresh = {
                vm.refresh()
                myFoods.refresh()
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(Spacing.Lg),
                verticalArrangement = Arrangement.spacedBy(Spacing.Md),
            ) {
                item { Header(state, vm) }
                val summary = state.summary
                when {
                    state.featureOff -> item {
                        EmptyState(title = "Nutrition isn't available yet", message = "Food logging is switched off for now.")
                    }
                    summary == null && state.loadFailed -> item { ErrorState("Couldn't load this day's food log", onRetry = vm::refresh) }
                    summary == null -> item { LoadingState() }
                    else -> {
                        item { Totals(summary, onSetTargets = targetsVm::openDaily) }
                        if (quickAdd.hasFoods) {
                            item {
                                QuickAddRows(quickAdd, state.quickLogging, onFavorite = vm::quickAddFavorite, onRecent = vm::quickAddRecent)
                            }
                        }
                        val meals = summary.visibleMeals()
                        // With no history there's nothing to repeat, so the shortcuts stay hidden (Nutrition.tsx isFirstRun).
                        val canRepeat = !quickAdd.firstRun
                        if (meals.isEmpty()) {
                            item {
                                Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                                    Text(
                                        "Nothing logged for ${dayLabel(state.date, state.today).lowercase()}.",
                                        style = FitaiTheme.typography.body,
                                        color = FitaiTheme.colors.textMuted,
                                    )
                                    if (canRepeat) RepeatPreviousDay(state.repeating, vm::repeatPreviousDay)
                                }
                            }
                        }
                        items(meals, key = { it.wireValue }) { meal ->
                            MealSection(
                                summary,
                                meal,
                                MealActions(
                                    vm,
                                    myFoods,
                                    state,
                                    favoriteIds,
                                    canRepeat = canRepeat,
                                    asks = MealAsks(
                                        add = {
                                            searching = it
                                            searchOpen = true
                                        },
                                        delete = { deleting = it },
                                        adjustTarget = targetsVm::openMeal,
                                    ),
                                ),
                            )
                        }
                        // Meals shown for their targets, nothing in them yet: the day can still be repeated.
                        if (meals.isNotEmpty() && summary.isEmptyDay() && canRepeat) {
                            item { RepeatPreviousDay(state.repeating, vm::repeatPreviousDay) }
                        }
                        item {
                            // One way in (LogFoodActions); it shows a photo is still being read.
                            FitaiButton(
                                if (captured.readingPhoto) "Reading your meal…" else "Log food",
                                onClick = { logFoodOpen = true },
                                leadingIcon = LucideIcons.Plus,
                                loading = captured.readingPhoto,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        val ownFoods = customFoods.orEmpty()
                        val ownRecipes = recipes.orEmpty()
                        if (ownFoods.isNotEmpty() || ownRecipes.isNotEmpty()) {
                            item {
                                MyFoodsSection(
                                    ownFoods,
                                    ownRecipes,
                                    favoriteIds,
                                    onToggleFavorite = vm::toggleFavorite,
                                    MyFoodsActions(
                                        editFood = myFoods::editCustomFood,
                                        deleteFood = { deletingFood = it },
                                        editRecipe = myFoods::editRecipe,
                                        deleteRecipe = { deletingRecipe = it },
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }

    if (searchOpen) {
        val search by vm.search.collectAsStateWithLifecycle()
        SearchSheet(search, favoriteIds, onToggleFavorite = vm::toggleFavorite, onQuery = vm::searchFor, onPick = { food ->
            searchOpen = false
            vm.startLog(food, searching)
        }, onDismiss = {
            searchOpen = false
            vm.clearSearch()
        })
    }
    if (logFoodOpen) {
        LogFoodSheet(
            LogFoodMethods(
                search = {
                    searching = null
                    searchOpen = true
                },
                describe = capture::openDescribe,
                takePhoto = takePhoto,
                choosePhoto = choosePhoto,
                customFood = myFoods::newCustomFood,
                recipe = myFoods::newRecipe,
            ),
            onDismiss = { logFoodOpen = false },
        )
    }
    captured.describe?.let { DescribeMealSheet(it, capture) }
    captured.review?.let { review ->
        val search by capture.search.collectAsStateWithLifecycle()
        MealReviewSheet(review, search, capture, state.date)
    }
    if (captured.consentOpen) AiConsentDialog(onAccept = capture::acceptAi, onDecline = capture::declineAi)
    logSheet?.let { LogSheet(it, favorite = it.food.id in favoriteIds, vm) }
    dailyTargets?.let { TargetsSheet(it, targetsVm) }
    mealTarget?.let { MealTargetSheet(it, targetsVm) }
    customFoodSheet?.let { CustomFoodSheet(it, myFoods) }
    recipeSheet?.let { sheet ->
        val ingredientSearch by myFoods.ingredientSearch.collectAsStateWithLifecycle()
        RecipeSheet(sheet, ingredientSearch, myFoods)
    }
    deletingFood?.let { food ->
        FitaiDialog(
            title = "Delete custom food?",
            text = "\"${food.name}\" will be permanently deleted. This cannot be undone.",
            confirmLabel = "Delete",
            onConfirm = {
                myFoods.deleteCustomFood(food)
                deletingFood = null
            },
            onDismiss = { deletingFood = null },
            destructive = true,
        )
    }
    deletingRecipe?.let { recipe ->
        FitaiDialog(
            title = "Delete recipe?",
            text = "\"${recipe.name}\" will be permanently deleted. This cannot be undone.",
            confirmLabel = "Delete",
            onConfirm = {
                myFoods.deleteRecipe(recipe)
                deletingRecipe = null
            },
            onDismiss = { deletingRecipe = null },
            destructive = true,
        )
    }
    deleting?.let { entry ->
        FitaiDialog(
            title = "Delete this entry?",
            text = "${entry.name} will be removed from ${dayLabel(state.date, state.today).lowercase()}.",
            confirmLabel = "Delete",
            onConfirm = {
                vm.delete(entry)
                deleting = null
            },
            onDismiss = { deleting = null },
            destructive = true,
        )
    }
}

@Composable
private fun Header(state: NutritionUiState, vm: NutritionViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text("nutrition", style = FitaiTheme.typography.h1, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = vm::previousDay) {
                Icon(LucideIcons.ChevronLeft, contentDescription = "previous day", tint = FitaiTheme.colors.text)
            }
            TextButton(onClick = vm::goToToday, modifier = Modifier.weight(1f)) {
                Text(dayLabel(state.date, state.today), style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
            }
            IconButton(onClick = vm::nextDay) {
                Icon(LucideIcons.ChevronRight, contentDescription = "next day", tint = FitaiTheme.colors.text)
            }
        }
    }
}

@Composable
private fun Totals(summary: GetNutritionSummaryResponse, onSetTargets: () -> Unit) {
    val target = summary.effectiveTarget
    FitaiCard {
        Macro("Calories", summary.totals.calories, target?.calories, "kcal")
        Macro("Protein", summary.totals.protein, target?.proteinG, "g")
        Macro("Carbs", summary.totals.carb, target?.carbG, "g")
        Macro("Fat", summary.totals.fat, target?.fatG, "g")
        Macro("Fiber", summary.totals.fiber, null, "g")
        target?.takeIf { it.scaled && it.carbDeltaG != 0.0 }?.let {
            Text(it.explanation, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        }
        TextButton(onClick = onSetTargets) { Text(if (target == null) "Set targets" else "Edit targets", color = FitaiTheme.colors.accent) }
    }
}

@Composable
private fun Macro(label: String, value: Double, target: Double?, unit: String) {
    val progress = MacroProgress(value, target)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Row {
            Text(label, style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted, modifier = Modifier.weight(1f))
            Text(
                formatNumber(value.roundToWhole()) + (target?.takeIf { it > 0 }?.let { " / ${formatNumber(it.roundToWhole())}" } ?: "") +
                    " $unit",
                style = FitaiTheme.typography.metric,
                color = FitaiTheme.colors.text,
            )
        }
        progress.fraction?.let { fraction ->
            LinearProgressIndicator(
                progress = { fraction },
                modifier = Modifier.fillMaxWidth(),
                color = if (progress.over) FitaiTheme.colors.warning else FitaiTheme.colors.primary,
                trackColor = FitaiTheme.colors.muted,
            )
        }
    }
}

private fun Double.roundToWhole(): Double = kotlin.math.round(this)

/** "Repeat previous day": the day before, copied onto this one. */
@Composable
private fun RepeatPreviousDay(repeating: Boolean, onRepeat: () -> Unit) {
    FitaiButton(
        if (repeating) "Repeating…" else "Repeat previous day",
        onClick = onRepeat,
        variant = ButtonVariant.Secondary,
        loading = repeating,
        leadingIcon = LucideIcons.CopyPlus,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * What a meal section can do, and the state its buttons wait on. [canRepeat]
 * is false with no history to copy.
 */
private class MealActions(
    val vm: NutritionViewModel,
    val myFoods: MyFoodsViewModel,
    val state: NutritionUiState,
    val favoriteIds: Set<String>,
    val canRepeat: Boolean,
    val asks: MealAsks,
)

private const val MIN_RECIPE_ENTRIES = 2

/** What a meal section asks of the screen: search for a food to add, confirm a delete, or adjust its target. */
private class MealAsks(
    val add: (Meal) -> Unit,
    val delete: (NutritionLogEntryWithNutrition) -> Unit,
    val adjustTarget: (Meal, NutritionMealFuelTarget) -> Unit,
)

@Composable
private fun MealSection(summary: GetNutritionSummaryResponse, meal: Meal, actions: MealActions) {
    val entries = summary.entries(meal)
    val target = summary.target(meal)
    val logged = entries.sumOf { it.nutrition.calories }
    FitaiCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The caption sits under the name: beside it, a phone's width wraps it a letter at a time.
            Column(Modifier.weight(1f)) {
                Text(meal.label, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
                target?.caption()?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.accentText) }
            }
            Text(
                "${formatNumber(logged.roundToWhole())}${target?.let { " / ${formatNumber(it.calories.roundToWhole())}" } ?: ""} kcal",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            // "My usual breakfast" in one action: the meal's entries seed a recipe.
            if (entries.size >= MIN_RECIPE_ENTRIES) {
                IconButton(onClick = { actions.myFoods.saveMealAsRecipe(meal, entries) }) {
                    Icon(
                        LucideIcons.ChefHat,
                        contentDescription = "Save ${meal.label.lowercase()} as a recipe",
                        tint = FitaiTheme.colors.textMuted,
                    )
                }
            }
            target?.let {
                IconButton(onClick = { actions.asks.adjustTarget(meal, it) }) {
                    Icon(
                        LucideIcons.SlidersHorizontal,
                        contentDescription = "Adjust ${meal.label.lowercase()} target",
                        tint = FitaiTheme.colors.textMuted,
                    )
                }
            }
        }
        target?.rationale?.takeIf {
            it.isNotBlank()
        }?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted) }
        if (entries.isEmpty()) {
            Text("Nothing logged yet.", style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
            if (actions.canRepeat) {
                FitaiButton(
                    "Copy yesterday's ${meal.label.lowercase()}",
                    onClick = { actions.vm.repeatPreviousDay(meal) },
                    variant = ButtonVariant.Ghost,
                    enabled = !actions.state.repeating,
                    leadingIcon = LucideIcons.CopyPlus,
                )
            }
        }
        entries.forEach { entry ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Tapping the entry edits it; its quick actions sit beside it.
                Column(
                    Modifier
                        .weight(1f)
                        .clickable(onClickLabel = "Edit") { actions.vm.startEdit(entry) }
                        .padding(vertical = Spacing.Xs),
                ) {
                    Text(entry.name, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
                    Text(
                        "${formatNumber(entry.quantityG)} g · ${formatNumber(entry.nutrition.calories.roundToWhole())} kcal · " +
                            "P ${formatNumber(
                                entry.nutrition.protein.roundToWhole(),
                            )} C ${formatNumber(entry.nutrition.carb.roundToWhole())} " +
                            "F ${formatNumber(entry.nutrition.fat.roundToWhole())}",
                        style = FitaiTheme.typography.bodySm,
                        color = FitaiTheme.colors.textMuted,
                    )
                }
                FavoriteStar(entry.foodId, entry.name, entry.foodId in actions.favoriteIds, actions.vm::toggleFavorite)
                IconButton(onClick = { actions.vm.logAgain(entry) }, enabled = !actions.state.quickLogging) {
                    Icon(LucideIcons.RotateCw, contentDescription = "log ${entry.name} again today", tint = FitaiTheme.colors.textMuted)
                }
                IconButton(onClick = { actions.asks.delete(entry) }) {
                    Icon(LucideIcons.Trash, contentDescription = "delete ${entry.name}", tint = FitaiTheme.colors.textMuted)
                }
            }
        }
        FitaiButton("Add to ${meal.label.lowercase()}", onClick = { actions.asks.add(meal) }, variant = ButtonVariant.Ghost)
    }
}
