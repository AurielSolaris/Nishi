package dev.nishi.desktop

import java.awt.Cursor
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.GraphicsEnvironment
import java.awt.GridLayout
import java.awt.Point
import java.awt.Rectangle
import java.awt.event.MouseEvent
import java.awt.event.WindowEvent
import javax.swing.BorderFactory
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JFrame
import javax.swing.JPanel
import javax.swing.JPopupMenu
import javax.swing.SwingConstants
import javax.swing.SwingUtilities
import javax.swing.event.MouseInputAdapter

internal class WindowChrome(private val window: JFrame, menu: JPopupMenu) : JPanel(GridLayout(1, 3)) {
    private val caption = Night.label("Nishi").apply { horizontalAlignment = SwingConstants.CENTER }
    private var restoreBounds: Rectangle? = null
    private val maximize = IconButton("square", "Maximize", 44, Night.titleHeight, 12) { toggleMaximize() }

    init {
        background = Night.chrome
        preferredSize = Dimension(0, Night.titleHeight)
        border = BorderFactory.createMatteBorder(0, 0, 1, 0, Night.border)
        val brand = JButton("Nishi", WorkbenchIcons.brand(18)).apply {
            font = Night.ui(13, bold = true)
            foreground = Night.bright
            iconTextGap = 8
            toolTipText = "Nishi menu"
            isContentAreaFilled = false
            border = BorderFactory.createEmptyBorder()
            addActionListener { menu.show(this, 0, height + 7) }
        }
        val left = JPanel(FlowLayout(FlowLayout.LEFT, 12, 7)).apply {
            isOpaque = false
            add(brand)
        }
        val right = JPanel(FlowLayout(FlowLayout.RIGHT, 0, 0)).apply {
            isOpaque = false
            add(IconButton("minus", "Minimize", 44, Night.titleHeight, 12) {
                window.extendedState = window.extendedState or JFrame.ICONIFIED
            })
            add(maximize)
            add(IconButton("x", "Close window", 44, Night.titleHeight, 12, Night.danger) {
                window.dispatchEvent(WindowEvent(window, WindowEvent.WINDOW_CLOSING))
            })
        }
        add(left)
        add(caption)
        add(right)

        val drag = object : MouseInputAdapter() {
            private var start: Point? = null
            private var offset = Point()

            override fun mousePressed(event: MouseEvent) {
                if (!SwingUtilities.isLeftMouseButton(event)) return
                start = event.locationOnScreen
                offset = Point(event.xOnScreen - window.x, event.yOnScreen - window.y)
            }

            override fun mouseReleased(event: MouseEvent) {
                start = null
            }

            override fun mouseClicked(event: MouseEvent) {
                if (SwingUtilities.isLeftMouseButton(event) && event.clickCount == 2) toggleMaximize()
            }

            override fun mouseDragged(event: MouseEvent) {
                val origin = start ?: return
                if (origin.distance(event.locationOnScreen) < 3) return
                if (restoreBounds != null) {
                    val fraction = offset.x.toDouble() / window.width
                    toggleMaximize()
                    offset.x = (window.width * fraction).toInt()
                }
                window.setLocation(event.xOnScreen - offset.x, event.yOnScreen - offset.y)
            }
        }
        for (component in listOf(this, left, caption, right)) {
            component.addMouseListener(drag)
            component.addMouseMotionListener(drag)
        }
        window.glassPane = resizeEdges()
        window.glassPane.isVisible = true
    }

    fun setCaption(text: String) {
        caption.text = text
    }

    private fun toggleMaximize() {
        val previous = restoreBounds
        if (previous == null) {
            val monitor = GraphicsEnvironment.getLocalGraphicsEnvironment().screenDevices
                .map { it.defaultConfiguration }
                .firstOrNull { it.bounds.contains(window.x + window.width / 2, window.y + Night.titleHeight / 2) }
                ?: window.graphicsConfiguration
            val bounds = monitor.bounds
            val insets = window.toolkit.getScreenInsets(monitor)
            restoreBounds = window.bounds
            window.setBounds(
                bounds.x + insets.left, bounds.y + insets.top,
                bounds.width - insets.left - insets.right, bounds.height - insets.top - insets.bottom,
            )
            maximize.icon = WorkbenchIcons.glyph("copy", 12)
            maximize.toolTipText = "Restore window"
        } else {
            window.bounds = previous
            restoreBounds = null
            maximize.icon = WorkbenchIcons.glyph("square", 12)
            maximize.toolTipText = "Maximize"
        }
        maximize.accessibleContext.accessibleName = maximize.toolTipText
    }

    private fun resizeEdges(): JComponent = object : JComponent() {
        private val margin = 5

        override fun contains(x: Int, y: Int): Boolean =
            restoreBounds == null && (x < margin || x >= width - margin || y < margin || y >= height - margin)

        private fun horizontalEdge(x: Int) = when {
            x < margin -> -1
            x >= width - margin -> 1
            else -> 0
        }

        private fun verticalEdge(y: Int) = when {
            y < margin -> -1
            y >= height - margin -> 1
            else -> 0
        }

        init {
            val resize = object : MouseInputAdapter() {
                private var origin: Point? = null
                private var bounds = Rectangle()
                private var xEdge = 0
                private var yEdge = 0

                override fun mouseMoved(event: MouseEvent) {
                    val direction = when (horizontalEdge(event.x) to verticalEdge(event.y)) {
                        -1 to -1, 1 to 1 -> Cursor.NW_RESIZE_CURSOR
                        -1 to 1, 1 to -1 -> Cursor.NE_RESIZE_CURSOR
                        -1 to 0, 1 to 0 -> Cursor.E_RESIZE_CURSOR
                        else -> Cursor.N_RESIZE_CURSOR
                    }
                    cursor = Cursor.getPredefinedCursor(direction)
                }

                override fun mousePressed(event: MouseEvent) {
                    if (!SwingUtilities.isLeftMouseButton(event)) return
                    origin = event.locationOnScreen
                    bounds = window.bounds
                    xEdge = horizontalEdge(event.x)
                    yEdge = verticalEdge(event.y)
                }

                override fun mouseReleased(event: MouseEvent) {
                    origin = null
                }

                override fun mouseDragged(event: MouseEvent) {
                    val start = origin ?: return
                    val width = (bounds.width + xEdge * (event.xOnScreen - start.x)).coerceAtLeast(window.minimumSize.width)
                    val height = (bounds.height + yEdge * (event.yOnScreen - start.y)).coerceAtLeast(window.minimumSize.height)
                    val x = if (xEdge < 0) bounds.x + bounds.width - width else bounds.x
                    val y = if (yEdge < 0) bounds.y + bounds.height - height else bounds.y
                    window.setBounds(x, y, width, height)
                }
            }
            addMouseListener(resize)
            addMouseMotionListener(resize)
        }
    }
}
