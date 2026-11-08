package com.fitai.coach.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.data.ExportFormat
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.core.health.HealthAvailability
import com.fitai.coach.core.health.HealthSync
import com.fitai.coach.core.health.HealthSyncScheduler
import com.fitai.coach.core.push.PushRegistration
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.links.DeepLink
import com.fitai.coach.ui.platform.rememberBrowser
import com.fitai.coach.ui.platform.rememberFileSharer
import com.fitai.coach.ui.platform.rememberHealthConnectAccess
import com.fitai.coach.ui.platform.rememberNotificationAccess
import com.fitai.coach.ui.privacy.PRIVACY_POLICY_URL
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import org.koin.compose.koinInject

private const val HOURS_IN_DAY = 24
private const val DEFAULT_NOTIFY_HOUR = 7
private const val DATE_PART = 10

@Composable
fun SettingsScreen(
    onRunSetup: (() -> Unit)? = null,
    stravaReturn: DeepLink.StravaReturn? = null,
    onStravaReturnHandled: () -> Unit = {},
) {
    val session = LocalUserSession.current
    val sessions = koinInject<SessionManager>()
    val push = koinInject<PushRegistration>()
    val health = koinInject<HealthSync>()
    val healthScheduler = koinInject<HealthSyncScheduler>()
    val vm = viewModel(key = "settings-${session.userId}") { SettingsViewModel(session, sessions, push, health, healthScheduler) }
    // Back from Health Connect's own settings, access may have changed.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refreshHealth() }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    LaunchedEffect(stravaReturn) {
        stravaReturn?.let {
            vm.finishStrava(it.code, it.state, it.error)
            onStravaReturnHandled()
        }
    }
    val browser = rememberBrowser()
    var dialog by remember { mutableStateOf<String?>(null) }

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.Lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Text("settings", style = FitaiTheme.typography.h1, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
            Profile(state, onRunSetup)
            state.preferences?.let { prefs ->
                Units(prefs, vm::update)
                Coach(prefs, vm::update)
                EmailNotifications(prefs, vm::update)
            }
            PushNotifications(state, vm)
            Integrations(state, vm, onConnectStrava = {
                vm.connectStrava(browser::open)
            }, onConnectGarmin = { dialog = GARMIN_FORM }, onDisconnect = {
                dialog =
                    it
            })
            Privacy(state, vm)
            Account(onSignOut = {
                dialog = if (state.pendingWrites >
                    0
                ) {
                    "sign-out-unsynced"
                } else {
                    "sign-out"
                }
            }, onDelete = { dialog = "delete" })
        }
        FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
    }
    Dialogs(dialog, state, vm, onClose = { dialog = null })
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    FitaiCard {
        Text(title, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
        content()
    }
}

@Composable
private fun Toggle(label: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val haptics = LocalHapticFeedback.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
        Switch(
            checked = checked,
            onCheckedChange = { on ->
                haptics.performHapticFeedback(if (on) HapticFeedbackType.ToggleOn else HapticFeedbackType.ToggleOff)
                onChange(on)
            },
            enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = FitaiTheme.colors.primary, checkedThumbColor = FitaiTheme.colors.onPrimary),
        )
    }
}

@Composable
private fun Profile(state: SettingsUiState, onRunSetup: (() -> Unit)?) {
    val user = state.user
    val name = listOfNotNull(user?.firstName, user?.lastName).joinToString(" ").ifBlank { user?.email ?: "User" }
    Section("Profile") {
        Text(name, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
        user?.email?.takeIf { it != name }?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted) }
        Text("Managed through your login provider.", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        onRunSetup?.let { FitaiButton("Run setup again", onClick = it, variant = ButtonVariant.Ghost) }
    }
}

@Composable
private fun Units(prefs: PreferencesResponse, update: (UpdateUserPreferences) -> Unit) {
    Section("Units") {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiChip("kg", selected = prefs.weightUnit != "lbs", onClick = {
                update(UpdateUserPreferences(weightUnit = UpdateUserPreferences.WeightUnit.Kg))
            })
            FitaiChip("lbs", selected = prefs.weightUnit == "lbs", onClick = {
                update(UpdateUserPreferences(weightUnit = UpdateUserPreferences.WeightUnit.Lbs))
            })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiChip("km", selected = prefs.distanceUnit != "miles", onClick = {
                update(UpdateUserPreferences(distanceUnit = UpdateUserPreferences.DistanceUnit.Km))
            })
            FitaiChip(
                "miles",
                selected = prefs.distanceUnit == "miles",
                onClick = { update(UpdateUserPreferences(distanceUnit = UpdateUserPreferences.DistanceUnit.Miles)) },
            )
        }
    }
}

@Composable
private fun Coach(prefs: PreferencesResponse, update: (UpdateUserPreferences) -> Unit) {
    Section("AI coach") {
        Toggle("AI coach", prefs.aiCoachEnabled == true) { update(UpdateUserPreferences(aiCoachEnabled = it)) }
        Toggle(
            "Apply the coach's plan changes automatically",
            prefs.coachAutoApplyPlanChanges == true,
            enabled =
            prefs.aiCoachEnabled == true,
        ) {
            update(UpdateUserPreferences(coachAutoApplyPlanChanges = it))
        }
    }
}

@Composable
private fun EmailNotifications(prefs: PreferencesResponse, update: (UpdateUserPreferences) -> Unit) {
    val on = prefs.emailNotifications == true
    val hour = prefs.notifyHour ?: DEFAULT_NOTIFY_HOUR
    Section("Email notifications") {
        Toggle("Receive email", on) { update(UpdateUserPreferences(emailNotifications = it)) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Send at ${hourLabel(hour)}",
                style = FitaiTheme.typography.body,
                color = FitaiTheme.colors.text,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = { update(UpdateUserPreferences(notifyHour = (hour + HOURS_IN_DAY - 1) % HOURS_IN_DAY)) }, enabled = on) {
                Icon(LucideIcons.ChevronLeft, contentDescription = "earlier", tint = FitaiTheme.colors.text)
            }
            IconButton(onClick = { update(UpdateUserPreferences(notifyHour = (hour + 1) % HOURS_IN_DAY)) }, enabled = on) {
                Icon(LucideIcons.ChevronRight, contentDescription = "later", tint = FitaiTheme.colors.text)
            }
        }
        Toggle("Weekly summary", prefs.emailWeeklySummary == true, on) { update(UpdateUserPreferences(emailWeeklySummary = it)) }
        Toggle("Missed workout reminders", prefs.emailMissedReminder == true, on) {
            update(UpdateUserPreferences(emailMissedReminder = it))
        }
        Toggle("Weekly review reminder", prefs.emailWeeklyReviewReminder == true, on) {
            update(UpdateUserPreferences(emailWeeklyReviewReminder = it))
        }
        Toggle("Today's session", prefs.emailTodaySession == true, on) { update(UpdateUserPreferences(emailTodaySession = it)) }
        Toggle("Analysis digest", prefs.emailAnalysisDigest == true, on) { update(UpdateUserPreferences(emailAnalysisDigest = it)) }
    }
}

@Composable
private fun PushNotifications(state: SettingsUiState, vm: SettingsViewModel) {
    val access = rememberNotificationAccess()
    Section("Notifications on this phone") {
        if (!state.pushAvailable) {
            Text(
                "Push notifications aren't available in this build.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            return@Section
        }
        Toggle("Push notifications", state.pushOn, enabled = state.busy != "push") { on ->
            if (on) access.request { granted -> if (granted) vm.enablePush() else vm.notificationsBlocked() } else vm.disablePush()
        }
        Text(
            "Training reminders, coach messages and nutrition reminders. Mute any of them in your phone's settings.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
        FitaiButton("Choose which notifications", onClick = access::openSettings, variant = ButtonVariant.Ghost)
    }
}

@Composable
private fun HealthConnectCard(state: SettingsUiState, vm: SettingsViewModel) {
    val access = rememberHealthConnectAccess() ?: return
    val health = state.health
    if (health.availability == HealthAvailability.Unsupported) return
    val busy = state.busy == "health"
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text("Health Connect", style = FitaiTheme.typography.label, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
        when {
            health.accessWithdrawn -> FitaiBadge("Access off", tone = BadgeTone.Warning)
            health.on -> FitaiBadge("Connected", tone = BadgeTone.Success)
            else -> FitaiBadge("Not connected")
        }
    }
    val connect = { access.requestPermissions { granted -> if (granted) vm.enableHealth() else vm.healthAccessDenied() } }
    when {
        health.availability == HealthAvailability.NeedsInstall -> {
            Text(
                "Import workouts from your watch and other fitness apps. Install or update Health Connect first.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            FitaiButton("Get Health Connect", onClick = access::openInstall, variant = ButtonVariant.Secondary)
        }
        health.accessWithdrawn -> {
            Text(
                "Health Connect access was turned off, so workouts stopped importing. Reconnect to resume.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton("Reconnect", onClick = connect, variant = ButtonVariant.Secondary, loading = busy)
                FitaiButton("Disconnect", onClick = vm::disconnectHealth, variant = ButtonVariant.Ghost, enabled = !busy)
            }
        }
        health.on -> {
            Text(
                "Workouts from Health Connect import automatically every few hours and when you open fitai.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton("Sync now", onClick = vm::syncHealth, variant = ButtonVariant.Secondary, loading = busy)
                FitaiButton("Disconnect", onClick = vm::disconnectHealth, variant = ButtonVariant.Ghost, enabled = !busy)
            }
        }
        else -> {
            Text(
                "Import workouts from your watch and other fitness apps through Health Connect. fitai only reads.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            FitaiButton("Connect Health Connect", onClick = connect, variant = ButtonVariant.Secondary, loading = busy)
        }
    }
}

@Composable
private fun Integrations(
    state: SettingsUiState,
    vm: SettingsViewModel,
    onConnectStrava: () -> Unit,
    onConnectGarmin: () -> Unit,
    onDisconnect: (String) -> Unit,
) {
    Section("Integrations") {
        val strava = state.strava
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text("Strava", style = FitaiTheme.typography.label, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
            when {
                strava?.requiresReauth == true -> FitaiBadge("Reconnect needed", tone = BadgeTone.Warning)
                strava?.connected == true -> FitaiBadge("Connected", tone = BadgeTone.Success)
                else -> FitaiBadge("Not connected")
            }
        }
        val connecting = state.busy == "strava-connect"
        when {
            strava?.requiresReauth == true -> {
                Text(
                    "Strava stopped accepting this connection. Reconnect to keep importing activities.",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                )
                FitaiButton("Reconnect Strava", onClick = onConnectStrava, variant = ButtonVariant.Secondary, loading = connecting)
            }
            strava?.connected == true -> {
                Text(
                    strava.lastSyncedAt?.let { "Last synced ${shortDate(it.take(DATE_PART))}" } ?: "Importing your recent activities…",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                    FitaiButton(
                        "Sync now",
                        onClick = vm::syncStrava,
                        variant = ButtonVariant.Secondary,
                        loading =
                        state.busy == "strava-sync",
                    )
                    FitaiButton("Disconnect", onClick = { onDisconnect("strava") }, variant = ButtonVariant.Ghost)
                }
            }
            else -> {
                Text(
                    "Import your runs and rides automatically. You'll approve it on Strava.",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                )
                FitaiButton("Connect Strava", onClick = onConnectStrava, variant = ButtonVariant.Secondary, loading = connecting)
            }
        }
        HealthConnectCard(state, vm)
        val garmin = state.garmin
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text("Garmin", style = FitaiTheme.typography.label, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
            FitaiBadge(
                if (garmin?.connected ==
                    true
                ) {
                    "Connected"
                } else {
                    "Not connected"
                },
                tone = if (garmin?.connected == true) BadgeTone.Success else BadgeTone.Neutral,
            )
        }
        garmin?.lastError?.takeIf {
            it.isNotBlank()
        }?.let { Text("Garmin sync is broken: $it", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.danger) }
        if (garmin?.connected == true) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton("Sync now", onClick = vm::syncGarmin, variant = ButtonVariant.Secondary, loading = state.busy == "garmin-sync")
                FitaiButton("Disconnect", onClick = { onDisconnect("garmin") }, variant = ButtonVariant.Ghost)
            }
        } else {
            FitaiButton("Connect Garmin", onClick = onConnectGarmin, variant = ButtonVariant.Secondary)
        }
    }
}

@Composable
private fun Privacy(state: SettingsUiState, vm: SettingsViewModel) {
    val uri = LocalUriHandler.current
    val sharer = rememberFileSharer()
    Section("Data & privacy") {
        Toggle(
            "Send error diagnostics",
            state.errorReporting == true,
            enabled = state.errorReporting != null,
            onChange = vm::setErrorReporting,
        )
        sharer?.let {
            Text("Export your training data", style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton(
                    "CSV",
                    onClick = { vm.export(ExportFormat.Csv, it::share) },
                    variant = ButtonVariant.Secondary,
                    loading = state.busy == "export",
                )
                FitaiButton(
                    "JSON",
                    onClick = { vm.export(ExportFormat.Json, it::share) },
                    variant = ButtonVariant.Secondary,
                    enabled =
                    state.busy != "export",
                )
            }
        }
        TextButton(onClick = { uri.openUri(PRIVACY_POLICY_URL) }) { Text("Privacy policy", color = FitaiTheme.colors.accent) }
    }
}

@Composable
private fun Account(onSignOut: () -> Unit, onDelete: () -> Unit) {
    Section("Account") {
        FitaiButton("Sign out", onClick = onSignOut, variant = ButtonVariant.Secondary, modifier = Modifier.fillMaxWidth())
        FitaiButton("Delete my account", onClick = onDelete, variant = ButtonVariant.Danger, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun Dialogs(dialog: String?, state: SettingsUiState, vm: SettingsViewModel, onClose: () -> Unit) {
    when (dialog) {
        "sign-out" -> FitaiDialog(
            title = "Sign out?",
            text = "Your data stays in your account; it is removed from this device.",
            confirmLabel = "Sign out",
            onConfirm = {
                onClose()
                vm.signOut()
            },
            onDismiss = onClose,
        )
        "sign-out-unsynced" -> FitaiDialog(
            title = "Sign out with unsynced changes?",
            text = unsyncedWarning(state.pendingWrites),
            confirmLabel = "Sign out anyway",
            onConfirm = {
                onClose()
                vm.signOut()
            },
            onDismiss = onClose,
            destructive = true,
        )
        "strava", "garmin" -> FitaiDialog(
            title = "Disconnect ${dialog.replaceFirstChar { it.uppercase() }}?",
            text = "Your synced activities will remain. New activities won't be imported until you connect again.",
            confirmLabel = "Disconnect",
            onConfirm = {
                onClose()
                if (dialog == "strava") vm.disconnectStrava() else vm.disconnectGarmin()
            },
            onDismiss = onClose,
            destructive = true,
        )
        GARMIN_FORM -> GarminConnectSheet(state.busy == "garmin-connect", vm, onClose)
        "delete" -> DeleteAccountDialog(state.busy == "delete", onConfirm = vm::deleteAccount, onDismiss = onClose)
        else -> Unit
    }
}

private const val GARMIN_FORM = "garmin-connect"

@Composable
private fun GarminConnectSheet(busy: Boolean, vm: SettingsViewModel, onClose: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    FitaiBottomSheet(onDismissRequest = onClose) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Text("Connect Garmin", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
            Text(
                "Garmin offers no sign-in for apps like ours, so we use your Garmin login. It is stored encrypted. " +
                    "Accounts with 2-step verification aren't supported.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            FitaiTextField(email, { email = it }, "Garmin email", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            FitaiTextField(
                password,
                { password = it },
                "Garmin password",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                visualTransformation = PasswordVisualTransformation(),
            )
            FitaiButton(
                "Connect",
                onClick = { vm.connectGarmin(email, password, onClose) },
                enabled = email.isNotBlank() && password.isNotEmpty(),
                loading = busy,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun DeleteAccountDialog(busy: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    var typed by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = FitaiTheme.colors.card,
        title = { Text("Are you absolutely sure?", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                Text(
                    "This permanently deletes your account: workouts, plans, food log, coach conversations and settings. " +
                        "It can't be undone.",
                    style = FitaiTheme.typography.body,
                    color = FitaiTheme.colors.text,
                )
                FitaiTextField(typed, { typed = it }, "Type $DELETE_CONFIRMATION to confirm:")
            }
        },
        confirmButton = {
            FitaiButton(
                "Delete my account",
                onClick = onConfirm,
                variant = ButtonVariant.Danger,
                enabled = typed == DELETE_CONFIRMATION,
                loading = busy,
            )
        },
        dismissButton = { FitaiButton("Cancel", onClick = onDismiss, variant = ButtonVariant.Ghost) },
    )
}
