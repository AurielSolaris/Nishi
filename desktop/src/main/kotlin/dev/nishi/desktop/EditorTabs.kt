package dev.nishi.desktop

import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Cursor
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.GridLayout
import java.awt.Insets
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BorderFactory
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.SwingUtilities

internal class EditorTabs(
    private val onSelect: () -> Unit,
    private val onClose: (EditorTab) -> Unit,
) : JPanel(BorderLayout()) {
    private val cards = CardLayout()
    private val surfaces = JPanel(cards).apply { background = Night.editor }
    private val strip = JPanel().apply {
        setLayout(BoxLayout(this, BoxLayout.X_AXIS))
        background = Night.chrome
    }
    private val stripScroll = workbenchScroll(strip, Night.chrome).apply {
        verticalScrollBarPolicy = JScrollPane.VERTICAL_SCROLLBAR_NEVER
        horizontalScrollBarPolicy = JScrollPane.HORIZONTAL_SCROLLBAR_NEVER
        addMouseWheelListener { event ->
            horizontalScrollBar.value += event.wheelRotation * 48
        }
    }
    private val split = IconButton("columns-2", "Toggle split editor") { active?.split() }
    private val headers = linkedMapOf<EditorTab, Header>()
    val documents: List<EditorTab> get() = headers.keys.toList()
    var active: EditorTab? = null
        private set

    init {
        val bar = JPanel(BorderLayout()).apply {
            background = Night.chrome
            preferredSize = Dimension(0, Night.tabHeight)
            border = BorderFactory.createMatteBorder(0, 0, 1, 0, Night.border)
            add(stripScroll, BorderLayout.CENTER)
            add(JPanel(FlowLayout(FlowLayout.RIGHT, 7, 5)).apply {
                isOpaque = false
                add(split)
            }, BorderLayout.EAST)
        }
        split.isEnabled = false
        surfaces.add(welcome(), "welcome")
        add(bar, BorderLayout.NORTH)
        add(surfaces, BorderLayout.CENTER)
    }

    fun open(tab: EditorTab) {
        val header = Header(tab)
        headers[tab] = header
        strip.add(header)
        surfaces.add(tab, tab.id.toString())
        select(tab)
    }

    fun select(tab: EditorTab?) {
        val previous = active
        active = tab
        split.isEnabled = tab != null
        cards.show(surfaces, tab?.id?.toString() ?: "welcome")
        previous?.let(::refresh)
        tab?.let {
            refresh(it)
            SwingUtilities.invokeLater {
                val header = headers[it] ?: return@invokeLater
                strip.scrollRectToVisible(header.bounds)
            }
            it.activeArea.requestFocusInWindow()
        }
        onSelect()
    }

    fun removeTab(tab: EditorTab) {
        val index = documents.indexOf(tab)
        val neighbor = documents.getOrNull(index - 1) ?: documents.getOrNull(index + 1)
        headers.remove(tab)?.let(strip::remove)
        surfaces.remove(tab)
        if (active == tab) select(neighbor)
        strip.revalidate()
        strip.repaint()
    }

    fun refresh(tab: EditorTab) {
        headers[tab]?.refresh(tab == active)
    }

    private inner class Header(private val tab: EditorTab) : JPanel(BorderLayout(8, 0)) {
        private val title = Night.label("")
        private val dirty = Night.label("●", 10, Night.star)

        init {
            val controls = JPanel(FlowLayout(FlowLayout.RIGHT, 4, 6)).apply {
                isOpaque = false
                add(dirty)
                add(IconButton("x", "Close tab", 22, size = 13) { onClose(tab) })
            }
            add(title, BorderLayout.CENTER)
            add(controls, BorderLayout.EAST)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            val mouse = object : MouseAdapter() {
                override fun mousePressed(event: MouseEvent) {
                    if (SwingUtilities.isLeftMouseButton(event)) select(tab)
                    if (SwingUtilities.isMiddleMouseButton(event)) onClose(tab)
                }
            }
            listOf(this, title, dirty, controls).forEach { it.addMouseListener(mouse) }
        }

        override fun getPreferredSize(): Dimension =
            Dimension(super.getPreferredSize().width.coerceIn(106, 200), Night.tabHeight - 1)

        override fun getMaximumSize(): Dimension = preferredSize

        fun refresh(selected: Boolean) {
            background = if (selected) Night.editor else Night.chrome
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(0, 0, 0, 1, Night.border),
                BorderFactory.createCompoundBorder(
                    BorderFactory.createMatteBorder(2, 0, 0, 0, if (selected) Night.accent else Night.chrome),
                    BorderFactory.createEmptyBorder(0, 13, 0, 3),
                ),
            )
            title.text = tab.nameForTab
            title.icon = WorkbenchIcons.glyph(WorkbenchIcons.file(tab.nameForTab), 14)
            title.iconTextGap = 7
            title.foreground = if (selected) Night.bright else Night.muted
            dirty.text = if (tab.hasDiskConflict) "▲" else "●"
            dirty.isVisible = tab.state.isDirty || tab.hasDiskConflict
            val detail = if (tab.hasDiskConflict) "File changed or is missing on disk." else tab.location
            toolTipText = detail
            title.toolTipText = detail
        }
    }

    private fun welcome(): JPanel = object : JPanel(GridBagLayout()) {
        override fun getInsets() = Insets(0, (width - 620).coerceAtLeast(0) / 2, 0, 0)
    }.apply {
        background = Night.editor
        val content = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            add(JLabel(WorkbenchIcons.brand(72)).apply { alignmentX = LEFT_ALIGNMENT })
            add(Box.createVerticalStrut(16))
            add(Night.label("Nishi", 30, Night.bright, bold = true).apply { alignmentX = LEFT_ALIGNMENT })
            add(Box.createVerticalStrut(4))
            add(Night.label("nishi — निशा / নিশি, night.", 14).apply {
                alignmentX = LEFT_ALIGNMENT
                val readable = Night.readableFont(text, 14)
                if (readable == null) text = "nishi — night." else font = readable
            })
            add(Box.createVerticalStrut(4))
            add(Night.label("A modern resurrection of Atom.", 14).apply { alignmentX = LEFT_ALIGNMENT })
            add(Box.createVerticalStrut(24))
            add(JPanel(GridLayout(3, 2, 24, 7)).apply {
                isOpaque = false
                alignmentX = LEFT_ALIGNMENT
                val key = if (System.getProperty("os.name").startsWith("Mac")) "⌘" else "Ctrl"
                for ((shortcut, name) in listOf(
                    "N" to "New buffer", "S" to "Save", "F" to "Find", "H" to "Replace",
                    "\\" to "Split editor", "B" to "Toggle sidebar",
                )) {
                    add(JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
                        isOpaque = false
                        for (token in listOf(key, shortcut)) {
                            add(Night.label(token, 11, Night.text).apply {
                                isOpaque = true
                                background = Night.panel
                                font = Night.mono(11)
                                border = BorderFactory.createCompoundBorder(
                                    BorderFactory.createMatteBorder(1, 1, 2, 1, Night.border),
                                    BorderFactory.createEmptyBorder(1, 5, 1, 5),
                                )
                            })
                            add(Box.createHorizontalStrut(4))
                        }
                        add(Night.label("  $name"))
                    })
                }
            })
            add(Box.createVerticalStrut(19))
            add(Night.label("Open a file or create a buffer to start editing.").apply { alignmentX = LEFT_ALIGNMENT })
        }
        add(content, GridBagConstraints().apply {
            weightx = 1.0
            weighty = 1.0
            anchor = GridBagConstraints.NORTHWEST
            insets = Insets(40, 36, 16, 20)
        })
    }
}
