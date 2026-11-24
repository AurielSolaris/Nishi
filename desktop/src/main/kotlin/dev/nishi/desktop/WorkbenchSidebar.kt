package dev.nishi.desktop

import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.GridLayout
import java.awt.RenderingHints
import java.util.Locale
import javax.swing.BorderFactory
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.Icon
import javax.swing.JPanel
import javax.swing.JSpinner
import javax.swing.SpinnerNumberModel
import javax.swing.plaf.basic.BasicSpinnerUI

internal class WorkbenchSidebar(
    explorer: WorkspaceExplorer,
    chooseFolder: () -> Unit,
    newBuffer: () -> Unit,
    refresh: () -> Unit,
    find: () -> Unit,
    applyAppearance: (EditorAppearance) -> Unit,
) : JPanel(BorderLayout()) {
    private val cards = CardLayout()
    private val sidebar = JPanel(cards).apply {
        preferredSize = Dimension(Night.sidebarWidth, 0)
        border = BorderFactory.createMatteBorder(0, 0, 0, 1, Night.border)
        background = Night.panel
    }
    private val rootName = Night.label("EXPLORER", 11)
    private val explorerCards = CardLayout()
    private val explorerBody = JPanel(explorerCards).apply { background = Night.panel }
    private val explorerButton = IconButton("folder-tree", "Explorer", 36, size = 18) { toggle("explorer") }
    private val settingsButton = IconButton("settings", "Editor settings", 36, size = 18) { toggle("settings") }
    private var visiblePanel = "explorer"

    init {
        val rail = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            preferredSize = Dimension(Night.railWidth, 0)
            background = Night.chrome
            border = BorderFactory.createMatteBorder(0, 0, 0, 1, Night.border)
            fun button(button: IconButton) {
                button.alignmentX = CENTER_ALIGNMENT
                add(button)
            }
            add(Box.createVerticalStrut(8))
            button(explorerButton)
            add(Box.createVerticalStrut(4))
            button(IconButton("search", "Find in file", 36, size = 18, action = find))
            add(Box.createVerticalGlue())
            button(settingsButton)
            add(Box.createVerticalStrut(8))
        }
        val hint = JPanel(FlowLayout(FlowLayout.LEFT, 14, 10)).apply {
            background = Night.panel
            add(JButton("Open a folder…").apply {
                font = Night.ui(12)
                foreground = Night.accent
                isContentAreaFilled = false
                border = BorderFactory.createEmptyBorder()
                addActionListener { chooseFolder() }
            })
        }
        explorerBody.add(hint, "hint")
        explorerBody.add(workbenchScroll(explorer, Night.panel), "tree")
        val explorerPanel = JPanel(BorderLayout()).apply {
            background = Night.panel
            add(header(rootName, listOf(
                IconButton("file-plus", "New buffer", 22, size = 14, action = newBuffer),
                IconButton("refresh-cw", "Refresh explorer", 22, size = 14, action = refresh),
                IconButton("ellipsis", "Open folder", 22, size = 14, action = chooseFolder),
            )), BorderLayout.NORTH)
            add(explorerBody, BorderLayout.CENTER)
            add(JPanel(FlowLayout(FlowLayout.LEFT, 6, 6)).apply {
                background = Night.panel
                border = BorderFactory.createMatteBorder(1, 0, 0, 0, Night.border)
                add(Night.label("●", 10, Night.success))
                add(Night.label("Kotlin/JVM · ${System.getProperty("os.name")}", 11))
            }, BorderLayout.SOUTH)
        }
        sidebar.add(explorerPanel, "explorer")
        sidebar.add(settingsPanel(applyAppearance), "settings")
        explorerButton.isSelected = true
        add(rail, BorderLayout.WEST)
        add(sidebar, BorderLayout.CENTER)
    }

    fun workspaceSelected(name: String) {
        rootName.text = name.uppercase(Locale.ROOT)
        rootName.toolTipText = name
        explorerCards.show(explorerBody, "tree")
    }

    fun toggleExplorer() = toggle("explorer")
    fun toggleSettings() = toggle("settings")

    private fun toggle(panel: String) {
        sidebar.isVisible = !(sidebar.isVisible && panel == visiblePanel)
        visiblePanel = panel
        cards.show(sidebar, panel)
        explorerButton.isSelected = sidebar.isVisible && panel == "explorer"
        settingsButton.isSelected = sidebar.isVisible && panel == "settings"
        revalidate()
        repaint()
    }

    private fun header(title: javax.swing.JLabel, actions: List<IconButton> = emptyList()) =
        JPanel(BorderLayout(3, 0)).apply {
            background = Night.panel
            preferredSize = Dimension(0, 40)
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(0, 0, 1, 0, Night.border),
                BorderFactory.createEmptyBorder(0, 14, 0, 8),
            )
            add(title, BorderLayout.CENTER)
            add(JPanel(FlowLayout(FlowLayout.RIGHT, 1, 8)).apply {
                isOpaque = false
                actions.forEach(::add)
            }, BorderLayout.EAST)
        }

    private fun settingsPanel(applyAppearance: (EditorAppearance) -> Unit): JPanel {
        val defaults = EditorAppearance()
        val fontSize = JSpinner(SpinnerNumberModel(defaults.fontSize, 8, 32, 1))
        val tabSize = JSpinner(SpinnerNumberModel(defaults.tabSize, 1, 8, 1))
        val wrap = JCheckBox().apply { isSelected = defaults.wordWrap }
        val numbers = JCheckBox().apply { isSelected = defaults.lineNumbers }
        val highlight = JCheckBox().apply { isSelected = defaults.highlightCurrentLine }
        fun apply() = applyAppearance(
            EditorAppearance(fontSize.value as Int, tabSize.value as Int, numbers.isSelected, highlight.isSelected, wrap.isSelected),
        )
        for (spinner in listOf(fontSize, tabSize)) {
            spinner.setUI(object : BasicSpinnerUI() {
                override fun createNextButton() =
                    IconButton("arrow-up", "Increase", 15, 11, 9) {}.also(::installNextButtonListeners)

                override fun createPreviousButton() =
                    IconButton("arrow-down", "Decrease", 15, 11, 9) {}.also(::installPreviousButtonListeners)
            })
            spinner.addChangeListener { apply() }
            spinner.background = Night.chrome
            spinner.border = BorderFactory.createLineBorder(Night.border)
            (spinner.editor as JSpinner.DefaultEditor).textField.apply {
                background = Night.chrome
                foreground = Night.text
                caretColor = Night.bright
                border = BorderFactory.createEmptyBorder(0, 6, 0, 5)
            }
            spinner.preferredSize = Dimension(62, 24)
        }
        for (checkbox in listOf(wrap, numbers, highlight)) {
            checkbox.isOpaque = false
            checkbox.icon = checkIcon(false)
            checkbox.selectedIcon = checkIcon(true)
            checkbox.addActionListener { apply() }
        }
        val controls = JPanel(GridLayout(0, 1)).apply {
            background = Night.panel
            border = BorderFactory.createEmptyBorder(12, 14, 0, 14)
            add(Night.label("EDITOR", 11, Night.accent, bold = true))
            for ((label, control) in listOf(
                "Font size" to fontSize, "Tab size" to tabSize, "Word wrap" to wrap,
                "Line numbers" to numbers, "Highlight current line" to highlight,
            )) {
                control.accessibleContext.accessibleName = label
                add(JPanel(BorderLayout(6, 0)).apply {
                    isOpaque = false
                    border = BorderFactory.createCompoundBorder(
                        BorderFactory.createMatteBorder(0, 0, 1, 0, Night.border),
                        BorderFactory.createEmptyBorder(7, 0, 7, 0),
                    )
                    add(Night.label(label, 12, Night.text), BorderLayout.CENTER)
                    add(control, BorderLayout.EAST)
                })
            }
        }
        return JPanel(BorderLayout()).apply {
            background = Night.panel
            add(header(Night.label("SETTINGS", 11)), BorderLayout.NORTH)
            add(JPanel(BorderLayout()).apply {
                background = Night.panel
                add(controls, BorderLayout.NORTH)
            }, BorderLayout.CENTER)
        }
    }

    private fun checkIcon(selected: Boolean): Icon = object : Icon {
        override fun getIconHeight() = 16
        override fun getIconWidth() = 16
        override fun paintIcon(component: Component, graphics: Graphics, x: Int, y: Int) {
            val g = graphics.create() as Graphics2D
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g.color = if (selected) Night.accent else Night.chrome
            g.fillRoundRect(x, y, 14, 14, 3, 3)
            g.color = if (component.hasFocus()) Night.bright else Night.border
            g.drawRoundRect(x, y, 14, 14, 3, 3)
            if (selected) {
                g.color = Night.chrome
                g.stroke = java.awt.BasicStroke(1.5f)
                g.drawPolyline(intArrayOf(x + 3, x + 6, x + 11), intArrayOf(y + 7, y + 10, y + 4), 3)
            }
            g.dispose()
        }
    }
}
