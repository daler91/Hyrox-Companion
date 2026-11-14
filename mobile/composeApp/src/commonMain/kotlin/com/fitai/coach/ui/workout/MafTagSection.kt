package com.fitai.coach.ui.workout

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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * "MAF test" on a run (MafTestTagSection, as a row): tag it to track pace at
 * the same heart rate over time; once tagged, correct or remove it.
 */
@Composable
fun MafTagRow(tag: MafTag, saving: Boolean, onOpenForm: () -> Unit, onRemove: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Icon(LucideIcons.Activity, contentDescription = null, tint = colors.textMuted)
        Column(Modifier.weight(1f)) {
            Text("MAF test", style = type.label, color = colors.text)
            if (tag.tagged) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    Icon(LucideIcons.CircleCheck, contentDescription = null, tint = colors.success)
                    Text("Tracked in your MAF trend", style = type.bodySm, color = colors.textMuted)
                }
            } else {
                Text("Track your pace at the same heart rate over time.", style = type.bodySm, color = colors.textMuted)
            }
        }
        if (tag.tagged) {
            IconButton(onClick = onOpenForm, enabled = !saving) {
                Icon(LucideIcons.Pencil, contentDescription = "Edit MAF test", tint = colors.text)
            }
            IconButton(onClick = onRemove, enabled = !saving) {
                Icon(LucideIcons.Trash, contentDescription = "Remove MAF test", tint = colors.text)
            }
        } else {
            FitaiButton(
                "Tag",
                onClick = onOpenForm,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = !saving,
                loading = saving,
                leadingIcon = LucideIcons.Activity,
            )
        }
    }
}

/**
 * The heart rate, duration and distance a MAF test is scored from (MafTestForm),
 * seeded from the run when tagging and from the saved test when correcting.
 * Distance is typed in the athlete's unit.
 */
@Composable
fun MafFormSheet(
    initial: MafForm,
    tagged: Boolean,
    distanceUnit: String?,
    saving: Boolean,
    onSave: (MafForm) -> Unit,
    onDismiss: () -> Unit,
) {
    var form by remember { mutableStateOf(initial) }
    var error by remember { mutableStateOf<String?>(null) }
    val whole = KeyboardOptions(keyboardType = KeyboardType.Number)
    val decimal = KeyboardOptions(keyboardType = KeyboardType.Decimal)
    // A field changed since the last try clears its complaint.
    val edit = { next: MafForm ->
        form = next
        error = null
    }
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Text(if (tagged) "Edit MAF test" else "Tag as MAF test", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
            Text(
                "Enter the heart rate, duration, and distance for this run. Leave a field blank if you don't have it — " +
                    "an average heart rate is needed for a compliance score.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                FitaiTextField(
                    form.avgHr,
                    { edit(form.copy(avgHr = it)) },
                    "Avg heart rate (bpm)",
                    Modifier.weight(1f),
                    placeholder = "$MIN_HEART_RATE–$MAX_HEART_RATE",
                    keyboardOptions = whole,
                )
                FitaiTextField(
                    form.maxHr,
                    { edit(form.copy(maxHr = it)) },
                    "Max heart rate (bpm)",
                    Modifier.weight(1f),
                    placeholder = "optional",
                    keyboardOptions = whole,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                FitaiTextField(form.duration, {
                    edit(form.copy(duration = it))
                }, "Duration (mm:ss)", Modifier.weight(1f), placeholder = "28:30")
                FitaiTextField(
                    form.distance,
                    { edit(form.copy(distance = it)) },
                    "Distance (${if (distanceUnit == "miles") "mi" else "km"})",
                    Modifier.weight(1f),
                    placeholder = "optional",
                    keyboardOptions = decimal,
                )
            }
            error?.let {
                Text(
                    it,
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.danger,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            FitaiButton(
                if (tagged) "Save changes" else "Tag as MAF test",
                onClick = {
                    error = form.error(distanceUnit)
                    if (error == null) onSave(form)
                },
                enabled = !saving,
                loading = saving,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
