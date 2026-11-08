package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
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
import com.fitai.coach.ui.format.dayLabel
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

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
    val state by vm.state.collectAsStateWithLifecycle()
    val logSheet by vm.logSheet.collectAsStateWithLifecycle()
    val targets by vm.targets.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    LaunchedEffect(openDate) {
        openDate?.let {
            vm.goTo(it)
            onDateOpened()
        }
    }
    var searching by remember { mutableStateOf<Meal?>(null) }
    var searchOpen by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<NutritionLogEntryWithNutrition?>(null) }

    Box(Modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = state.loading && state.summary != null,
            onRefresh = vm::refresh,
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
                        item { Totals(summary, onSetTargets = vm::openTargets) }
                        val meals = summary.visibleMeals()
                        if (meals.isEmpty()) {
                            item {
                                Text(
                                    "Nothing logged for ${dayLabel(state.date, state.today).lowercase()}.",
                                    style = FitaiTheme.typography.body,
                                    color = FitaiTheme.colors.textMuted,
                                )
                            }
                        }
                        items(meals, key = { it.wireValue }) { meal ->
                            MealSection(
                                summary,
                                meal,
                                onAdd = {
                                    searching = meal
                                    searchOpen = true
                                },
                                onEdit = vm::startEdit,
                                onDelete = { deleting = it },
                            )
                        }
                        item {
                            FitaiButton(
                                "Add food",
                                onClick = {
                                    searching = null
                                    searchOpen = true
                                },
                                leadingIcon = LucideIcons.Plus,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }

    if (searchOpen) {
        val search by vm.search.collectAsStateWithLifecycle()
        SearchSheet(search, onQuery = vm::searchFor, onPick = { food ->
            searchOpen = false
            vm.startLog(food, searching)
        }, onDismiss = {
            searchOpen = false
            vm.clearSearch()
        })
    }
    logSheet?.let { LogSheet(it, vm) }
    targets?.let { TargetsSheet(it, vm) }
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

@Composable
private fun MealSection(
    summary: GetNutritionSummaryResponse,
    meal: Meal,
    onAdd: () -> Unit,
    onEdit: (NutritionLogEntryWithNutrition) -> Unit,
    onDelete: (NutritionLogEntryWithNutrition) -> Unit,
) {
    val entries = summary.entries(meal)
    val target = summary.target(meal)
    val logged = entries.sumOf { it.nutrition.calories }
    FitaiCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(meal.label, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
            Text(
                "${formatNumber(logged.roundToWhole())}${target?.let { " / ${formatNumber(it.calories.roundToWhole())}" } ?: ""} kcal",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
        }
        target?.rationale?.takeIf {
            it.isNotBlank()
        }?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted) }
        if (entries.isEmpty()) Text("Nothing logged yet.", style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
        entries.forEach { entry ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
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
                TextButton(onClick = { onEdit(entry) }) { Text("Edit", color = FitaiTheme.colors.accent) }
                IconButton(onClick = { onDelete(entry) }) {
                    Icon(LucideIcons.Trash, contentDescription = "delete ${entry.name}", tint = FitaiTheme.colors.textMuted)
                }
            }
        }
        FitaiButton("Add to ${meal.label.lowercase()}", onClick = onAdd, variant = ButtonVariant.Ghost)
    }
}
