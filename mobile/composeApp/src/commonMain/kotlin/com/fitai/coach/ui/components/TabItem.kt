package com.fitai.coach.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/** One page of a screen: what selecting it stands for, its name and its icon. */
data class TabItem<T>(val value: T, val label: String, val icon: ImageVector)

/**
 * A screen's pages as a two-column grid (the web's TabsList at phone width).
 * More names than fit one row would otherwise scroll sideways, and a row that
 * scrolls hides most of them. [description] is what a screen reader calls the
 * grid, and what tells its cells from the bottom bar's.
 */
@Composable
fun <T> FitaiTabGrid(tabs: List<TabItem<T>>, selected: T, onSelect: (T) -> Unit, description: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .background(FitaiTheme.colors.muted, Radius.Lg)
            .padding(Spacing.Xs)
            .selectableGroup()
            .semantics { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        tabs.chunked(TAB_COLUMNS).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                row.forEach { tab -> TabCell(tab, tab.value == selected, Modifier.weight(1f)) { onSelect(tab.value) } }
                // An odd tab out keeps its half of the row.
                repeat(TAB_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun <T> TabCell(tab: TabItem<T>, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = FitaiTheme.colors
    val content = if (selected) colors.text else colors.textMuted
    Row(
        modifier
            .heightIn(min = MIN_TOUCH.dp)
            .clip(Radius.Md)
            .background(if (selected) colors.background else Color.Transparent)
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(horizontal = Spacing.Sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.Sm, Alignment.CenterHorizontally),
    ) {
        Icon(tab.icon, contentDescription = null, tint = content, modifier = Modifier.size(16.dp))
        Text(tab.label, style = FitaiTheme.typography.button, color = content, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private const val TAB_COLUMNS = 2
private const val MIN_TOUCH = 48
