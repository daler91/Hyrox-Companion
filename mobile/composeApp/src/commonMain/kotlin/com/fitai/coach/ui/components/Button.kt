package com.fitai.coach.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Sizes
import com.fitai.coach.ui.theme.Spacing

/** Button variants (brand kit §6). */
enum class ButtonVariant {
    /** Main call to action: ink on paper, lime in dark mode. */
    Primary,

    /** Brand moment or hero CTA: lime. Use sparingly. */
    Accent,

    /** Secondary action: outlined. */
    Secondary,

    /** Low emphasis: text only. */
    Ghost,

    /** Destructive. */
    Danger,
}

enum class ButtonSize(val height: Dp, val horizontalPadding: Dp) {
    Sm(Sizes.ButtonSm, Spacing.Md),
    Md(Sizes.ButtonMd, Spacing.Lg),
    Lg(Sizes.ButtonLg, Spacing.Xl),
}

/**
 * The app's button. Small and medium buttons keep their visual height but
 * still get a 48 dp touch target (Material's minimum interactive size).
 * While [loading], it shows a spinner and ignores taps.
 */
@Composable
fun FitaiButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Primary,
    size: ButtonSize = ButtonSize.Md,
    enabled: Boolean = true,
    loading: Boolean = false,
    leadingIcon: ImageVector? = null,
) {
    val colors = FitaiTheme.colors
    val (container, content) = when (variant) {
        ButtonVariant.Primary -> colors.primary to colors.onPrimary
        ButtonVariant.Accent -> colors.accent to colors.onAccent
        ButtonVariant.Secondary, ButtonVariant.Ghost -> Color.Transparent to colors.text
        ButtonVariant.Danger -> colors.danger to colors.onDanger
    }
    Button(
        onClick = onClick,
        modifier = modifier
            .height(size.height)
            .semantics { if (loading) stateDescription = "loading" },
        enabled = enabled && !loading,
        shape = Radius.Md,
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            disabledContainerColor = if (container == Color.Transparent) container else colors.muted,
            disabledContentColor = colors.textMuted,
        ),
        border = if (variant == ButtonVariant.Secondary) BorderStroke(1.dp, colors.borderStrong) else null,
        contentPadding = PaddingValues(horizontal = size.horizontalPadding),
        elevation = null,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(Sizes.Icon - 4.dp),
                    color = content,
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.width(Spacing.Sm))
            } else if (leadingIcon != null) {
                Icon(leadingIcon, contentDescription = null, modifier = Modifier.size(Sizes.Icon))
                Spacer(Modifier.width(Spacing.Sm))
            }
            Text(text, style = FitaiTheme.typography.button)
        }
    }
}
