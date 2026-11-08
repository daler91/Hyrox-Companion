package com.fitai.coach.ui.coach

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import com.fitai.coach.core.api.generated.PlanProposal
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** A plan-change proposal: its changes, and apply / dismiss / undo (PlanProposalCard.tsx). */
@Composable
fun ProposalCard(
    proposal: PlanProposal,
    busy: Boolean,
    onApply: (planDayIds: List<String>?) -> Unit,
    onDismiss: () -> Unit,
    onUndo: () -> Unit,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val pending = proposal.status == PlanProposal.Status.Pending
    var included by remember(proposal.id) { mutableStateOf(proposal.changes.map { it.planDayId }.toSet()) }
    var expanded by remember(proposal.id) { mutableStateOf(pending) }
    FitaiCard {
        Text(proposalHeader(proposal), style = type.h3, color = colors.text)
        if (!pending) {
            TextButton(onClick = { expanded = !expanded }) {
                Text(if (expanded) "Hide the changes" else "Show the changes", color = colors.accent)
            }
        }
        if (expanded) {
            proposal.changes.forEach { change ->
                HorizontalDivider(color = colors.border)
                Change(change, pending && proposal.changes.size > 1, change.planDayId in included) { include ->
                    included = if (include) included + change.planDayId else included - change.planDayId
                }
            }
        }
        if (pending) {
            val all = included.size == proposal.changes.size
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton(
                    if (all) "Apply all changes" else "Apply ${included.size} changes",
                    onClick = { onApply(if (all) null else included.toList()) },
                    enabled = included.isNotEmpty() && !busy,
                    loading = busy,
                )
                FitaiButton("Dismiss", onClick = onDismiss, variant = ButtonVariant.Ghost, enabled = !busy)
            }
        } else if (proposal.status == PlanProposal.Status.Applied && proposal.undoable == true) {
            FitaiButton("Undo", onClick = onUndo, variant = ButtonVariant.Secondary, enabled = !busy, loading = busy)
        }
    }
}

@Composable
private fun Change(change: PlanProposal.ChangesItem, selectable: Boolean, included: Boolean, onInclude: (Boolean) -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    var why by remember(change.planDayId) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text(change.dayLabel, style = type.label, color = colors.text)
            FitaiBadge(changeKindLabel(change.kind), tone = BadgeTone.Neutral)
        }
        changeRows(change).forEach { (label, old, new) ->
            Text("$label: ${old?.let { "$it → " } ?: ""}$new", style = type.bodySm, color = colors.text)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            TextButton(onClick = { why = !why }) { Text("Why?", color = colors.accent) }
            if (selectable) FitaiChip("Include", selected = included, onClick = { onInclude(!included) })
        }
        if (why) Text(change.rationale, style = type.bodySm, color = colors.textMuted)
    }
}
