package dev.nishi.desktop

import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Graphics
import java.awt.event.ActionEvent
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.util.regex.Matcher
import java.util.regex.Pattern
import javax.swing.AbstractAction
import javax.swing.BorderFactory
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JTextField
import javax.swing.KeyStroke
import javax.swing.SwingConstants
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener

internal class FindBar(private val activeTab: () -> EditorTab?) : JPanel() {
    private val query = field("Find")
    private val replacement = field("Replace")
    private val summary = Night.label("", 11).apply {
        horizontalAlignment = SwingConstants.RIGHT
        preferredSize = Dimension(84, 24)
    }
    private val replaceRow = JPanel(BorderLayout(6, 0)).apply { isOpaque = false }
    private val expand = IconButton("chevron-right", "Show replace", 22) { toggleReplace(!replaceRow.isVisible) }
    private val matchCase = option("case-sensitive", "Match case")
    private val wholeWord = option("whole-word", "Whole word")
    private val regex = option("regex", "Regular expression")

    init {
        layout = javax.swing.BoxLayout(this, javax.swing.BoxLayout.Y_AXIS)
        background = Night.panel
        border = BorderFactory.createCompoundBorder(
            BorderFactory.createMatteBorder(1, 0, 0, 0, Night.border),
            BorderFactory.createEmptyBorder(6, 10, 6, 10),
        )
        add(JPanel(BorderLayout(6, 0)).apply {
            isOpaque = false
            add(expand, BorderLayout.WEST)
            add(query, BorderLayout.CENTER)
            add(JPanel(FlowLayout(FlowLayout.RIGHT, 2, 0)).apply {
                isOpaque = false
                add(matchCase)
                add(wholeWord)
                add(regex)
                add(summary)
                add(IconButton("arrow-up", "Previous match") { move(previous = true) })
                add(IconButton("arrow-down", "Next match") { move(previous = false) })
                add(IconButton("x", "Close find bar") { close() })
            }, BorderLayout.EAST)
        })
        replaceRow.add(JPanel().apply {
            isOpaque = false
            preferredSize = Dimension(22, 24)
        }, BorderLayout.WEST)
        replaceRow.add(replacement, BorderLayout.CENTER)
        replaceRow.add(JPanel(FlowLayout(FlowLayout.RIGHT, 6, 0)).apply {
            isOpaque = false
            add(actionButton("Replace") { replace(all = false) })
            add(actionButton("Replace all") { replace(all = true) })
        }, BorderLayout.EAST)
        add(replaceRow)
        replaceRow.isVisible = false
        replaceRow.border = BorderFactory.createEmptyBorder(6, 0, 0, 0)
        isVisible = false

        query.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(event: DocumentEvent) = refresh()
            override fun removeUpdate(event: DocumentEvent) = refresh()
            override fun changedUpdate(event: DocumentEvent) = refresh()
        })
        query.addActionListener { move(previous = false) }
        replacement.addActionListener { replace(all = false) }
        bind(query, "shift ENTER", "previous-match") { move(previous = true) }
        bind(this, "ESCAPE", "close-find") { close() }
    }

    fun open(withReplace: Boolean = false) {
        isVisible = true
        toggleReplace(withReplace)
        activeTab()?.activeArea?.selectedText?.takeIf { '\n' !in it }?.let { query.text = it }
        query.requestFocusInWindow()
        query.selectAll()
        refresh()
    }

    private fun close() {
        isVisible = false
        activeTab()?.activeArea?.requestFocusInWindow()
    }

    private fun toggleReplace(show: Boolean) {
        replaceRow.isVisible = show
        expand.icon = WorkbenchIcons.glyph(if (show) "chevron-down" else "chevron-right", 15)
        expand.toolTipText = if (show) "Hide replace" else "Show replace"
        expand.accessibleContext.accessibleName = expand.toolTipText
        revalidate()
    }

    fun refresh() {
        if (!isVisible) return
        val area = activeTab()?.activeArea
        val matches = matches(area?.text.orEmpty()) ?: return
        val current = if (area == null) -1 else matches.indexOfFirst {
            it.first == area.selectionStart && it.last + 1 == area.selectionEnd
        }
        summary.text = when {
            query.text.isEmpty() -> ""
            matches.isEmpty() -> "No results"
            current >= 0 -> "${current + 1} of ${matches.size}"
            matches.size == 1 -> "1 match"
            else -> "${matches.size} matches"
        }
    }

    private fun move(previous: Boolean) {
        val area = activeTab()?.activeArea ?: return
        val matches = matches(area.text) ?: return
        val match = if (previous) {
            matches.lastOrNull { it.first < area.selectionStart } ?: matches.lastOrNull()
        } else {
            matches.firstOrNull { it.first >= area.selectionEnd } ?: matches.firstOrNull()
        } ?: return
        area.select(match.first, match.last + 1)
        area.caret.isSelectionVisible = true
        refresh()
    }

    private fun replace(all: Boolean) {
        val tab = activeTab() ?: return
        val area = tab.activeArea
        val pattern = pattern() ?: return
        val text = area.text
        val matcher = pattern.matcher(text)
        val value = if (regex.isSelected) replacement.text else Matcher.quoteReplacement(replacement.text)
        try {
            val result = StringBuilder()
            if (all) {
                var changed = false
                while (matcher.find()) {
                    if (matcher.start() == matcher.end()) continue
                    matcher.appendReplacement(result, value)
                    changed = true
                }
                if (changed) tab.replaceRange(0, text.length, matcher.appendTail(result).toString())
            } else {
                val from = area.selectionStart
                val to = area.selectionEnd
                while (matcher.find()) {
                    if (matcher.start() != from || matcher.end() != to || from == to) continue
                    matcher.appendReplacement(result, value)
                    val inserted = result.substring(from)
                    tab.replaceRange(from, to, inserted)
                    area.caretPosition = from + inserted.length
                    break
                }
                move(previous = false)
            }
            refresh()
        } catch (_: IllegalArgumentException) {
            summary.text = "Invalid replacement"
        } catch (_: IndexOutOfBoundsException) {
            summary.text = "Invalid replacement"
        }
    }

    private fun matches(text: String): List<IntRange>? {
        if (query.text.isEmpty()) return emptyList()
        val matcher = pattern()?.matcher(text) ?: return null
        val matches = mutableListOf<IntRange>()
        while (matcher.find() && matches.size < 5000) {
            if (matcher.start() != matcher.end()) matches.add(matcher.start() until matcher.end())
        }
        return matches
    }

    private fun pattern(): Pattern? {
        val value = query.text
        if (value.isEmpty()) return null
        val expression = if (regex.isSelected) value else Pattern.quote(value)
        val source = if (wholeWord.isSelected) "\\b(?:$expression)\\b" else expression
        val flags = if (matchCase.isSelected) 0 else Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE
        return try {
            Pattern.compile(source, flags)
        } catch (_: java.util.regex.PatternSyntaxException) {
            summary.text = "Invalid regex"
            null
        }
    }

    private fun option(icon: String, label: String): IconButton {
        val button = IconButton(icon, label) {}
        button.addActionListener {
            button.isSelected = !button.isSelected
            refresh()
        }
        return button
    }

    private fun field(label: String) = object : JTextField() {
        init {
            font = Night.ui(12)
            foreground = Night.text
            background = Night.chrome
            caretColor = Night.bright
            selectionColor = Night.selection
            toolTipText = label
            getAccessibleContext().accessibleName = label
            preferredSize = Dimension(80, 26)
            updateBorder()
            addFocusListener(object : FocusAdapter() {
                override fun focusGained(event: FocusEvent) = updateBorder()
                override fun focusLost(event: FocusEvent) = updateBorder()
            })
        }

        private fun updateBorder() {
            setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(if (hasFocus()) Night.accent else Night.border),
                BorderFactory.createEmptyBorder(0, 8, 0, 8),
            ))
        }

        override fun paintComponent(graphics: Graphics) {
            super.paintComponent(graphics)
            if (text.isEmpty()) {
                graphics.color = Night.muted
                graphics.font = font
                val metrics = graphics.fontMetrics
                graphics.drawString(label, insets.left, (height - metrics.height) / 2 + metrics.ascent)
            }
        }
    }

    private fun actionButton(label: String, action: () -> Unit) = JButton(label).apply {
        font = Night.ui(12)
        background = Night.chrome
        foreground = Night.text
        border = BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(Night.border),
            BorderFactory.createEmptyBorder(4, 10, 4, 10),
        )
        addActionListener { action() }
    }

    private fun bind(component: JComponent, keys: String, name: String, action: () -> Unit) {
        component.getInputMap(JComponent.WHEN_ANCESTOR_OF_FOCUSED_COMPONENT).put(KeyStroke.getKeyStroke(keys), name)
        component.actionMap.put(name, object : AbstractAction() {
            override fun actionPerformed(event: ActionEvent) = action()
        })
    }
}
