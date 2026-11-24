package dev.nishi.desktop

import java.awt.Cursor
import java.awt.Graphics
import dev.nishi.workspace.LanguageServerDetector
import dev.nishi.workspace.ServerDetection
import java.util.concurrent.ExecutionException
import javax.swing.BorderFactory
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.SwingConstants
import javax.swing.SwingWorker

internal class LanguageStatus(
    chooseLanguage: () -> Unit,
    private val detector: LanguageServerDetector = LanguageServerDetector(),
) : JPanel() {
    private val languageButton = object : JButton() {
        override fun paintComponent(graphics: Graphics) {
            if (model.isRollover || hasFocus()) {
                graphics.color = Night.hover
                graphics.fillRoundRect(0, 0, width, height, 5, 5)
            }
            super.paintComponent(graphics)
        }
    }.apply {
        name = "language-mode"
        font = Night.ui(11)
        foreground = Night.text
        icon = WorkbenchIcons.glyph("chevron-down", 10)
        horizontalTextPosition = SwingConstants.LEADING
        iconTextGap = 4
        border = BorderFactory.createEmptyBorder(2, 6, 2, 6)
        isContentAreaFilled = false
        isFocusPainted = false
        isRolloverEnabled = true
        isVisible = false
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toolTipText = "Change Language Mode"
        addActionListener { chooseLanguage() }
    }
    private val serverLabel = Night.label("", 11, Night.text)
    private var worker: SwingWorker<ServerDetection?, Unit>? = null

    init {
        layout = BoxLayout(this, BoxLayout.X_AXIS)
        border = BorderFactory.createEmptyBorder(0, 8, 0, 0)
        isOpaque = false
        add(languageButton)
        serverLabel.border = BorderFactory.createEmptyBorder(0, 6, 0, 0)
        add(serverLabel)
        serverLabel.isVisible = false
    }

    fun update(tab: EditorTab?) {
        worker?.cancel(true)
        worker = null
        languageButton.text = tab?.language?.label.orEmpty()
        languageButton.isVisible = tab != null
        languageButton.accessibleContext.accessibleName =
            tab?.let { "Change language mode. Current language: ${it.language.label}." }
        setServer(null)
        if (tab == null || !detector.supports(tab.language)) return
        val binding = tab.binding ?: return
        val language = tab.language
        setServer("Checking LSP…")
        worker = object : SwingWorker<ServerDetection?, Unit>() {
            override fun doInBackground(): ServerDetection? =
                detector.detect(language, binding.workspace, binding.file)

            override fun done() {
                if (worker !== this || isCancelled) return
                worker = null
                val result = try {
                    get()
                } catch (_: ExecutionException) {
                    setServer("LSP check failed")
                    return
                }
                if (result == null) {
                    setServer(null)
                } else {
                    val found = result.executable
                    val relative = binding.workspace.root.relativize(result.projectRoot).toString().ifEmpty { "." }
                    val detail = if (found == null) "${result.command} was not found on PATH."
                    else "${found.fileName} was found on PATH."
                    setServer(
                        if (found == null) "LSP not found" else "LSP found",
                        "$detail Project folder: $relative.",
                    )
                }
            }
        }.also { it.execute() }
    }

    private fun setServer(text: String?, detail: String? = null) {
        serverLabel.text = text.orEmpty()
        serverLabel.isVisible = text != null
        serverLabel.toolTipText = detail
        serverLabel.accessibleContext.accessibleName = detail ?: text
    }
}
