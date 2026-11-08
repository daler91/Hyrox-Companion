package com.fitai.coach.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.NexusMark
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun SignInScreen(viewModel: SignInViewModel = koinViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    SignInContent(
        state = state,
        actions = object : SignInActions {
            override fun onEmailChange(value: String) = viewModel.onEmailChange(value)
            override fun onCodeChange(value: String) = viewModel.onCodeChange(value)
            override fun submitEmail() = viewModel.submitEmail()
            override fun submitCode() = viewModel.submitCode()
            override fun resendCode() = viewModel.resendCode()
            override fun changeEmail() = viewModel.changeEmail()
            override fun signInWithGoogle() = viewModel.signInWithGoogle()
        },
    )
}

/** The stateless form, for previews and screenshot tests. */
@Composable
fun SignInContent(state: SignInUiState, actions: SignInActions) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Spacing.Gutter, vertical = Spacing.Xxxl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.Lg),
        ) {
            Wordmark()
            when (val step = state.step) {
                SignInStep.EnterEmail -> EmailStep(state, actions)
                is SignInStep.EnterCode -> CodeStep(step.email, state, actions)
            }
        }
    }
}

@Composable
private fun Wordmark() {
    val colors = FitaiTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        NexusMark(size = 40.dp)
        Text(
            buildAnnotatedString {
                append("fitai")
                withStyle(SpanStyle(color = colors.textMuted)) { append(".coach") }
            },
            style = FitaiTheme.typography.h3,
            color = colors.text,
        )
    }
}

@Composable
private fun EmailStep(state: SignInUiState, actions: SignInActions) {
    Heading("sign in", "train in the loop. we'll email you a code — no password.")
    FitaiTextField(
        value = state.email,
        onValueChange = actions::onEmailChange,
        label = "email",
        placeholder = "you@example.com",
        error = state.error,
        enabled = !state.busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Go),
        keyboardActions = KeyboardActions(onGo = { actions.submitEmail() }),
        modifier = Modifier.fillMaxWidth(),
    )
    FitaiButton(
        text = "email me a code",
        onClick = actions::submitEmail,
        loading = state.busy,
        size = ButtonSize.Lg,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        HorizontalDivider(Modifier.weight(1f), color = FitaiTheme.colors.border)
        Text("or", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        HorizontalDivider(Modifier.weight(1f), color = FitaiTheme.colors.border)
    }
    FitaiButton(
        text = "continue with google",
        onClick = actions::signInWithGoogle,
        variant = ButtonVariant.Secondary,
        size = ButtonSize.Lg,
        enabled = !state.busy,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun CodeStep(email: String, state: SignInUiState, actions: SignInActions) {
    Heading("check your email", "we sent a 6-digit code to $email. it expires in 10 minutes.")
    FitaiTextField(
        value = state.code,
        onValueChange = actions::onCodeChange,
        label = "code",
        placeholder = "123456",
        error = state.error,
        supportingText = state.notice,
        enabled = !state.busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { actions.submitCode() }),
        modifier = Modifier.fillMaxWidth(),
    )
    FitaiButton(
        text = "sign in",
        onClick = actions::submitCode,
        loading = state.busy,
        size = ButtonSize.Lg,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        FitaiButton(text = "resend code", onClick = actions::resendCode, variant = ButtonVariant.Ghost, enabled = !state.busy)
        FitaiButton(text = "use another email", onClick = actions::changeEmail, variant = ButtonVariant.Ghost, enabled = !state.busy)
    }
}

@Composable
private fun Heading(title: String, body: String) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text(title, style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
        Text(body, style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
    }
}
