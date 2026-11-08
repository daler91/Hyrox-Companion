package com.fitai.coach.ui.health

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.platform.BrowserUriHandler
import com.fitai.coach.ui.platform.rememberBrowser
import com.fitai.coach.ui.privacy.PRIVACY_POLICY_URL
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** The rationale as its own window: the app's theme, with links in a Custom Tab. */
@Composable
fun HealthRationaleRoot(onClose: () -> Unit) {
    val browser = rememberBrowser()
    CompositionLocalProvider(LocalUriHandler provides remember(browser) { BrowserUriHandler(browser) }) {
        FitaiTheme {
            Surface(Modifier.fillMaxSize(), color = FitaiTheme.colors.background) { HealthRationaleScreen(onClose) }
        }
    }
}

/**
 * Why the app reads Health Connect data, shown from Health Connect's own
 * permission screens (the rationale Play requires for the health permissions).
 */
@Composable
fun HealthRationaleScreen(onClose: () -> Unit) {
    val uri = LocalUriHandler.current
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.Lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) {
        Text(
            "How fitai uses Health Connect",
            style = FitaiTheme.typography.h2,
            color = FitaiTheme.colors.text,
            modifier = Modifier.semantics {
                heading()
            },
        )
        Paragraph(
            "fitai reads your exercise sessions from Health Connect, with the heart rate, distance and active calories " +
                "recorded during them, so workouts from your watch or other fitness apps appear on your training timeline.",
        )
        Paragraph(
            "They feed your training log, analytics, training load and your AI coach's advice, as workouts you log " +
                "yourself do. fitai only reads; it never writes to Health Connect.",
        )
        Paragraph(
            "Sessions are sent to your fitai account over an encrypted connection and are never sold or used for " +
                "advertising. Turn the sync off in fitai's Settings, or withdraw access in Health Connect, at any time; " +
                "workouts already imported stay until you delete them.",
        )
        FitaiButton("Read the privacy policy", onClick = {
            uri.openUri(PRIVACY_POLICY_URL)
        }, variant = ButtonVariant.Secondary, modifier = Modifier.fillMaxWidth())
        FitaiButton("Close", onClick = onClose, variant = ButtonVariant.Ghost, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun Paragraph(text: String) = Text(text, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
