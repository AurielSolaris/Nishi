package dev.nishi.desktop

import com.github.weisj.jsvg.SVGDocument
import com.github.weisj.jsvg.parser.SVGLoader
import com.github.weisj.jsvg.view.ViewBox
import java.awt.Color
import java.awt.Component
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.GraphicsEnvironment
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import javax.imageio.ImageIO
import javax.swing.AbstractButton
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JScrollPane
import javax.swing.UIManager
import javax.swing.border.EmptyBorder
import javax.swing.plaf.ColorUIResource
import javax.swing.plaf.FontUIResource
import javax.swing.plaf.basic.BasicScrollBarUI

internal object Night {
    val editor = Color(0x0F1420)
    val panel = Color(0x161C2B)
    val chrome = Color(0x0B0F19)
    val border = Color(0x242D42)
    val text = Color(0xC7D1E4)
    val muted = Color(0x7A879F)
    val bright = Color(0xEAF0FB)
    val accent = Color(0x4C8DFF)
    val hover = Color(0x1E2C49)
    val currentLine = Color(0x131C30)
    val selection = Color(0x23416A)
    val star = Color(0xFFC93A)
    val success = Color(0x3FB950)
    val danger = Color(0xFF5F57)

    const val titleHeight = 36
    const val tabHeight = 36
    const val statusHeight = 24
    const val railWidth = 48
    const val sidebarWidth = 248

    private val fonts by lazy { GraphicsEnvironment.getLocalGraphicsEnvironment().availableFontFamilyNames.toSet() }
    private val uiFamily by lazy { if ("Segoe UI" in fonts) "Segoe UI" else Font.SANS_SERIF }
    private val monoFamily by lazy {
        listOf("Cascadia Code", "JetBrains Mono", "Consolas").firstOrNull { it in fonts } ?: Font.MONOSPACED
    }
    fun ui(size: Int = 13, bold: Boolean = false) = Font(uiFamily, if (bold) Font.BOLD else Font.PLAIN, size)
    fun mono(size: Int = 13) = Font(monoFamily, Font.PLAIN, size)
    fun readableFont(text: String, size: Int): Font? =
        sequenceOf(uiFamily, "Nirmala UI", Font.SANS_SERIF).plus(fonts.asSequence())
            .map { Font(it, Font.PLAIN, size) }
            .firstOrNull { it.canDisplayUpTo(text) == -1 }

    fun install() {
        val colorKeys = mapOf(
            "control" to panel, "info" to panel, "text" to text,
            "Panel.background" to panel, "Label.foreground" to text,
            "Button.background" to chrome, "Button.foreground" to text,
            "CheckBox.background" to panel, "CheckBox.foreground" to text,
            "TextField.background" to chrome, "TextField.foreground" to text,
            "TextField.caretForeground" to bright, "TextField.selectionBackground" to selection,
            "TextField.selectionForeground" to bright, "TextArea.background" to editor,
            "TextArea.foreground" to text, "OptionPane.background" to panel,
            "OptionPane.messageForeground" to text, "ToolTip.background" to chrome,
            "ToolTip.foreground" to text, "PopupMenu.background" to panel,
            "MenuItem.background" to panel, "MenuItem.foreground" to text,
            "MenuItem.selectionBackground" to hover, "MenuItem.selectionForeground" to bright,
            "List.background" to panel, "List.foreground" to text,
            "List.selectionBackground" to selection, "List.selectionForeground" to bright,
        )
        colorKeys.forEach { (key, color) -> UIManager.put(key, ColorUIResource(color)) }
        listOf("Label", "Button", "CheckBox", "TextField", "Tree", "MenuItem", "ToolTip").forEach {
            UIManager.put("$it.font", FontUIResource(ui()))
        }
        UIManager.put("ScrollBar.width", 9)
    }

    fun label(text: String, size: Int = 12, color: Color = muted, bold: Boolean = false) =
        JLabel(text).apply {
            font = ui(size, bold)
            foreground = color
        }
}

internal object WorkbenchIcons {
    val brand: BufferedImage by lazy {
        ImageIO.read(requireNotNull(javaClass.getResource("nishi.png")))
    }
    private val svgs = mutableMapOf<String, SVGDocument>()

    fun brand(size: Int): Icon = icon(size) { _, graphics, x, y ->
        graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
        graphics.drawImage(brand, x, y, size, size, null)
    }

    fun glyph(name: String, size: Int = 16, color: Color? = null): Icon {
        val svg = svgs.getOrPut(name) {
            val source = requireNotNull(javaClass.getResource("icons/$name.svg")) { "Missing Lucide icon $name" }
            requireNotNull(SVGLoader().load(source)) { "Could not read Lucide icon $name" }
        }
        return icon(size) { component, graphics, x, y ->
            val button = component as? AbstractButton
            graphics.color = color ?: when {
                button == null -> Night.muted
                !button.isEnabled -> Night.border
                button.isSelected -> Night.accent
                button.model.isRollover -> Night.bright
                else -> button.foreground
            }
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            svg.render(component, graphics, ViewBox(x.toFloat(), y.toFloat(), size.toFloat(), size.toFloat()))
        }
    }

    fun file(name: String): String = when (name.lowercase().substringAfterLast('.', "")) {
        "kt", "kts", "ts", "tsx", "js", "jsx", "py", "rs", "go", "c", "cpp", "h", "lua", "html" -> "file-code"
        "css", "scss", "sass" -> "palette"
        "json", "jsonc" -> "file-json"
        "toml", "yaml", "yml", "ini" -> "file-cog"
        "lock", "env" -> "file-lock"
        "md", "mdx" -> "book-open"
        "txt" -> "file-text"
        "svg", "png", "jpg", "jpeg", "gif", "webp", "ico" -> "file-image"
        "sh", "bat", "cmd", "ps1" -> "terminal"
        else -> "file"
    }

    private fun icon(size: Int, paint: (Component?, Graphics2D, Int, Int) -> Unit): Icon = object : Icon {
        override fun getIconWidth() = size
        override fun getIconHeight() = size
        override fun paintIcon(component: Component?, graphics: Graphics, x: Int, y: Int) {
            val g = graphics.create() as Graphics2D
            try {
                paint(component, g, x, y)
            } finally {
                g.dispose()
            }
        }
    }
}

internal class IconButton(
    name: String,
    label: String,
    width: Int = 24,
    height: Int = width,
    size: Int = 15,
    private val hoverColor: Color = Night.hover,
    action: () -> Unit,
) : JButton(WorkbenchIcons.glyph(name, size)) {
    init {
        toolTipText = label
        getAccessibleContext().accessibleName = label
        preferredSize = Dimension(width, height)
        maximumSize = preferredSize
        minimumSize = preferredSize
        foreground = Night.muted
        border = EmptyBorder(0, 0, 0, 0)
        isContentAreaFilled = false
        isFocusPainted = false
        isRolloverEnabled = true
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        addActionListener { action() }
    }

    override fun paintComponent(graphics: Graphics) {
        val g = graphics.create() as Graphics2D
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        if (isEnabled && (model.isRollover || hasFocus())) {
            g.color = hoverColor
            g.fillRoundRect(0, 0, width, height, 6, 6)
        }
        g.dispose()
        super.paintComponent(graphics)
    }
}

internal fun workbenchScroll(view: Component, color: Color = Night.editor) = JScrollPane(view).apply {
    border = null
    background = color
    viewport.background = color
    for (bar in listOf(verticalScrollBar, horizontalScrollBar)) {
        bar.background = color
        bar.setUI(object : BasicScrollBarUI() {
            override fun configureScrollBarColors() {
                thumbColor = Night.border
                trackColor = color
            }

            override fun createDecreaseButton(orientation: Int) = emptyButton()
            override fun createIncreaseButton(orientation: Int) = emptyButton()

            private fun emptyButton() = JButton().apply {
                preferredSize = Dimension(0, 0)
                minimumSize = preferredSize
                maximumSize = preferredSize
            }

            override fun paintThumb(graphics: Graphics, component: javax.swing.JComponent, bounds: java.awt.Rectangle) {
                if (bounds.isEmpty || !component.isEnabled) return
                graphics.color = if (isThumbRollover) Night.muted else thumbColor
                graphics.fillRoundRect(bounds.x + 2, bounds.y + 2, bounds.width - 4, bounds.height - 4, 6, 6)
            }
        })
    }
}
