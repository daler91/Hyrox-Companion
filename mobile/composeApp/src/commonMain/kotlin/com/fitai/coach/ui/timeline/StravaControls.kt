package com.fitai.coach.ui.timeline

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/** A Strava recording's link controls on its card: the badge's menu and the "Was this your …?" row. */
class StravaControls(
    val options: DeviceLinkOptions,
    val onLink: (DeviceLinkOption) -> Unit,
    val onUnlink: () -> Unit,
    val onDismissSuggestion: () -> Unit,
)

/**
 * The controls for [entry] given its day's other entries, or null for a
 * card with no recording. Only a standalone import can be linked; a linked
 * one can be split back off.
 */
fun stravaControls(
    entry: TimelineEntry,
    dayEntries: List<TimelineEntry>,
    onLink: (DeviceLinkOption) -> Unit,
    onUnlink: () -> Unit,
    onDismissSuggestion: () -> Unit,
): StravaControls? {
    if (!hasStravaRecording(entry)) return null
    val options = if (entry.workoutLogId != null && isStandaloneStravaImport(entry)) {
        deviceLinkOptions(entry, dayEntries)
    } else {
        DeviceLinkOptions(null, emptyList())
    }
    return StravaControls(options, onLink, onUnlink, onDismissSuggestion)
}

/**
 * The Strava badge (StravaLinkBadge): plain on an import with nothing to do;
 * on a linked recording a menu to unlink it, and on a standalone import with
 * same-day sessions a menu to link it to one.
 */
@Composable
fun StravaBadge(entry: TimelineEntry, controls: StravaControls) {
    val linked = entry.deviceLinkSource != null
    val candidates = controls.options.candidates
    if (entry.workoutLogId == null || (!linked && candidates.isEmpty())) {
        FitaiBadge("Strava", tone = BadgeTone.Warning)
        return
    }
    var open by remember { mutableStateOf(false) }
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Box {
        Row(
            Modifier
                .heightIn(min = MIN_TOUCH.dp)
                .clickable(role = Role.Button, onClick = { open = true })
                .semantics(mergeDescendants = true) {
                    contentDescription = if (linked) "Strava activity options" else "Link this Strava activity to a workout"
                },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FitaiBadge("Strava", tone = BadgeTone.Warning)
            Icon(LucideIcons.ChevronDown, contentDescription = null, tint = colors.warning, modifier = Modifier.size(14.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = colors.card) {
            entry.deviceActivityName?.takeIf { it.isNotBlank() }?.let {
                Text(
                    it,
                    style = type.bodySm,
                    color = colors.textMuted,
                    modifier = Modifier.padding(horizontal = Spacing.Lg, vertical = Spacing.Xs),
                )
            }
            if (linked) {
                DropdownMenuItem(
                    text = { Text("Unlink Strava activity", style = type.body, color = colors.text) },
                    onClick = {
                        open = false
                        controls.onUnlink()
                    },
                )
            } else {
                Text(
                    "Link to a workout on this day",
                    style = type.label,
                    color = colors.text,
                    modifier = Modifier.padding(horizontal = Spacing.Lg, vertical = Spacing.Xs),
                )
                HorizontalDivider(color = colors.border)
                candidates.forEach { candidate ->
                    DropdownMenuItem(
                        text = { Text(candidate.label, style = type.body, color = colors.text) },
                        onClick = {
                            open = false
                            controls.onLink(candidate)
                        },
                    )
                }
            }
        }
    }
}

/** "Was this your Easy Run? [Link] [Not this one]" (DeviceLinkSuggestion). */
@Composable
fun LinkSuggestion(suggestion: DeviceLinkOption, controls: StravaControls) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Row(
        Modifier.fillMaxWidth().border(1.dp, colors.warning, Radius.Sm).padding(start = Spacing.Sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Was this your ${suggestion.label}?", style = type.bodySm, color = colors.text, modifier = Modifier.weight(1f))
        TextButton(onClick = { controls.onLink(suggestion) }) { Text("Link", style = type.label, color = colors.accentText) }
        TextButton(onClick = controls.onDismissSuggestion) { Text("Not this one", style = type.label, color = colors.textMuted) }
    }
}

private const val MIN_TOUCH = 48
