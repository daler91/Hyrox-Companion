package com.fitai.coach.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.AthleteFact
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/**
 * Settings → Athlete card: what the coach should always program around, in
 * the athlete's own words. Every plan and every coach reply reads the facts
 * in force; one past its review date asks "Still true?".
 */
@Composable
fun AthleteCardSection(toasts: SnackbarHostState) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "athlete-card-${session.userId}") { AthleteCardViewModel(session, ::todayIn) }
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }

    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Text(
                "Athlete card",
                style = FitaiTheme.typography.h3,
                color = FitaiTheme.colors.text,
                modifier = Modifier.semantics {
                    heading()
                },
            )
            Text(
                "What your coach should always program around, in your own words: injuries, equipment you don't have, " +
                    "your schedule. Every plan and every coach reply reads it.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            state.legacyNote?.let { LegacyNote(it, state.busy, vm) }
            val card = state.card
            when {
                card != null -> Facts(card, state, vm)
                state.loadFailed -> LoadFailed(vm::refresh)
                else -> Text("Loading your athlete card…", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
            }
        }
    }
    state.confirm?.let { ConfirmStep(it, vm) }
}

@Composable
private fun LoadFailed(retry: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Text("Couldn't load your athlete card.", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        FitaiButton("Try again", onClick = retry, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
    }
}

@Composable
private fun Facts(card: AthleteCardFacts, state: AthleteCardState, vm: AthleteCardViewModel) {
    if (card.active.isEmpty()) {
        Text(
            "Nothing yet. Add what your coach should always know, like “No sled at my gym” or “I work night shifts on Tuesdays”.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
    }
    card.active.forEach { fact ->
        val edit = state.editing
        if (edit != null && edit.id == fact.id) {
            FactEditor(edit, state.busy, vm)
        } else {
            FactRow(fact, due = isAthleteFactDue(fact.reviewOn, state.today), busy = state.busy, vm = vm)
        }
    }
    AddFact(state, card.atCap, vm)
    if (card.retired.isNotEmpty()) RetiredFacts(card.retired, canRestore = !card.atCap && !state.busy, busy = state.busy, vm = vm)
}

@Composable
private fun Boxed(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().border(1.dp, FitaiTheme.colors.border, Radius.Md).padding(Spacing.Sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) { content() }
}

/** One fact the coach reads, with its "Still true?" check once it is due. */
@Composable
private fun FactRow(fact: AthleteFact, due: Boolean, busy: Boolean, vm: AthleteCardViewModel) {
    val colors = FitaiTheme.colors
    Boxed {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Text(fact.fact, style = FitaiTheme.typography.body, color = colors.text)
                FitaiBadge(athleteFactCategoryLabel(fact.category))
            }
            IconButton(onClick = { vm.startEdit(fact) }, enabled = !busy) {
                Icon(LucideIcons.Pencil, contentDescription = "Edit \"${fact.fact}\"", tint = colors.textMuted)
            }
            IconButton(onClick = { vm.ask(AthleteCardConfirm.Retire(fact)) }, enabled = !busy) {
                Icon(LucideIcons.Archive, contentDescription = "Retire \"${fact.fact}\"", tint = colors.textMuted)
            }
        }
        if (due) StillTrue(fact, busy, vm)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StillTrue(fact: AthleteFact, busy: Boolean, vm: AthleteCardViewModel) {
    Column(
        Modifier.fillMaxWidth().background(FitaiTheme.colors.muted, Radius.Md).padding(Spacing.Sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        Text("Still true?", style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
        Text("You haven't confirmed this in a while.", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiButton(
                "Yes, still true",
                onClick = { vm.stillTrue(fact) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = !busy,
            )
            FitaiButton("No, retire it", onClick = {
                vm.retire(fact)
            }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm, enabled = !busy)
        }
    }
}

@Composable
private fun FactEditor(edit: FactEdit, busy: Boolean, vm: AthleteCardViewModel) {
    Boxed {
        FitaiTextField(edit.text, { text -> vm.edit { it.copy(text = text.take(ATHLETE_FACT_MAX_LENGTH)) } }, "Fact", singleLine = false)
        CategoryChips(edit.category, onSelect = { category -> vm.edit { it.copy(category = category) } })
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiButton("Save", onClick = vm::saveEdit, size = ButtonSize.Sm, enabled = edit.text.isNotBlank() && !busy)
            FitaiButton("Cancel", onClick = vm::cancelEdit, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CategoryChips(selected: AthleteFact.Category, onSelect: (AthleteFact.Category) -> Unit, enabled: Boolean = true) {
    Text("Category", style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        ATHLETE_FACT_CATEGORIES.forEach { category ->
            FitaiChip(athleteFactCategoryLabel(category), selected = category == selected, onClick = {
                onSelect(category)
            }, enabled = enabled)
        }
    }
}

@Composable
private fun AddFact(state: AthleteCardState, atCap: Boolean, vm: AthleteCardViewModel) {
    FitaiTextField(
        state.newFact,
        vm::editNew,
        "Add a fact",
        placeholder = "e.g. Bad left knee: no deep lunges",
        supportingText = addFactHint(atCap),
        enabled = !atCap,
        singleLine = false,
    )
    CategoryChips(state.newCategory, onSelect = vm::chooseNewCategory, enabled = !atCap)
    Row(verticalAlignment = Alignment.CenterVertically) {
        FitaiButton(
            "Add",
            onClick = vm::add,
            size = ButtonSize.Sm,
            enabled = state.newFact.isNotBlank() && !atCap && !state.busy,
            leadingIcon = LucideIcons.Plus,
        )
        Text(
            "${state.newFact.length}/$ATHLETE_FACT_MAX_LENGTH",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
            modifier = Modifier.weight(1f).semantics {
                contentDescription = "${state.newFact.length} of $ATHLETE_FACT_MAX_LENGTH characters"
            },
            textAlign = TextAlign.End,
        )
    }
}

/** Facts the athlete said no longer apply: kept listed (so an older note can't bring one back) until deleted. */
@Composable
private fun RetiredFacts(facts: List<AthleteFact>, canRestore: Boolean, busy: Boolean, vm: AthleteCardViewModel) {
    var open by remember { mutableStateOf(false) }
    FitaiButton(
        "Retired (${facts.size})",
        onClick = { open = !open },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = LucideIcons.ChevronDown,
        modifier = Modifier.semantics { stateDescription = if (open) "expanded" else "collapsed" },
    )
    if (!open) return
    Text(
        "Your coach no longer reads these. Restore one if it applies again.",
        style = FitaiTheme.typography.bodySm,
        color = FitaiTheme.colors.textMuted,
    )
    facts.forEach { fact ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(fact.fact, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted, modifier = Modifier.weight(1f))
            FitaiButton(
                "Restore",
                onClick = { vm.restore(fact) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = canRestore,
                modifier = Modifier.semantics { contentDescription = "Restore \"${fact.fact}\"" },
            )
            IconButton(onClick = { vm.ask(AthleteCardConfirm.Delete(fact)) }, enabled = !busy) {
                Icon(LucideIcons.Trash, contentDescription = "Delete \"${fact.fact}\"", tint = FitaiTheme.colors.textMuted)
            }
        }
    }
}

/** The older free-text injuries note: the coach reads it until it is moved onto the card or removed. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LegacyNote(note: String, busy: Boolean, vm: AthleteCardViewModel) {
    Boxed {
        Text(
            "Your older injuries note",
            style = FitaiTheme.typography.label,
            color = FitaiTheme.colors.text,
            modifier = Modifier.semantics { heading() },
        )
        Text(note, style = FitaiTheme.typography.body, color = FitaiTheme.colors.text)
        Text(
            "Your coach still reads this note. Add it to your card to keep each part up to date on its own, " +
                "or remove it if it no longer applies.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiButton("Add to card", onClick = vm::importNote, size = ButtonSize.Sm, enabled = !busy)
            FitaiButton(
                "Remove note",
                onClick = { vm.ask(AthleteCardConfirm.RemoveNote) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = !busy,
            )
        }
    }
}

@Composable
private fun ConfirmStep(step: AthleteCardConfirm, vm: AthleteCardViewModel) {
    when (step) {
        is AthleteCardConfirm.Retire -> FitaiDialog(
            title = "Retire this fact?",
            text = "\"${step.fact.fact}\" will be moved to your retired list. Your coach will no longer read it.",
            confirmLabel = "Retire",
            onConfirm = vm::confirm,
            onDismiss = vm::dismissConfirm,
        )
        is AthleteCardConfirm.Delete -> FitaiDialog(
            title = "Delete forever?",
            text = "\"${step.fact.fact}\" will be permanently deleted. This cannot be undone.",
            confirmLabel = "Delete forever",
            onConfirm = vm::confirm,
            onDismiss = vm::dismissConfirm,
            destructive = true,
        )
        AthleteCardConfirm.RemoveNote -> FitaiDialog(
            title = "Remove your older note?",
            text = "Your coach stops reading it, and nothing from it is added to your card.",
            confirmLabel = "Remove note",
            onConfirm = vm::confirm,
            onDismiss = vm::dismissConfirm,
            dismissLabel = "Keep it",
        )
    }
}
