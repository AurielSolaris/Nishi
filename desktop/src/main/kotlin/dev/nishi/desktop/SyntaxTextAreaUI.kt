package dev.nishi.desktop

import dev.nishi.editor.Language
import dev.nishi.editor.SyntaxKind
import dev.nishi.editor.SyntaxLexer
import dev.nishi.editor.SyntaxLine
import dev.nishi.editor.SyntaxState
import java.awt.Color
import java.awt.Graphics2D
import javax.swing.JTextArea
import javax.swing.plaf.basic.BasicTextAreaUI
import javax.swing.text.Document
import javax.swing.text.Element
import javax.swing.text.PlainView
import javax.swing.text.Segment
import javax.swing.text.TabExpander
import javax.swing.text.Utilities
import javax.swing.text.View
import javax.swing.text.WrappedPlainView

/** Document-local cache shared by the two editor views and invalidated from the edited line. */
internal class SyntaxHighlighting(private val document: Document, initialLanguage: Language) {
    private val lines = ArrayList<SyntaxLine>()
    private var lexer = SyntaxLexer(initialLanguage)
    var language: Language = initialLanguage
        set(value) {
            if (field != value) {
                field = value
                lexer = SyntaxLexer(value)
                lines.clear()
            }
        }

    fun invalidate(offset: Int) {
        val first = document.defaultRootElement.getElementIndex(offset)
        if (first < lines.size) lines.subList(first, lines.size).clear()
    }

    fun line(index: Int): SyntaxLine {
        val root = document.defaultRootElement
        while (lines.size <= index) {
            val element = root.getElement(lines.size)
            val start = element.startOffset
            val length = minOf(element.endOffset, document.length) - start
            val text = document.getText(start, length).removeSuffix("\n")
            val state = lines.lastOrNull()?.nextState ?: SyntaxState.Initial
            lines.add(lexer.line(text, state))
        }
        return lines[index]
    }
}

internal val syntaxColors = mapOf(
    SyntaxKind.KEYWORD to Color(0xCDB5FF),
    SyntaxKind.STRING to Color(0xA7DBA0),
    SyntaxKind.NUMBER to Color(0xF4BE89),
    SyntaxKind.COMMENT to Color(0x95A6BE),
    SyntaxKind.TYPE to Color(0x8CDFF0),
    SyntaxKind.PROPERTY to Color(0xF3D490),
    SyntaxKind.HEADING to Color(0x9DC8FF),
    SyntaxKind.TAG to Color(0xFFAEBB),
    SyntaxKind.FUNCTION to Color(0xA9BEFF),
    SyntaxKind.VARIABLE to Color(0xB6D8F4),
    SyntaxKind.PARAMETER to Color(0xF3B8D0),
    SyntaxKind.CONSTANT to Color(0xF1C79F),
    SyntaxKind.OPERATOR to Color(0x99C5E9),
    SyntaxKind.PUNCTUATION to Color(0x9FAFC4),
    SyntaxKind.ESCAPE to Color(0xF1CF82),
    SyntaxKind.MARKUP to Color(0xBDD5F9),
    SyntaxKind.INVALID to Color(0xFFA3A3),
)

internal class SyntaxTextAreaUI(private val highlighting: SyntaxHighlighting) : BasicTextAreaUI() {
    override fun create(element: Element): View {
        // Keep Swing's bidi layout and input behavior where it requires its own views.
        if (element.document.getProperty("i18n") == true) return super.create(element)
        val area = component as JTextArea
        return if (area.lineWrap) {
            object : WrappedPlainView(element, area.wrapStyleWord) {
                override fun drawUnselectedText(g: Graphics2D, x: Float, y: Float, p0: Int, p1: Int): Float =
                    drawSyntax(area, highlighting, g, x, y, p0, p1, this)
            }
        } else {
            object : PlainView(element) {
                override fun drawUnselectedText(g: Graphics2D, x: Float, y: Float, p0: Int, p1: Int): Float =
                    drawSyntax(area, highlighting, g, x, y, p0, p1, this)
            }
        }
    }
}

private fun drawSyntax(
    area: JTextArea,
    highlighting: SyntaxHighlighting,
    graphics: Graphics2D,
    x: Float,
    y: Float,
    start: Int,
    end: Int,
    tabs: TabExpander,
): Float {
    val document = area.document
    val limit = minOf(end, document.length)
    if (start >= limit) return x
    val foreground = if (area.isEnabled) area.foreground else area.disabledTextColor
    val segment = Segment()
    var offset = start
    var position = x
    fun draw(to: Int, color: Color) {
        if (to <= offset) return
        graphics.color = color
        document.getText(offset, to - offset, segment)
        position = Utilities.drawTabbedText(segment, position, y, graphics, tabs, offset)
        offset = to
    }

    if (highlighting.language != Language.PLAIN_TEXT && area.isEnabled) {
        val line = document.defaultRootElement.getElementIndex(start)
        val lineStart = document.defaultRootElement.getElement(line).startOffset
        val tokens = highlighting.line(line).tokens
        var low = 0
        var high = tokens.size
        while (low < high) {
            val middle = (low + high) / 2
            if (lineStart + tokens[middle].end <= start) low = middle + 1 else high = middle
        }
        for (index in low until tokens.size) {
            val token = tokens[index]
            val from = lineStart + token.start
            if (from >= limit) break
            draw(from, foreground)
            draw(minOf(lineStart + token.end, limit), syntaxColors.getValue(token.kind))
        }
    }
    draw(limit, foreground)
    return position
}
