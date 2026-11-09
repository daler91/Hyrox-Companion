package com.fitai.coach.ui.coach

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.ChatFactProposal
import com.fitai.coach.core.api.generated.ChatSafetyNotice
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.data.MAX_CHAT_MESSAGE
import com.fitai.coach.core.data.newIdempotencyKey
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.FitaiToastHost
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.markdown.MarkdownText
import com.fitai.coach.ui.media.rememberCamera
import com.fitai.coach.ui.media.rememberPhotoPicker
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

private const val PANEL_HEIGHT = 0.92f
private const val COUNTER_FROM = 0.8

/**
 * The coach, as a panel over any screen (CoachPanel.tsx). With [thread] it is
 * that workout's own conversation (the web's embedded workout chat).
 */
@Composable
fun CoachPanel(onClose: () -> Unit, thread: CoachThread? = null) {
    val session = LocalUserSession.current
    val key = thread?.let { "coach-${session.userId}-${it.focus.planDayId}-${it.focus.workoutLogId}" } ?: "coach-${session.userId}"
    val vm = viewModel(key = key) {
        CoachViewModel(
            coach = session.coach,
            aiEnabled = session.preferences.preferences.map { it?.aiCoachEnabled },
            enableAi = { session.preferences.update(UpdateUserPreferences(aiCoachEnabled = true)) },
            onPlanChanged = { session.timeline.refresh() },
            newId = ::newIdempotencyKey,
            focus = thread?.focus,
        )
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val toasts = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }
    var confirmClear by remember { mutableStateOf(false) }
    val pickPhoto = rememberPhotoPicker(onPicked = vm::attachPhoto, onError = { scope.launch { toasts.showSnackbar(it) } })
    val takePhoto = rememberCamera(onPicked = vm::attachPhoto, onError = { scope.launch { toasts.showSnackbar(it) } })

    FitaiBottomSheet(onDismissRequest = onClose) {
        Box(Modifier.fillMaxHeight(PANEL_HEIGHT).imePadding()) {
            Column(Modifier.fillMaxWidth()) {
                // Clearing deletes every thread, so it is offered from the main conversation only.
                Header(
                    title = thread?.title,
                    canClear = thread == null && state.items.size > 1,
                    onClear = { confirmClear = true },
                    onClose = onClose,
                )
                HorizontalDivider(color = FitaiTheme.colors.border)
                if (state.aiEnabled == false) {
                    Consent(state.enablingAi, vm::enableAiCoach)
                } else {
                    Conversation(state, vm, Modifier.weight(1f))
                    Composer(state, vm, pickPhoto, takePhoto, seed = thread?.seed.orEmpty())
                }
            }
            FitaiToastHost(toasts, Modifier.align(Alignment.BottomCenter))
        }
    }
    if (confirmClear) {
        FitaiDialog(
            title = "Clear chat history?",
            text = "This will permanently delete your entire conversation with the AI coach. This action cannot be undone.",
            confirmLabel = "Clear",
            onConfirm = {
                confirmClear = false
                vm.clearHistory()
            },
            onDismiss = { confirmClear = false },
            destructive = true,
        )
    }
}

@Composable
private fun Header(title: String?, canClear: Boolean, onClear: () -> Unit, onClose: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.Lg, vertical = Spacing.Sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(LucideIcons.MessageSquare, contentDescription = null, tint = FitaiTheme.colors.text)
        Column(Modifier.weight(1f).padding(start = Spacing.Sm)) {
            Text("coach", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text, modifier = Modifier.semantics { heading() })
            // In a workout's thread: which workout the conversation is about.
            title?.let { Text("About: $it", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted, maxLines = 1) }
        }
        if (canClear) {
            IconButton(onClick = onClear) {
                Icon(LucideIcons.Trash, contentDescription = "clear chat history", tint = FitaiTheme.colors.textMuted)
            }
        }
        IconButton(onClick = onClose) { Icon(LucideIcons.X, contentDescription = "close coach panel", tint = FitaiTheme.colors.text) }
    }
}

@Composable
private fun Consent(saving: Boolean, onEnable: () -> Unit) {
    Column(Modifier.padding(Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        Text("Turn on the AI Coach", style = FitaiTheme.typography.h2, color = FitaiTheme.colors.text)
        Text(
            "The coach reads your training log, plan and notes to answer you, and sends them to our AI provider to do it. " +
                "You can turn it off again in Settings.",
            style = FitaiTheme.typography.body,
            color = FitaiTheme.colors.textMuted,
        )
        FitaiButton("Enable AI Coach", onClick = onEnable, loading = saving)
    }
}

@Composable
private fun Conversation(state: CoachUiState, vm: CoachViewModel, modifier: Modifier) {
    val list = rememberLazyListState()
    LaunchedEffect(state.items.size, state.items.lastOrNull()?.content?.length) {
        if (state.items.isNotEmpty()) list.animateScrollToItem(state.items.lastIndex + 1)
    }
    LazyColumn(
        modifier.fillMaxWidth(),
        state = list,
        contentPadding = PaddingValues(Spacing.Lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.Md),
    ) {
        item(key = "older") {
            if (state.canLoadOlder || state.olderFailed) {
                TextButton(onClick = vm::loadOlder, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        when {
                            state.loadingOlder -> "Loading older messages…"
                            state.olderFailed -> "Couldn't load older messages. Try again"
                            else -> "Load older messages"
                        },
                        color = FitaiTheme.colors.accentText,
                    )
                }
            }
        }
        items(state.items, key = { it.id }) { item ->
            when {
                item.kind == ChatKind.Summary -> Text(
                    "New conversation — the coach carried over a note of the earlier one",
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                )
                item.role == ChatRole.User -> UserBubble(item)
                else -> AssistantBubble(item, state, vm)
            }
        }
        item(key = "progress") {
            state.progress?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted) }
        }
    }
}

@Composable
private fun UserBubble(item: ChatItem) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier.widthIn(max = 320.dp).background(FitaiTheme.colors.primary, Radius.Lg).padding(Spacing.Md),
            verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
        ) {
            item.photoNote?.let { Text(it, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.onPrimary) }
            Text(item.content, style = FitaiTheme.typography.body, color = FitaiTheme.colors.onPrimary)
        }
    }
}

@Composable
private fun AssistantBubble(item: ChatItem, state: CoachUiState, vm: CoachViewModel) {
    val haptics = LocalHapticFeedback.current
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        item.safety?.let { notice ->
            FitaiBadge(
                notice.message,
                tone = if (notice.level == ChatSafetyNotice.Level.Urgent) BadgeTone.Danger else BadgeTone.Warning,
            )
        }
        if (item.fromNotes) FitaiBadge("From your coaching notes")
        if (item.content.isNotBlank()) MarkdownText(item.content)
        item.proposal?.let { proposal ->
            ProposalCard(
                proposal,
                busy = state.busyProposal == proposal.id,
                onApply = {
                    haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    vm.applyProposal(proposal, it)
                },
                onDismiss = { vm.dismissProposal(proposal) },
                onUndo = { vm.undoProposal(proposal) },
            )
        }
        item.fact?.takeIf { it.status == ChatFactProposal.Status.Pending }?.let { fact ->
            FitaiCard {
                Text("Save to your athlete card?", style = FitaiTheme.typography.label, color = colors.text)
                Text(fact.fact, style = FitaiTheme.typography.body, color = colors.text)
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                    FitaiButton("Save to card", onClick = { vm.decideFact(item, save = true) }, variant = ButtonVariant.Secondary)
                    FitaiButton("Not now", onClick = { vm.decideFact(item, save = false) }, variant = ButtonVariant.Ghost)
                }
            }
        }
        item.failure?.let { failure ->
            Text(
                failure.message,
                style = FitaiTheme.typography.bodySm,
                color = if (failure.retryable) colors.danger else colors.textMuted,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
            if (failure.retryable && !state.sending) {
                FitaiButton("Try again", onClick = { vm.retry(item.id) }, variant = ButtonVariant.Secondary)
            }
        }
        if (item.rateable && item.id != WELCOME_ID) {
            Row {
                IconButton(onClick = { vm.rate(item, up = true) }) {
                    Icon(
                        LucideIcons.ThumbsUp,
                        contentDescription = "good reply",
                        tint = if (item.feedbackUp == true) colors.accentText else colors.textMuted,
                    )
                }
                IconButton(onClick = { vm.rate(item, up = false) }) {
                    Icon(
                        LucideIcons.ThumbsDown,
                        contentDescription = "bad reply",
                        tint = if (item.feedbackUp == false) colors.accentText else colors.textMuted,
                    )
                }
            }
        }
    }
}

@Composable
private fun Composer(state: CoachUiState, vm: CoachViewModel, pickPhoto: (() -> Unit)?, takePhoto: (() -> Unit)?, seed: String) {
    var text by rememberSaveable(seed) { mutableStateOf(seed) }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.Lg, vertical = Spacing.Sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        if (!state.sending && state.quickActions.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                items(state.quickActions, key = {
                    it.label
                }) { action -> FitaiChip(action.label, selected = false, onClick = { vm.quickAction(action) }) }
            }
        }
        state.photo?.let {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FitaiBadge("Photo attached", tone = BadgeTone.Accent)
                IconButton(onClick = vm::removePhoto) {
                    Icon(LucideIcons.X, contentDescription = "remove photo", tint = FitaiTheme.colors.textMuted)
                }
            }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            takePhoto?.let {
                IconButton(onClick = it, enabled = state.photo == null) {
                    Icon(LucideIcons.Camera, contentDescription = "take a photo", tint = FitaiTheme.colors.text)
                }
            }
            pickPhoto?.let {
                IconButton(onClick = it, enabled = state.photo == null) {
                    Icon(LucideIcons.Image, contentDescription = "attach a photo", tint = FitaiTheme.colors.text)
                }
            }
            FitaiTextField(
                text,
                { text = it },
                "Message your coach",
                modifier = Modifier.weight(1f),
                singleLine = false,
                supportingText = if (text.length > MAX_CHAT_MESSAGE * COUNTER_FROM) "${text.length}/$MAX_CHAT_MESSAGE" else null,
                error = if (text.length > MAX_CHAT_MESSAGE) "Too long to send" else null,
            )
            if (state.sending) {
                IconButton(onClick = vm::stop) { Icon(LucideIcons.Square, contentDescription = "stop", tint = FitaiTheme.colors.text) }
            } else {
                IconButton(onClick = { if (vm.send(text)) text = "" }, enabled = text.isNotBlank() || state.photo != null) {
                    Icon(LucideIcons.Send, contentDescription = "send", tint = FitaiTheme.colors.accent)
                }
            }
        }
    }
}
