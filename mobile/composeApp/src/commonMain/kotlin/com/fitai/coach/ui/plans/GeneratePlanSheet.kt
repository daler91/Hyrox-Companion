package com.fitai.coach.ui.plans

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.nutrition.AI_CONSENT_TEXT
import com.fitai.coach.ui.onboarding.AiPlanFields
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** The generator sheet (GeneratePlanDialog): consent, the form, or the wait, by [GeneratePlanState.phase]. */
@Composable
fun GeneratePlanSheet(state: GeneratePlanState, vm: GeneratePlanViewModel) {
    if (!state.open) return
    val colors = FitaiTheme.colors
    FitaiBottomSheet(onDismissRequest = vm::close) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg).verticalScroll(rememberScrollState()).imePadding(),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                Icon(LucideIcons.Sparkles, contentDescription = null, tint = colors.accentText, modifier = Modifier.size(20.dp))
                Text(
                    "Generate an AI training plan",
                    style = FitaiTheme.typography.h3,
                    color = colors.text,
                    modifier = Modifier.semantics { heading() },
                )
            }
            Text(description(state.phase), style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            when (state.phase) {
                GeneratePhase.Consent -> Consent(state, vm)
                GeneratePhase.Form -> Form(state, vm)
                GeneratePhase.Generating -> Waiting(vm::close)
            }
        }
    }
}

private fun description(phase: GeneratePhase): String = when (phase) {
    GeneratePhase.Consent -> "AI plans are written by the AI Coach. Turn it on to generate one."
    GeneratePhase.Form -> "Your goal, schedule and anything to program around. It takes 1–2 minutes to write."
    GeneratePhase.Generating -> "Generating your plan. This takes 1–2 minutes."
}

@Composable
private fun Consent(state: GeneratePlanState, vm: GeneratePlanViewModel) {
    Text(AI_CONSENT_TEXT, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.text)
    state.error?.let { ErrorText(it) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.Sm, Alignment.End)) {
        FitaiButton("Not now", onClick = vm::close, variant = ButtonVariant.Secondary, enabled = !state.busy)
        FitaiButton("Enable AI Coach", onClick = vm::enableAiCoach, loading = state.busy)
    }
}

@Composable
private fun Form(state: GeneratePlanState, vm: GeneratePlanViewModel) {
    val form = state.form ?: return
    AiPlanFields(form, state.today, vm::edit, overlapping = state.overlapping, cardFacts = state.cardFacts)
    state.error?.let { ErrorText(it) }
    FitaiButton(
        "Generate plan",
        onClick = vm::generate,
        enabled = form.canGenerate,
        loading = state.busy,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun Waiting(onClose: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = Spacing.Lg), horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = FitaiTheme.colors.primary)
    }
    Text(
        "You can close this; the plan keeps generating and appears on your timeline when it's ready.",
        style = FitaiTheme.typography.bodySm,
        color = FitaiTheme.colors.textMuted,
    )
    FitaiButton("Close", onClick = onClose, variant = ButtonVariant.Secondary, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun ErrorText(message: String) {
    Text(
        message,
        style = FitaiTheme.typography.bodySm,
        color = FitaiTheme.colors.danger,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}
