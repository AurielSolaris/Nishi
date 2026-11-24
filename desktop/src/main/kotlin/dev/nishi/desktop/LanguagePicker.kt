package dev.nishi.desktop

import dev.nishi.editor.Language
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.event.ActionEvent
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.AbstractAction
import javax.swing.BorderFactory
import javax.swing.DefaultListModel
import javax.swing.JComponent
import javax.swing.JLayeredPane
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.JTextField
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener

internal class LanguagePicker(
    private val onChoose: (Language?) -> Unit,
    private val onDismiss: () -> Unit,
) : JPanel(BorderLayout(0, 6)) {
    private data class Choice(val language: Language?) {
        val label: String get() = language?.label ?: "Auto Detect"
        override fun toString() = label
    }

    private val choices = listOf(Choice(null)) + Language.entries.sortedBy { it.label }.map(::Choice)
    private val model = DefaultListModel<Choice>()
    private val results = JList(model).apply {
        name = "language-options"
        font = Night.ui(13)
        background = Night.panel
        foreground = Night.text
        selectionBackground = Night.selection
        selectionForeground = Night.bright
        fixedCellHeight = 26
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        getAccessibleContext().accessibleName = "Supported languages"
    }
    private val query = JTextField().apply {
        name = "language-filter"
        font = Night.ui(13)
        background = Night.editor
        foreground = Night.bright
        caretColor = Night.bright
        border = BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(Night.accent),
            BorderFactory.createEmptyBorder(4, 8, 4, 8),
        )
        getAccessibleContext().accessibleName = "Search supported languages"
    }
    private val empty = Night.label("No matching languages", 12, Night.text).apply {
        border = BorderFactory.createEmptyBorder(5, 6, 5, 6)
    }
    private val heading = Night.label("Select Language Mode", 13, Night.bright, bold = true)
    private val scroll = workbenchScroll(results, Night.panel)
    private val content = JPanel(BorderLayout())

    init {
        name = "language-picker"
        isVisible = false
        background = Night.panel
        border = BorderFactory.createCompoundBorder(
            BorderFactory.createLineBorder(Night.border),
            BorderFactory.createEmptyBorder(9, 10, 9, 10),
        )
        add(JPanel(BorderLayout(0, 6)).apply {
            isOpaque = false
            heading.labelFor = query
            add(heading, BorderLayout.NORTH)
            add(query, BorderLayout.CENTER)
        }, BorderLayout.NORTH)
        content.background = Night.panel
        content.add(scroll, BorderLayout.CENTER)
        content.add(empty, BorderLayout.SOUTH)
        add(content, BorderLayout.CENTER)

        query.document.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(event: DocumentEvent) = filter()
            override fun removeUpdate(event: DocumentEvent) = filter()
            override fun changedUpdate(event: DocumentEvent) = filter()
        })
        query.addActionListener { accept() }
        bind(query, "UP", "language-up") { move(-1) }
        bind(query, "DOWN", "language-down") { move(1) }
        bind(results, "ENTER", "language-accept", ::accept)
        bind(query, "ESCAPE", "language-cancel", ::cancel)
        bind(results, "ESCAPE", "language-cancel", ::cancel)
        results.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                if (!SwingUtilities.isLeftMouseButton(event)) return
                val index = results.locationToIndex(event.point)
                if (index >= 0 && results.getCellBounds(index, index).contains(event.point)) {
                    results.selectedIndex = index
                    accept()
                }
            }
        })
        val focus = object : FocusAdapter() {
            override fun focusLost(event: FocusEvent) {
                val next = event.oppositeComponent
                if (next != null && !SwingUtilities.isDescendingFrom(next, this@LanguagePicker)) dismiss()
            }
        }
        query.addFocusListener(focus)
        results.addFocusListener(focus)
    }

    fun over(editor: JComponent) = object : JLayeredPane() {
        override fun doLayout() {
            editor.setBounds(0, 0, width, height)
            val pickerWidth = minOf(440, (width - 24).coerceAtLeast(0))
            val pickerHeight = minOf(preferredPickerHeight(), (height - 20).coerceAtLeast(0))
            this@LanguagePicker.setBounds((width - pickerWidth) / 2, 10, pickerWidth, pickerHeight)
        }
    }.apply {
        add(editor)
        add(this@LanguagePicker)
        setLayer(this@LanguagePicker, JLayeredPane.PALETTE_LAYER)
    }

    fun open(language: Language, override: Language?) {
        heading.text = "Select Language Mode · ${language.label}"
        query.text = ""
        filter(override)
        isVisible = true
        parent?.doLayout()
        revalidate()
        query.requestFocusInWindow()
    }

    fun dismiss() {
        isVisible = false
    }

    private fun filter(selected: Language? = results.selectedValue?.language) {
        val matches = choices.filter { it.label.contains(query.text.trim(), ignoreCase = true) }
        model.clear()
        model.addAll(matches)
        scroll.isVisible = matches.isNotEmpty()
        empty.isVisible = matches.isEmpty()
        if (matches.isNotEmpty()) {
            results.selectedIndex = matches.indexOfFirst { it.language == selected }.coerceAtLeast(0)
            results.ensureIndexIsVisible(results.selectedIndex)
        }
        parent?.doLayout()
        revalidate()
    }

    private fun preferredPickerHeight(): Int {
        val rows = model.size().coerceIn(1, 9)
        return 82 + rows * results.fixedCellHeight
    }

    private fun move(delta: Int) {
        if (model.isEmpty) return
        results.selectedIndex = (results.selectedIndex + delta).coerceIn(0, model.size() - 1)
        results.ensureIndexIsVisible(results.selectedIndex)
    }

    private fun accept() {
        val selected = results.selectedValue ?: return
        dismiss()
        onChoose(selected.language)
        onDismiss()
    }

    private fun cancel() {
        dismiss()
        onDismiss()
    }

    private fun bind(component: JComponent, keys: String, name: String, action: () -> Unit) {
        component.inputMap.put(KeyStroke.getKeyStroke(keys), name)
        component.actionMap.put(name, object : AbstractAction() {
            override fun actionPerformed(event: ActionEvent) = action()
        })
    }
}
