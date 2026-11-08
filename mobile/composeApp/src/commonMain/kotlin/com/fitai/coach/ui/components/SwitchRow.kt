package com.fitai.coach.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Sizes
import com.fitai.coach.ui.theme.Spacing

/**
 * A labelled on/off setting. The whole row is the control, so it is one
 * touch target and a screen reader announces the label with the switch's
 * state, rather than an unlabelled switch beside some text.
 */
@Composable
fun FitaiSwitchRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = Sizes.TouchTarget)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch) { on ->
                haptics.performHapticFeedback(if (on) HapticFeedbackType.ToggleOn else HapticFeedbackType.ToggleOff)
                onCheckedChange(on)
            },
        horizontalArrangement = Arrangement.spacedBy(Spacing.Md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = FitaiTheme.typography.body,
            color = if (enabled) FitaiTheme.colors.text else FitaiTheme.colors.textMuted,
            modifier = Modifier.weight(1f),
        )
        Switch(
            checked = checked,
            onCheckedChange = null,
            enabled = enabled,
            colors = SwitchDefaults.colors(checkedTrackColor = FitaiTheme.colors.primary, checkedThumbColor = FitaiTheme.colors.onPrimary),
        )
    }
}
