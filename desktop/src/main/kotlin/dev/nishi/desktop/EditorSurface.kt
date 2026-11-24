package dev.nishi.desktop

import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Point
import java.awt.RenderingHints
import javax.swing.JComponent
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.text.Document

internal data class EditorAppearance(
    val fontSize: Int = 13,
    val tabSize: Int = 2,
    val lineNumbers: Boolean = true,
    val highlightCurrentLine: Boolean = true,
    val wordWrap: Boolean = false,
)

internal class EditorSurface(document: Document) : JTextArea(document) {
    private var highlightCurrentLine = true
    private val numbers = LineNumbers()
    val scroll: JScrollPane = workbenchScroll(this).apply {
        setRowHeaderView(numbers)
        rowHeader.background = Night.editor
    }

    init {
        isOpaque = false
        foreground = Night.text
        caretColor = Night.bright
        selectionColor = Night.selection
        selectedTextColor = Night.bright
        border = javax.swing.BorderFactory.createEmptyBorder(10, 16, 10, 16)
        getAccessibleContext().accessibleName = "Editor"
        addCaretListener {
            repaint()
            numbers.repaint()
        }
        applyAppearance(EditorAppearance())
    }

    fun applyAppearance(appearance: EditorAppearance) {
        font = Night.mono(appearance.fontSize)
        tabSize = appearance.tabSize
        lineWrap = appearance.wordWrap
        wrapStyleWord = appearance.wordWrap
        highlightCurrentLine = appearance.highlightCurrentLine
        scroll.rowHeader.isVisible = appearance.lineNumbers
        scroll.revalidate()
        editorChanged()
    }

    fun editorChanged() {
        numbers.revalidate()
        numbers.repaint()
        repaint()
    }

    override fun paintComponent(graphics: Graphics) {
        val g = graphics.create() as Graphics2D
        val clip = g.clipBounds
        g.color = Night.editor
        g.fillRect(clip.x, clip.y, clip.width, clip.height)
        if (highlightCurrentLine) {
            modelToView2D(caretPosition)?.bounds?.let { row ->
                g.color = Night.currentLine
                g.fillRect(0, row.y, width, row.height)
            }
        }
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
        super.paintComponent(g)
        g.dispose()
    }

    private inner class LineNumbers : JComponent() {
        override fun getPreferredSize(): Dimension {
            val editor = this@EditorSurface
            val digits = editor.lineCount.toString().length
            return Dimension(25 + editor.getFontMetrics(editor.font).charWidth('0') * digits, editor.preferredSize.height)
        }

        override fun paintComponent(graphics: Graphics) {
            val editor = this@EditorSurface
            val clip = graphics.clipBounds
            val g = graphics.create() as Graphics2D
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
            g.color = Night.editor
            g.fillRect(clip.x, clip.y, clip.width, clip.height)
            g.color = Night.border
            g.drawLine(width - 1, clip.y, width - 1, clip.y + clip.height)
            g.font = editor.font
            val metrics = g.fontMetrics
            val first = editor.getLineOfOffset(editor.viewToModel2D(Point(editor.insets.left, clip.y)).coerceAtLeast(0))
            val current = editor.getLineOfOffset(editor.caretPosition)
            for (line in first until editor.lineCount) {
                val row = editor.modelToView2D(editor.getLineStartOffset(line))?.bounds ?: break
                if (row.y >= clip.y + clip.height) break
                val label = (line + 1).toString()
                g.color = if (line == current) Night.accent else Night.muted
                g.drawString(label, width - 11 - metrics.stringWidth(label), row.y + metrics.ascent)
            }
            g.dispose()
        }
    }
}
