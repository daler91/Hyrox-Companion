package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * "Scan a barcode" (BarcodeScanner.tsx): the camera where the phone has a
 * scanner ([onScan]), and the number typed by hand, always.
 */
@Composable
fun BarcodeSheet(state: BarcodeState, onScan: (() -> Unit)?, vm: BarcodeViewModel) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiBottomSheet(onDismissRequest = vm::close) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Text("Scan a barcode", style = type.h2, color = colors.text)
            if (onScan != null) {
                FitaiButton(
                    "Scan with camera",
                    onClick = onScan,
                    enabled = !state.lookingUp,
                    leadingIcon = LucideIcons.ScanLine,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("Or enter the number printed under the barcode.", style = type.bodySm, color = colors.textMuted)
            } else {
                Text("Enter the number printed under the barcode.", style = type.bodySm, color = colors.textMuted)
            }
            FitaiTextField(
                state.code,
                vm::type,
                "Barcode number",
                placeholder = "e.g. 3017620422003",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { vm.lookUpTyped() }),
            )
            FitaiButton(
                if (state.lookingUp) "Looking up…" else "Look up",
                onClick = vm::lookUpTyped,
                variant = if (onScan != null) ButtonVariant.Secondary else ButtonVariant.Primary,
                enabled = state.canLookUp,
                loading = state.lookingUp,
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.notRecognized) {
                Text(
                    "Barcode not recognized. Check the number, or search for the food instead.",
                    style = type.body,
                    color = colors.danger,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}
