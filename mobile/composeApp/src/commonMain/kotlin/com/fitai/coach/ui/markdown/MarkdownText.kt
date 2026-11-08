package com.fitai.coach.ui.markdown

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/**
 * Renders the coach's Markdown. Links open through the platform's URI
 * handler; only http(s) and mailto links are ever made clickable.
 */
@Composable
fun MarkdownText(markdown: String, modifier: Modifier = Modifier) {
    val blocks = remember(markdown) { parseMarkdown(markdown) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        blocks.forEach { Block(it) }
    }
}

@Composable
private fun Block(block: MdBlock) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    when (block) {
        is MdBlock.Heading -> Text(
            inlineText(block.text),
            style = if (block.level <= 2) type.h3 else type.body.copy(fontWeight = FontWeight.SemiBold),
            color = colors.text,
        )
        is MdBlock.Paragraph -> Text(inlineText(block.text), style = type.body, color = colors.text)
        is MdBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            block.items.forEachIndexed { index, item ->
                Row {
                    val marker = block.start?.let { "${it + index}." } ?: "•"
                    Text(marker, style = type.body, color = colors.textMuted, modifier = Modifier.width(24.dp))
                    Text(inlineText(item), style = type.body, color = colors.text)
                }
            }
        }
        is MdBlock.Quote -> Row {
            Box(Modifier.width(3.dp).padding(vertical = 2.dp).background(colors.borderStrong))
            Text(inlineText(block.text), style = type.body, color = colors.textMuted, modifier = Modifier.padding(start = Spacing.Sm))
        }
        is MdBlock.Code -> Text(
            block.text,
            style = type.mono,
            color = colors.text,
            modifier = Modifier.fillMaxWidth().background(colors.muted, Radius.Sm).padding(Spacing.Sm),
        )
        MdBlock.Rule -> HorizontalDivider(color = colors.border)
    }
}

@Composable
private fun inlineText(runs: List<MdInline>): AnnotatedString {
    val colors = FitaiTheme.colors
    val mono = FitaiTheme.typography.mono
    val linkStyles = TextLinkStyles(SpanStyle(color = colors.accentText, textDecoration = TextDecoration.Underline))
    return remember(runs, colors) {
        buildAnnotatedString {
            fun append(run: MdInline) {
                when (run) {
                    is MdInline.Text -> append(run.text)
                    is MdInline.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { run.children.forEach(::append) }
                    is MdInline.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { run.children.forEach(::append) }
                    is MdInline.Code -> withStyle(SpanStyle(fontFamily = mono.fontFamily, background = colors.muted)) { append(run.text) }
                    is MdInline.Link -> withLink(LinkAnnotation.Url(run.url, linkStyles)) { run.children.forEach(::append) }
                }
            }
            runs.forEach(::append)
        }
    }
}
