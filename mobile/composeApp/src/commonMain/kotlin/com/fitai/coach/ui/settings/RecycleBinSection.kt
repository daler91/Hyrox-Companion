package com.fitai.coach.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fitai.coach.core.api.generated.RecycleBinItem
import com.fitai.coach.core.dates.todayIn
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.session.LocalUserSession
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private const val DESCRIPTION =
    "Deleted workouts, plan days and training plans are kept for 90 days. Restore puts them back exactly as they were."

/**
 * Settings → Recycle bin: the card, and the bin itself in a sheet. The
 * durable way back for a deleted workout, plan day or training plan (a
 * delete's Undo is the quick one).
 */
@Composable
fun RecycleBinSection(toasts: SnackbarHostState) {
    val session = LocalUserSession.current
    val vm = viewModel(key = "recycle-bin-${session.userId}") { RecycleBinViewModel(session, ::todayIn) }
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(vm) { vm.messages.collect { toasts.showSnackbar(it) } }

    Section("Recycle bin") {
        Text(DESCRIPTION, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        val label = if (state.total > 0) "Open recycle bin (${itemCount(state.total)})" else "Open recycle bin"
        FitaiButton(label, onClick = vm::open, variant = ButtonVariant.Secondary, leadingIcon = LucideIcons.Trash)
    }
    if (state.open) RecycleBinSheet(state, vm)
    state.confirm?.let { ConfirmStep(it, state.total, vm) }
}

@Composable
private fun RecycleBinSheet(state: RecycleBinState, vm: RecycleBinViewModel) {
    FitaiBottomSheet(onDismissRequest = vm::close) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.Lg).padding(bottom = Spacing.Lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Recycle bin",
                    style = FitaiTheme.typography.h3,
                    color = FitaiTheme.colors.text,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                FitaiButton(
                    "Empty bin",
                    onClick = { vm.ask(RecycleBinConfirm.Empty) },
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    enabled = state.total > 0 && state.busy == null,
                )
            }
            Text(DESCRIPTION, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
            val bin = state.bin
            when {
                bin == null && state.loadFailed -> LoadFailed(vm::refresh)
                bin == null -> Muted("Loading the recycle bin…")
                bin.items.isEmpty() -> Muted("Nothing in the bin. Deleted workouts, plan days and training plans will show up here.")
                else -> LazyColumn {
                    items(bin.items, key = { it.id }) { item -> ItemRow(item, state, vm) }
                }
            }
        }
    }
}

@Composable
private fun ItemRow(item: RecycleBinItem, state: RecycleBinState, vm: RecycleBinViewModel) {
    val colors = FitaiTheme.colors
    val restoring = state.busy == item.id
    Column(Modifier.fillMaxWidth().padding(vertical = Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Icon(typeIcon(item.entityType), contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(16.dp))
            Text(
                item.label,
                style = FitaiTheme.typography.label,
                color = colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            FitaiBadge(recycleBinTypeLabel(item.entityType))
        }
        item.summary?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = FitaiTheme.typography.bodySm, color = colors.textMuted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Muted(recycleBinMeta(item, state.today, state.timeZone))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            FitaiButton(
                if (restoring) "Restoring…" else "Restore",
                onClick = { vm.restore(item) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = state.busy == null,
                loading = restoring,
                leadingIcon = LucideIcons.RotateCcw,
                modifier = Modifier.semantics { contentDescription = "Restore ${item.label}" },
            )
            IconButton(onClick = { vm.ask(RecycleBinConfirm.Purge(item)) }, enabled = state.busy == null) {
                Icon(LucideIcons.Trash, contentDescription = "Delete ${item.label} forever", tint = colors.textMuted)
            }
        }
        HorizontalDivider(color = colors.border)
    }
}

private fun typeIcon(type: RecycleBinItem.EntityType): ImageVector = when (type) {
    RecycleBinItem.EntityType.WorkoutLog -> LucideIcons.Dumbbell
    RecycleBinItem.EntityType.PlanDay -> LucideIcons.CalendarDays
    RecycleBinItem.EntityType.TrainingPlan, RecycleBinItem.EntityType.Unknown -> LucideIcons.ClipboardList
}

@Composable
private fun LoadFailed(retry: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Text(
            "Couldn't load the recycle bin right now.",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
            modifier = Modifier.weight(1f),
        )
        FitaiButton("Try again", onClick = retry, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)

@Composable
private fun ConfirmStep(step: RecycleBinConfirm, total: Long, vm: RecycleBinViewModel) {
    when (step) {
        is RecycleBinConfirm.Purge -> FitaiDialog(
            title = "Delete forever?",
            text = "\"${step.item.label}\" will be permanently deleted. This cannot be undone.",
            confirmLabel = "Delete forever",
            onConfirm = vm::confirm,
            onDismiss = vm::dismissConfirm,
            destructive = true,
        )
        RecycleBinConfirm.Empty -> FitaiDialog(
            title = "Empty the recycle bin?",
            text = "${itemCount(total)} will be permanently deleted. This cannot be undone.",
            confirmLabel = "Empty bin",
            onConfirm = vm::confirm,
            onDismiss = vm::dismissConfirm,
            destructive = true,
        )
    }
}
