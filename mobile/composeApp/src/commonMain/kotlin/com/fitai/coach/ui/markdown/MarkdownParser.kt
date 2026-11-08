package com.fitai.coach.ui.markdown

/*
 * A small Markdown reader for the coach's replies. It understands what the
 * coach writes (headings, paragraphs, lists, quotes, code, emphasis, links)
 * and treats everything else as text. There is no HTML: raw tags render as
 * the characters they are, as the web's rehype-sanitize leaves them inert.
 */

/** A block of a Markdown document. */
sealed interface MdBlock {
    data class Heading(val level: Int, val text: List<MdInline>) : MdBlock

    data class Paragraph(val text: List<MdInline>) : MdBlock

    /** A list; [start] is the first number of an ordered list, null for bullets. */
    data class ListBlock(val start: Int?, val items: List<List<MdInline>>) : MdBlock

    data class Quote(val text: List<MdInline>) : MdBlock

    data class Code(val text: String) : MdBlock

    data object Rule : MdBlock
}

/** A run of inline text. */
sealed interface MdInline {
    data class Text(val text: String) : MdInline

    data class Bold(val children: List<MdInline>) : MdInline

    data class Italic(val children: List<MdInline>) : MdInline

    data class Code(val text: String) : MdInline

    /** A link whose [url] is http(s) or mailto; any other scheme is shown as plain text instead. */
    data class Link(val url: String, val children: List<MdInline>) : MdInline
}

private val HEADING = Regex("^(#{1,6})\\s+(.*)$")
private val BULLET = Regex("^\\s*[-*+]\\s+(.*)$")
private val ORDERED = Regex("^\\s*(\\d{1,9})[.)]\\s+(.*)$")
private val RULE = Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$")
private const val FENCE = "```"
private const val QUOTE_MARK = ">"

/** Reads [markdown] into blocks. */
fun parseMarkdown(markdown: String): List<MdBlock> {
    val lines = markdown.replace("\r\n", "\n").split("\n")
    val blocks = mutableListOf<MdBlock>()
    var index = 0
    while (index < lines.size) {
        val line = lines[index]
        val consumed = when {
            line.isBlank() -> 1
            line.trimStart().startsWith(FENCE) -> readCode(lines, index, blocks)
            RULE.matches(line) -> 1.also { blocks += MdBlock.Rule }
            HEADING.matches(line) -> 1.also { blocks += heading(line) }
            BULLET.matches(line) || ORDERED.matches(line) -> readList(lines, index, blocks)
            line.trimStart().startsWith(QUOTE_MARK) -> readQuote(lines, index, blocks)
            else -> readParagraph(lines, index, blocks)
        }
        index += consumed
    }
    return blocks
}

private fun heading(line: String): MdBlock {
    val match = HEADING.matchEntire(line)!!
    return MdBlock.Heading(match.groupValues[1].length, parseInline(match.groupValues[2].trimEnd('#', ' ')))
}

private fun readCode(lines: List<String>, start: Int, blocks: MutableList<MdBlock>): Int {
    var end = start + 1
    while (end < lines.size && !lines[end].trimStart().startsWith(FENCE)) end++
    blocks += MdBlock.Code(lines.subList(start + 1, end.coerceAtMost(lines.size)).joinToString("\n"))
    // The closing fence, when there is one (a reply still streaming may not have it yet).
    return end - start + if (end < lines.size) 1 else 0
}

private fun readList(lines: List<String>, start: Int, blocks: MutableList<MdBlock>): Int {
    val ordered = ORDERED.matchEntire(lines[start])
    val items = mutableListOf<StringBuilder>()
    var end = start
    while (end < lines.size) {
        val line = lines[end]
        val item = (if (ordered != null) ORDERED.matchEntire(line)?.groupValues?.get(2) else BULLET.matchEntire(line)?.groupValues?.get(1))
        when {
            item != null -> items += StringBuilder(item)
            line.isNotBlank() && line.startsWith(" ") && items.isNotEmpty() -> items.last().append(' ').append(line.trim())
            else -> break
        }
        end++
    }
    blocks += MdBlock.ListBlock(ordered?.groupValues?.get(1)?.toIntOrNull(), items.map { parseInline(it.toString()) })
    return end - start
}

private fun readQuote(lines: List<String>, start: Int, blocks: MutableList<MdBlock>): Int {
    var end = start
    val text = StringBuilder()
    while (end < lines.size && lines[end].trimStart().startsWith(QUOTE_MARK)) {
        if (text.isNotEmpty()) text.append(' ')
        text.append(lines[end].trimStart().removePrefix(QUOTE_MARK).trim())
        end++
    }
    blocks += MdBlock.Quote(parseInline(text.toString()))
    return end - start
}

private fun readParagraph(lines: List<String>, start: Int, blocks: MutableList<MdBlock>): Int {
    var end = start
    val text = StringBuilder()
    while (end < lines.size && startsParagraphLine(lines[end], first = end == start)) {
        if (text.isNotEmpty()) text.append(' ')
        text.append(lines[end].trim())
        end++
    }
    blocks += MdBlock.Paragraph(parseInline(text.toString()))
    return end - start
}

private fun startsParagraphLine(line: String, first: Boolean): Boolean = first ||
    (
        line.isNotBlank() && !HEADING.matches(line) && !BULLET.matches(line) && !ORDERED.matches(line) &&
            !line.trimStart().startsWith(FENCE) && !line.trimStart().startsWith(QUOTE_MARK) && !RULE.matches(line)
        )

/** Reads inline Markdown: `**bold**`, `*italic*`, `` `code` ``, `[text](url)` and bare http(s) links. */
fun parseInline(text: String): List<MdInline> = InlineReader(text).read()

private val SAFE_URL = Regex("^(https?://|mailto:)\\S+$", RegexOption.IGNORE_CASE)
private val BARE_URL = Regex("https?://[^\\s<>()\\[\\]]+[^\\s<>()\\[\\].,;:!?'\"]", RegexOption.IGNORE_CASE)

private class InlineReader(private val text: String) {
    private val out = mutableListOf<MdInline>()
    private val plain = StringBuilder()

    fun read(): List<MdInline> {
        var i = 0
        while (i < text.length) {
            i = readAt(i)
        }
        flushPlain()
        return out
    }

    private fun readAt(i: Int): Int = when {
        text.startsWith("**", i) || text.startsWith("__", i) -> wrapped(i, text.substring(i, i + 2)) { MdInline.Bold(it) }
        text[i] == '*' || text[i] == '_' -> wrapped(i, text[i].toString()) { MdInline.Italic(it) }
        text[i] == '`' -> code(i)
        text[i] == '[' -> link(i)
        text.startsWith("http", i, ignoreCase = true) -> bareLink(i)
        else -> i + 1.also { plain.append(text[i]) }
    }

    private fun wrapped(i: Int, marker: String, make: (List<MdInline>) -> MdInline): Int {
        val close = text.indexOf(marker, i + marker.length)
        // `_` inside a word (snake_case) is not emphasis.
        val intraword = marker[0] == '_' && i > 0 && text[i - 1].isLetterOrDigit()
        if (close <= i + marker.length || intraword || text[i + marker.length].isWhitespace()) {
            plain.append(marker)
            return i + marker.length
        }
        flushPlain()
        out += make(InlineReader(text.substring(i + marker.length, close)).read())
        return close + marker.length
    }

    private fun code(i: Int): Int {
        val close = text.indexOf('`', i + 1)
        if (close < 0) {
            plain.append('`')
            return i + 1
        }
        flushPlain()
        out += MdInline.Code(text.substring(i + 1, close))
        return close + 1
    }

    private fun link(i: Int): Int {
        val labelEnd = text.indexOf("](", i + 1)
        val urlEnd = if (labelEnd < 0) -1 else text.indexOf(')', labelEnd + 2)
        if (labelEnd < 0 || urlEnd < 0) {
            plain.append('[')
            return i + 1
        }
        val label = text.substring(i + 1, labelEnd)
        val url = text.substring(labelEnd + 2, urlEnd).trim()
        flushPlain()
        val children = InlineReader(label).read()
        if (SAFE_URL.matches(url)) out += MdInline.Link(url, children) else out += children
        return urlEnd + 1
    }

    private fun bareLink(i: Int): Int {
        val match = BARE_URL.matchAt(text, i)
        if (match == null) {
            plain.append(text[i])
            return i + 1
        }
        flushPlain()
        out += MdInline.Link(match.value, listOf(MdInline.Text(match.value)))
        return match.range.last + 1
    }

    private fun flushPlain() {
        if (plain.isNotEmpty()) {
            out += MdInline.Text(plain.toString())
            plain.clear()
        }
    }
}
