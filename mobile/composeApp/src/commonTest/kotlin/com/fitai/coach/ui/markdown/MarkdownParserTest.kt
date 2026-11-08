package com.fitai.coach.ui.markdown

import kotlin.test.Test
import kotlin.test.assertEquals

class MarkdownParserTest {
    private fun text(s: String) = MdInline.Text(s)

    @Test
    fun readsHeadingsParagraphsAndLists() {
        val blocks = parseMarkdown(
            """
            ## This week
            You hit **4 of 5** sessions.
            Keep it up.

            - easy run
            - sled push
              with a long note
            1. first
            2. second
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                MdBlock.Heading(2, listOf(text("This week"))),
                MdBlock.Paragraph(listOf(text("You hit "), MdInline.Bold(listOf(text("4 of 5"))), text(" sessions. Keep it up."))),
                MdBlock.ListBlock(null, listOf(listOf(text("easy run")), listOf(text("sled push with a long note")))),
                MdBlock.ListBlock(1, listOf(listOf(text("first")), listOf(text("second")))),
            ),
            blocks,
        )
    }

    @Test
    fun readsInlineCodeItalicAndLinks() {
        assertEquals(
            listOf(
                MdInline.Italic(listOf(text("easy"))),
                text(" pace, "),
                MdInline.Code("Z2"),
                text(", see "),
                MdInline.Link("https://fitai.coach/help", listOf(text("help"))),
            ),
            parseInline("*easy* pace, `Z2`, see [help](https://fitai.coach/help)"),
        )
    }

    @Test
    fun onlyHttpAndMailtoLinksAreClickable() {
        assertEquals(listOf(text("click")), parseInline("[click](javascript:alert(1))").filterIsInstance<MdInline.Text>().take(1))
        assertEquals(
            listOf(text("go to "), MdInline.Link("https://example.com/a", listOf(text("https://example.com/a"))), text(".")),
            parseInline("go to https://example.com/a."),
        )
    }

    @Test
    fun underscoresInsideWordsAndUnclosedMarkersStayText() {
        assertEquals(listOf(text("snake_case and 2 * 3")), parseInline("snake_case and 2 * 3"))
    }

    @Test
    fun htmlIsJustText() {
        assertEquals(listOf(MdBlock.Paragraph(listOf(text("<b>hi</b>")))), parseMarkdown("<b>hi</b>"))
    }

    @Test
    fun anUnclosedCodeFenceWhileStreamingStillRenders() {
        assertEquals(listOf(MdBlock.Code("line one")), parseMarkdown("```\nline one"))
    }
}
