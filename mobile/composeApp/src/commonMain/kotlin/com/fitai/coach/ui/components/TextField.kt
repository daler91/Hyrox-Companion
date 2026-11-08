package com.fitai.coach.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Sizes
import com.fitai.coach.ui.theme.Spacing

/**
 * A labelled text input (brand kit §6): the label sits above the field, as on
 * the web, and the field has a 1 dp border that becomes a 2 dp ring on focus.
 * [error] replaces [supportingText] and is announced by screen readers.
 */
@Composable
fun FitaiTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    supportingText: String? = null,
    error: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    val colors = FitaiTheme.colors
    val typography = FitaiTheme.typography
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val (borderWidth, borderColor) = when {
        error != null -> 2.dp to colors.danger
        focused -> 2.dp to colors.ring
        else -> 1.dp to colors.borderStrong
    }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        // The label is read as the field's own description (below), so a screen
        // reader announces "email, edit box" rather than an unlabelled field.
        Text(
            label,
            style = typography.bodySm.copy(fontWeight = typography.button.fontWeight),
            color = colors.text,
            modifier = Modifier.clearAndSetSemantics {},
        )
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = Sizes.Input)
                .semantics {
                    contentDescription = label
                    if (error != null) error(error)
                },
            enabled = enabled,
            singleLine = singleLine,
            textStyle = typography.body.copy(color = if (enabled) colors.text else colors.textMuted),
            cursorBrush = SolidColor(colors.ring),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            visualTransformation = visualTransformation,
            interactionSource = interaction,
            decorationBox = { inner ->
                Box(
                    modifier = Modifier
                        .border(borderWidth, borderColor, Radius.Md)
                        .padding(horizontal = Spacing.Md, vertical = Spacing.Sm),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (value.isEmpty() && placeholder != null) {
                        Text(placeholder, style = typography.body, color = colors.textMuted)
                    }
                    inner()
                }
            },
        )
        val below = error ?: supportingText
        if (below != null) {
            Text(below, style = typography.bodySm, color = if (error != null) colors.danger else colors.textMuted)
        }
    }
}
