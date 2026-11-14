package com.fitai.coach.ui.workout

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import com.fitai.coach.core.api.generated.WorkoutStructureBlock
import com.fitai.coach.core.api.generated.WorkoutStructureBlock.FormatType
import com.fitai.coach.core.structure.BlockScore
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiSwitchRow
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** The workout's blocks in the order they were done. */
fun orderedBlocks(blocks: List<WorkoutStructureBlock>): List<WorkoutStructureBlock> =
    blocks.sortedWith(compareBy<WorkoutStructureBlock>({ it.sequenceOrder }, { it.sortOrder }))

/**
 * One structure block (an EMOM, AMRAP, rounds...): its format, setup and
 * steps, and for the formats that take one, the result recorded for it.
 */
@Composable
fun StructureBlockCard(block: WorkoutStructureBlock, index: Int, weightUnit: String?, busy: Boolean, onRecord: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiBadge(blockFormatLabel(block.formatType), tone = BadgeTone.Accent)
                Text(
                    listOfNotNull("Block ${index + 1}", blockSectionLabel(block.sectionType)).joinToString(" · "),
                    style = type.label,
                    color = colors.text,
                )
            }
            listOfNotNull(blockFormatName(block.formatType), blockSetup(block)).joinToString(" · ").takeIf { it.isNotEmpty() }?.let {
                Text(it, style = type.bodySm, color = colors.textMuted)
            }
            block.instructions?.takeIf { it.isNotBlank() }?.let { Text(it, style = type.bodySm, color = colors.text) }
            block.steps.sortedBy { it.stepNumber }.forEach { step ->
                Text("• ${stepLine(step, block.formatType, weightUnit)}", style = type.bodySm, color = colors.text)
            }
            if (takesResult(block.formatType)) BlockResultRow(BlockScore.of(block.score), busy, onRecord)
        }
    }
}

@Composable
private fun BlockResultRow(score: BlockScore?, busy: Boolean, onRecord: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Row(Modifier.padding(top = Spacing.Xs), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Result", style = type.label, color = colors.textMuted)
            Text(
                score?.let(::scoreSummary) ?: "Not recorded yet",
                style = type.body,
                color = if (score !=
                    null
                ) {
                    colors.text
                } else {
                    colors.textMuted
                },
            )
            score?.notes?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
        }
        FitaiButton(
            if (score != null) "Edit result" else "Record result",
            onClick = onRecord,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            enabled = !busy,
        )
    }
}

/**
 * The result sheet for the block [blockId] names, numbered as the workout
 * shows it; nothing when the block is gone. [onScore] with null clears it.
 */
@Composable
fun BlockResultSheetFor(
    blocks: List<WorkoutStructureBlock>,
    blockId: String,
    saving: Boolean,
    onScore: (blockId: String, score: BlockScore?) -> Unit,
    onDismiss: () -> Unit,
) {
    val ordered = orderedBlocks(blocks)
    val index = ordered.indexOfFirst { it.id == blockId }
    val block = ordered.getOrNull(index) ?: return
    BlockResultSheet(
        block = block,
        index = index,
        saving = saving,
        onSave = { onScore(block.id, it) },
        onClear = if (BlockScore.of(block.score) != null) ({ onScore(block.id, null) }) else null,
        onDismiss = onDismiss,
    )
}

/**
 * "How did it go?" for a block (ResultControls): an EMOM's finish, minutes
 * and missed reps; an AMRAP's rounds and extra reps; a rounds block's rounds
 * and time. [onClear] is there when it already has a result.
 */
@Composable
fun BlockResultSheet(
    block: WorkoutStructureBlock,
    index: Int,
    saving: Boolean,
    onSave: (BlockScore) -> Unit,
    onClear: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    var form by remember { mutableStateOf(BlockResultForm.of(block.formatType, BlockScore.of(block.score))) }
    var error by remember { mutableStateOf<String?>(null) }
    val (one, two) = resultFields(block.formatType)
    val number = KeyboardOptions(keyboardType = KeyboardType.Number)
    val edit = { next: BlockResultForm ->
        form = next
        error = null
    }
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = Spacing.Lg).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.Md),
        ) {
            Text("How did it go?", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
            Text(
                "${blockFormatLabel(block.formatType)} · Block ${index + 1}. Fill this in after the workout to record your result.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            if (block.formatType == FormatType.Emom) {
                FitaiSwitchRow("Finished it", form.completed, { edit(form.copy(completed = it)) })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                FitaiTextField(
                    form.first,
                    { edit(form.copy(first = it)) },
                    one.label,
                    Modifier.weight(1f),
                    placeholder = one.placeholder,
                    keyboardOptions = number,
                )
                FitaiTextField(
                    form.second,
                    { edit(form.copy(second = it)) },
                    two.label,
                    Modifier.weight(1f),
                    placeholder = two.placeholder,
                    keyboardOptions = number,
                )
            }
            FitaiTextField(form.notes, { edit(form.copy(notes = it)) }, "Notes", placeholder = "Result notes", singleLine = false)
            error?.let {
                Text(
                    it,
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.danger,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            FitaiButton(
                "Save result",
                onClick = {
                    error = form.error()
                    if (error == null) onSave(form.score())
                },
                enabled = !saving,
                loading = saving,
                modifier = Modifier.fillMaxWidth(),
            )
            onClear?.let {
                FitaiButton(
                    "Clear result",
                    onClick = it,
                    variant = ButtonVariant.Ghost,
                    enabled = !saving,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
