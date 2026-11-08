package com.fitai.coach.ui.privacy

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** The public privacy policy, the page the web's notice links to. */
const val PRIVACY_POLICY_URL = "https://fitai.coach/privacy"

/**
 * The first-run privacy notice: what processes your data, and the analytics
 * choice. The wording follows the web's banner.
 */
@Composable
fun PrivacyNoticeContent(state: PrivacyNoticeState.Needed, onAcknowledge: (errorReporting: Boolean) -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val uriHandler = LocalUriHandler.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Spacing.Gutter, vertical = Spacing.Xxxl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.Lg),
        ) {
            Text("your data", style = type.h2, color = colors.text, modifier = Modifier.semantics { heading() })
            Text(
                "before you start: what handles your data, and one choice.",
                style = type.body,
                color = colors.textMuted,
            )
            FitaiCard(Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                    NoticeItem("error tracking", "crashes go to sentry, with personal details scrubbed. you can decline it.")
                    NoticeItem("integrations", "strava, garmin and ai coaching are each off until you turn them on.")
                    NoticeItem("your choice sticks", "change it anytime in settings.")
                }
            }
            FitaiButton(
                text = "read our privacy policy",
                onClick = { uriHandler.openUri(PRIVACY_POLICY_URL) },
                variant = ButtonVariant.Ghost,
            )
            if (state.error != null) {
                Text(state.error, style = type.bodySm, color = colors.danger)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                FitaiButton(
                    text = "decline analytics",
                    onClick = { onAcknowledge(false) },
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Lg,
                    enabled = !state.saving,
                    modifier = Modifier.weight(1f),
                )
                FitaiButton(
                    text = "accept",
                    onClick = { onAcknowledge(true) },
                    size = ButtonSize.Lg,
                    loading = state.saving,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun NoticeItem(title: String, body: String) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xxs)) {
        Text(title, style = FitaiTheme.typography.button, color = FitaiTheme.colors.text)
        Text(body, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}
