package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * For an athlete who has never logged a food (FirstRunStarter), in place of
 * "Repeat previous day", which has nothing to repeat: describe a meal in
 * plain words, scan a barcode, or set the targets ([onSetTargets] is null
 * once a daily target is set).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FirstMealPrompt(onDescribe: () -> Unit, onScanBarcode: () -> Unit, onSetTargets: (() -> Unit)?) {
    val colors = FitaiTheme.colors
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Log your first meal",
                style = FitaiTheme.typography.label,
                color = colors.text,
                modifier = Modifier.semantics {
                    heading()
                },
            )
            Text(
                "Type what you ate in plain English and we'll work out the foods and macros — it takes about 20 seconds.",
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
                textAlign = TextAlign.Center,
            )
            FitaiButton("Describe your last meal", onClick = onDescribe, leadingIcon = LucideIcons.Sparkles)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm, Alignment.CenterHorizontally)) {
                FitaiButton(
                    "Scan a barcode",
                    onClick = onScanBarcode,
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    leadingIcon = LucideIcons.ScanLine,
                )
                onSetTargets?.let { setTargets ->
                    FitaiButton(
                        "Set your targets",
                        onClick = setTargets,
                        variant = ButtonVariant.Secondary,
                        size = ButtonSize.Sm,
                        leadingIcon = LucideIcons.Target,
                    )
                }
            }
        }
    }
}
