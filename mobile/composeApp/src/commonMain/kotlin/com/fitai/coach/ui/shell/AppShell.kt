package com.fitai.coach.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import com.fitai.coach.core.auth.AuthGateway
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.EmptyState
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing
import kotlinx.coroutines.launch
import org.koin.compose.koinInject

/**
 * The signed-in app: the bottom bar's five destinations, and the coach,
 * which opens as a panel over any of them, as CoachPanel does on the web.
 * Destinations are placeholders until their v1 screens land (Phase 4).
 */
@Composable
fun AppShell() {
    val backStack = remember { AppBackStack() }
    var coachOpen by rememberSaveable { mutableStateOf(false) }
    val colors = FitaiTheme.colors

    Scaffold(
        containerColor = colors.background,
        bottomBar = { BottomBar(current = backStack.currentTab, onSelect = backStack::select) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { coachOpen = true },
                shape = Radius.Lg,
                containerColor = colors.primary,
                contentColor = colors.onPrimary,
                modifier = Modifier.semantics { contentDescription = "open coach" },
            ) { Icon(LucideIcons.MessageSquare, contentDescription = null) }
        },
    ) { padding ->
        NavDisplay(
            backStack = backStack.entries,
            onBack = { backStack.pop() },
            modifier = Modifier.padding(padding),
            entryProvider = entryProvider {
                entry<Route.Training> {
                    Placeholder("training", "your plan and logged workouts will show here, week by week.")
                }
                entry<Route.LogWorkout> {
                    Placeholder("log a workout", "type it, say it or snap it — the coach structures it for you.")
                }
                entry<Route.Nutrition> {
                    Placeholder("nutrition", "your food log and today's targets will show here.")
                }
                entry<Route.Analytics> {
                    Placeholder("analytics", "trends, personal records and progression will show here.")
                }
                entry<Route.Settings> { SettingsPlaceholder() }
            },
        )
    }

    if (coachOpen) CoachPanel(onClose = { coachOpen = false })
}

@Composable
private fun BottomBar(current: TopLevel, onSelect: (TopLevel) -> Unit) {
    val colors = FitaiTheme.colors
    Column {
        HorizontalDivider(color = colors.border)
        NavigationBar(containerColor = colors.background, tonalElevation = 0.dp) {
            TopLevel.entries.forEach { tab ->
                NavigationBarItem(
                    selected = tab == current,
                    onClick = { onSelect(tab) },
                    icon = { Icon(tab.icon, contentDescription = null) },
                    label = {
                        Text(
                            tab.shortTitle,
                            style = FitaiTheme.typography.label.copy(letterSpacing = FitaiTheme.typography.bodySm.letterSpacing),
                        )
                    },
                    modifier = Modifier.semantics { contentDescription = tab.title },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = colors.text,
                        selectedTextColor = colors.text,
                        indicatorColor = colors.muted,
                        unselectedIconColor = colors.textMuted,
                        unselectedTextColor = colors.textMuted,
                    ),
                )
            }
        }
    }
}

/** The coach panel. The streaming chat arrives with the v1 features (Phase 4). */
@Composable
private fun CoachPanel(onClose: () -> Unit) {
    FitaiBottomSheet(onDismissRequest = onClose) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.Lg),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Icon(LucideIcons.MessageSquare, contentDescription = null, tint = FitaiTheme.colors.text)
            Text(
                "coach",
                style = FitaiTheme.typography.h3,
                color = FitaiTheme.colors.text,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            IconButton(onClick = onClose) { Icon(LucideIcons.X, contentDescription = "close coach panel") }
        }
        EmptyState(
            title = "ask your coach",
            message = "chat about today's session, your plan or your recovery. coming in the next release.",
        )
    }
}

@Composable
private fun Placeholder(title: String, message: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { EmptyState(title = title, message = message) }
}

@Composable
private fun SettingsPlaceholder() {
    val auth = koinInject<AuthGateway>()
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            EmptyState(title = "settings", message = "profile, units, notifications and integrations will show here.")
            FitaiButton(text = "sign out", onClick = { scope.launch { runCatching { auth.signOut() } } }, variant = ButtonVariant.Secondary)
        }
    }
}
