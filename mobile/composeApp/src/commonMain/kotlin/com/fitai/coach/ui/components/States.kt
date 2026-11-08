package com.fitai.coach.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** A screen or section waiting on data. */
@Composable
fun LoadingState(modifier: Modifier = Modifier, message: String? = null) {
    StateLayout(modifier) {
        CircularProgressIndicator(color = FitaiTheme.colors.text, strokeWidth = 2.dp)
        if (message != null) {
            Text(message, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted, textAlign = TextAlign.Center)
        }
    }
}

/**
 * Nothing to show yet. Copy follows the brand voice: "no workouts yet this
 * week. that's ok — rest is training."
 */
@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    message: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    StateLayout(modifier) {
        Text(title, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, textAlign = TextAlign.Center)
        if (message != null) {
            Text(message, style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted, textAlign = TextAlign.Center)
        }
        if (actionLabel != null && onAction != null) {
            FitaiButton(text = actionLabel, onClick = onAction, variant = ButtonVariant.Secondary)
        }
    }
}

/**
 * Something failed. The message is announced by screen readers as it
 * appears; [onRetry] offers the way out ("retry, or finish logging by hand").
 */
@Composable
fun ErrorState(message: String, modifier: Modifier = Modifier, retryLabel: String = "retry", onRetry: (() -> Unit)? = null) {
    StateLayout(modifier) {
        Text(
            message,
            style = FitaiTheme.typography.body,
            color = FitaiTheme.colors.text,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        if (onRetry != null) {
            FitaiButton(text = retryLabel, onClick = onRetry, variant = ButtonVariant.Secondary)
        }
    }
}

@Composable
private fun StateLayout(modifier: Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(Spacing.Xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) { content() }
}
