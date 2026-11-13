package com.fitai.coach.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.platform.rememberNotificationAccess
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private const val HOURS_IN_DAY = 24

/**
 * Email notifications (the web's EmailNotificationsCard): the master switch,
 * the default send time, and each email with its own switch and, once on,
 * the hour it alone goes out at ("Default" follows the default send time).
 */
@Composable
internal fun EmailNotifications(prefs: PreferencesResponse, update: (UpdateUserPreferences) -> Unit) {
    val on = prefs.emailNotifications == true
    val hour = defaultSendHour(prefs)
    Section("Email notifications") {
        Hint("Choose which training emails you want to receive.")
        Toggle("Receive email", on) { update(UpdateUserPreferences(emailNotifications = it)) }
        Hint("Master toggle. When off, no email of any type is sent.")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Default send time", style = FitaiTheme.typography.body, color = FitaiTheme.colors.text, modifier = Modifier.weight(1f))
            IconButton(onClick = { update(UpdateUserPreferences(notifyHour = (hour + HOURS_IN_DAY - 1) % HOURS_IN_DAY)) }, enabled = on) {
                Icon(LucideIcons.ChevronLeft, contentDescription = "earlier", tint = FitaiTheme.colors.text)
            }
            Text(hourLabel(hour), style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
            IconButton(onClick = { update(UpdateUserPreferences(notifyHour = (hour + 1) % HOURS_IN_DAY)) }, enabled = on) {
                Icon(LucideIcons.ChevronRight, contentDescription = "later", tint = FitaiTheme.colors.text)
            }
        }
        Hint("The hour in your local time that emails go out at unless you give one its own time.")
        EmailType.entries.forEach { type -> EmailTypeRow(type, prefs, masterOn = on, update = update) }
    }
}

@Composable
private fun EmailTypeRow(type: EmailType, prefs: PreferencesResponse, masterOn: Boolean, update: (UpdateUserPreferences) -> Unit) {
    val checked = type.isOn(prefs)
    Column(Modifier.padding(top = Spacing.Xs)) {
        Toggle(type.label, checked, enabled = masterOn) { update(type.switchPatch(it)) }
        Hint(type.description(prefs))
        // An hour for an email that isn't sent is noise, as on the web.
        if (checked && masterOn) SendAtPicker(type, prefs, update)
    }
}

@Composable
private fun SendAtPicker(type: EmailType, prefs: PreferencesResponse, update: (UpdateUserPreferences) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val current = type.sendTimeLabel(prefs)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text("Send at", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        Box {
            FitaiButton(
                current,
                onClick = { open = true },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = LucideIcons.ChevronDown,
                modifier = Modifier.semantics { contentDescription = "${type.label} send time, $current" },
            )
            DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = FitaiTheme.colors.card) {
                HourOption(type.defaultLabel(prefs)) {
                    open = false
                    update(type.hourPatch(null))
                }
                SEND_HOURS.forEach { hour ->
                    HourOption(hourLabel(hour)) {
                        open = false
                        update(type.hourPatch(hour))
                    }
                }
            }
        }
    }
}

@Composable
private fun HourOption(label: String, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(label, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text) }, onClick = onClick)
}

/**
 * Push on this phone (the web's PushNotificationSection): the switch, then,
 * while it is on, the nutrition reminders and a test notification.
 */
@Composable
internal fun PushNotifications(state: SettingsUiState, vm: SettingsViewModel) {
    val access = rememberNotificationAccess()
    Section("Notifications on this phone") {
        if (!state.pushAvailable) {
            Hint("Push notifications aren't available in this build.")
            return@Section
        }
        Toggle("Push notifications", state.pushOn, enabled = state.busy != "push") { on ->
            if (on) access.request { granted -> if (granted) vm.enablePush() else vm.notificationsBlocked() } else vm.disablePush()
        }
        Hint("Training reminders, coach messages and nutrition reminders. Mute any of them in your phone's settings.")
        if (state.pushOn) {
            Text(
                "Nutrition reminders",
                style = FitaiTheme.typography.label,
                color = FitaiTheme.colors.text,
                modifier = Modifier.padding(top = Spacing.Xs),
            )
            PushReminder.entries.forEach { reminder ->
                Toggle(reminder.label, state.reminderOn(reminder), enabled = state.user != null) { vm.setReminder(reminder, it) }
                Hint(reminder.description)
            }
            TestNotification(sending = state.busy == "push-test", onTest = vm::testPush)
        }
        FitaiButton("Choose which notifications", onClick = access::openSettings, variant = ButtonVariant.Ghost)
    }
}

@Composable
private fun TestNotification(sending: Boolean, onTest: () -> Unit) {
    Row(Modifier.padding(top = Spacing.Xs), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Test notification", style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
            Hint("Send a test to verify it works.")
        }
        FitaiButton(
            if (sending) "Sending…" else "Test",
            onClick = onTest,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            loading = sending,
            modifier = Modifier.semantics { contentDescription = "Send a test notification" },
        )
    }
}

@Composable
private fun Hint(text: String) = Text(text, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
