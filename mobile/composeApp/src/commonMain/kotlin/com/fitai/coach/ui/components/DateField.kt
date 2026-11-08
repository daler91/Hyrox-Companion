package com.fitai.coach.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.dates.isoDateToUtcMillis
import com.fitai.coach.core.dates.utcMillisToIsoDate
import com.fitai.coach.ui.format.longDate
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Sizes
import com.fitai.coach.ui.theme.Spacing

/**
 * A labelled date (YYYY-MM-DD) chosen from a calendar, styled as a text
 * field. [value] is "" for no date; [minDate] closes the days before it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FitaiDateField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String = "Pick a date",
    minDate: String? = null,
    error: String? = null,
    supportingText: String? = null,
) {
    val colors = FitaiTheme.colors
    val typography = FitaiTheme.typography
    var picking by remember { mutableStateOf(false) }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text(label, style = typography.bodySm.copy(fontWeight = typography.button.fontWeight), color = colors.text)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Sizes.Input)
                .border(if (error != null) 2.dp else 1.dp, if (error != null) colors.danger else colors.borderStrong, Radius.Md)
                .clickable(role = Role.Button, onClickLabel = "choose $label") { picking = true }
                .semantics { if (error != null) error(error) }
                .padding(horizontal = Spacing.Md),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(
                if (value.isEmpty()) placeholder else longDate(value),
                style = typography.body,
                color = if (value.isEmpty()) colors.textMuted else colors.text,
            )
        }
        (error ?: supportingText)?.let {
            Text(it, style = typography.bodySm, color = if (error != null) colors.danger else colors.textMuted)
        }
    }
    if (picking) {
        val min = minDate?.let(::isoDateToUtcMillis)
        val state = rememberDatePickerState(
            initialSelectedDateMillis = isoDateToUtcMillis(value),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = min == null || utcTimeMillis >= min
            },
        )
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onValueChange(utcMillisToIsoDate(it)) }
                    picking = false
                }) { Text("OK", color = colors.accentText) }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel", color = colors.textMuted) } },
            colors = DatePickerDefaults.colors(containerColor = colors.card),
        ) {
            DatePicker(
                state = state,
                colors = DatePickerDefaults.colors(
                    containerColor = colors.card,
                    selectedDayContainerColor = colors.primary,
                    selectedDayContentColor = colors.onPrimary,
                    todayDateBorderColor = colors.primary,
                ),
            )
        }
    }
}
