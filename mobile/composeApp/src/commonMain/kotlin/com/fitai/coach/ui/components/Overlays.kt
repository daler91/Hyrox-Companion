package com.fitai.coach.ui.components

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.fitai.coach.ui.theme.DarkColors
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.LightColors
import com.fitai.coach.ui.theme.Radius

/** A modal bottom sheet with the brand's 20 dp sheet corners. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FitaiBottomSheet(onDismissRequest: () -> Unit, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val colors = FitaiTheme.colors
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = Radius.Xl,
        containerColor = colors.card,
        contentColor = colors.text,
        content = content,
    )
}

/**
 * A confirmation dialog. [destructive] styles the confirm button as danger,
 * for actions such as deleting a workout.
 */
@Composable
fun FitaiDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    dismissLabel: String = "cancel",
    destructive: Boolean = false,
) {
    val colors = FitaiTheme.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = FitaiTheme.typography.h3) },
        text = { Text(text, style = FitaiTheme.typography.body) },
        confirmButton = {
            FitaiButton(
                text = confirmLabel,
                onClick = onConfirm,
                variant = if (destructive) ButtonVariant.Danger else ButtonVariant.Primary,
            )
        },
        dismissButton = { FitaiButton(text = dismissLabel, onClick = onDismiss, variant = ButtonVariant.Ghost) },
        shape = Radius.Xl,
        containerColor = colors.card,
        titleContentColor = colors.text,
        textContentColor = colors.textMuted,
    )
}

/**
 * Where toasts appear: brief, lowercase confirmations ("run logged. 5.2 km at
 * 5:14/km.") shown with [SnackbarHostState.showSnackbar].
 */
@Composable
fun FitaiToastHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    val colors = FitaiTheme.colors
    SnackbarHost(state, modifier) { data ->
        Snackbar(
            snackbarData = data,
            shape = Radius.Md,
            containerColor = colors.text,
            contentColor = colors.background,
            // The toast is the inverse surface, so its action takes the other theme's accent.
            actionColor = if (colors.isDark) LightColors.accentText else DarkColors.accentText,
        )
    }
}
