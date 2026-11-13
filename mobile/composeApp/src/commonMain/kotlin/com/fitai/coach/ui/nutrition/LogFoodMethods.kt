package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** The ways to log food (LogFoodActions): each closes the sheet as it hands off. */
data class LogFoodMethods(
    val search: () -> Unit,
    val describe: () -> Unit,
    /** Null where there's no camera. */
    val takePhoto: (() -> Unit)?,
    /** Null where there's no photo picker. */
    val choosePhoto: (() -> Unit)?,
    /** Scan or type a packet's barcode: typing works everywhere. */
    val scanBarcode: () -> Unit,
    /** Photograph a nutrition label (or pick a photo of one); null with neither camera nor picker. */
    val scanLabel: (() -> Unit)?,
    /** Makes a food of the athlete's own. */
    val customFood: () -> Unit,
    /** Builds a recipe from foods. */
    val recipe: () -> Unit,
)

/** The Log food sheet: the fastest way to capture what the athlete ate. */
@Composable
fun LogFoodSheet(methods: LogFoodMethods, onDismiss: () -> Unit) {
    fun then(action: () -> Unit): () -> Unit = {
        onDismiss()
        action()
    }
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Text("Log food", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
            Text("Pick the fastest way to capture what you ate.", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
            MethodButton("Search foods", LucideIcons.Search, then(methods.search))
            MethodButton("Describe a meal", LucideIcons.Sparkles, then(methods.describe))
            methods.takePhoto?.let { MethodButton("Snap a meal", LucideIcons.Camera, then(it)) }
            methods.choosePhoto?.let { MethodButton("Choose a meal photo", LucideIcons.Image, then(it)) }
            MethodButton("Scan a barcode", LucideIcons.ScanLine, then(methods.scanBarcode))
            methods.scanLabel?.let { MethodButton("Scan label", LucideIcons.ScanText, then(it)) }
            Text("Make your own", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            FitaiButton(
                "Custom food",
                onClick = then(methods.customFood),
                variant = ButtonVariant.Ghost,
                leadingIcon = LucideIcons.Plus,
                modifier = Modifier.fillMaxWidth(),
            )
            FitaiButton(
                "Recipe",
                onClick = then(methods.recipe),
                variant = ButtonVariant.Ghost,
                leadingIcon = LucideIcons.ChefHat,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun MethodButton(label: String, icon: ImageVector, onClick: () -> Unit) {
    FitaiButton(label, onClick = onClick, variant = ButtonVariant.Secondary, leadingIcon = icon, modifier = Modifier.fillMaxWidth())
}
