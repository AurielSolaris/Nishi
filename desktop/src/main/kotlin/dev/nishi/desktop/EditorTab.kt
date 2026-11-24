package dev.nishi.desktop

import dev.nishi.editor.EditorDocument
import dev.nishi.editor.Language
import dev.nishi.workspace.Draft
import dev.nishi.workspace.Workspace
import dev.nishi.workspace.WorkspaceFile
import java.awt.BorderLayout
import java.awt.Graphics
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import java.nio.file.Path
import java.util.UUID
import javax.swing.JPanel
import javax.swing.JSplitPane
import javax.swing.JTextArea
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener
import javax.swing.text.PlainDocument
import javax.swing.plaf.basic.BasicSplitPaneUI
import javax.swing.plaf.basic.BasicSplitPaneDivider
import javax.swing.undo.CompoundEdit
import javax.swing.undo.UndoManager

internal data class FileBinding(val workspace: Workspace, val file: WorkspaceFile, val fingerprint: String?)

internal class EditorTab(
    val state: EditorDocument,
    private val untitledName: String,
    private val originalRoot: Path?,
    val homeWorkspace: Workspace? = null,
    binding: FileBinding? = null,
    private val originalPath: String? = null,
    private val originalFingerprint: String? = null,
    val id: UUID = UUID.randomUUID(),
    onEdit: (EditorTab) -> Unit,
    private val onCaretMove: (EditorTab) -> Unit,
) : JPanel(BorderLayout()) {
    private val text = PlainDocument()
    private val undo = UndoManager()
    private var compoundEdit: CompoundEdit? = null
    private var appearance = EditorAppearance()
    private val highlighting = SyntaxHighlighting(text, Language.fromFilename(binding?.file?.name ?: untitledName))
    var languageOverride: Language? = null
        set(value) {
            field = value
            updateLanguage()
        }
    var binding: FileBinding? = binding
        set(value) {
            field = value
            updateLanguage()
        }
    private val primary = makeArea()
    private var secondary: EditorSurface? = null
    var activeArea: JTextArea = primary
        private set
    var hasDiskConflict = false

    val nameForTab: String get() = binding?.file?.name ?: untitledName
    val language: Language get() = highlighting.language
    val location: String?
        get() = binding?.let { "${it.workspace.name}/${it.file.relativePath}" } ?: originalPath

    init {
        text.insertString(0, state.snapshot().content.text, null)
        text.addUndoableEditListener { event -> (compoundEdit ?: undo).addEdit(event.edit) }
        text.addDocumentListener(object : DocumentListener {
            override fun insertUpdate(event: DocumentEvent) = changed(event)
            override fun removeUpdate(event: DocumentEvent) = changed(event)
            override fun changedUpdate(event: DocumentEvent) = changed(event)

            private fun changed(event: DocumentEvent) {
                highlighting.invalidate(event.offset)
                state.replaceText(text.getText(0, text.length))
                editorRepaint()
                onEdit(this@EditorTab)
            }
        })
        add(primary.scroll, BorderLayout.CENTER)
    }

    fun split() {
        val other = secondary
        removeAll()
        if (other == null) {
            val area = makeArea()
            area.caretPosition = primary.caretPosition
            secondary = area
            val split = JSplitPane(JSplitPane.HORIZONTAL_SPLIT, primary.scroll, area.scroll).apply {
                resizeWeight = 0.5
                isContinuousLayout = true
                setUI(object : BasicSplitPaneUI() {
                    override fun createDefaultDivider() = object : BasicSplitPaneDivider(this) {
                        init {
                            background = Night.border
                        }

                        override fun paint(graphics: Graphics) {
                            graphics.color = Night.border
                            graphics.fillRect(0, 0, width, height)
                        }
                    }
                })
                isOpaque = true
                background = Night.border
                border = null
                dividerSize = 5
            }
            add(split, BorderLayout.CENTER)
            if (width > 0) split.dividerLocation = (width - split.dividerSize) / 2
            activeArea = area
        } else {
            other.detach()
            secondary = null
            add(primary.scroll, BorderLayout.CENTER)
            activeArea = primary
        }
        revalidate()
        repaint()
        activeArea.requestFocusInWindow()
    }

    fun undo() {
        if (undo.canUndo()) undo.undo()
    }

    fun redo() {
        if (undo.canRedo()) undo.redo()
    }

    fun applyAppearance(settings: EditorAppearance) {
        appearance = settings
        primary.applyAppearance(settings)
        secondary?.applyAppearance(settings)
    }

    fun replaceRange(start: Int, end: Int, value: String) {
        val edit = CompoundEdit()
        compoundEdit = edit
        try {
            text.replace(start, end - start, value, null)
        } finally {
            compoundEdit = null
            edit.end()
            if (edit.isSignificant) undo.addEdit(edit)
        }
    }

    fun draft(snapshot: EditorDocument.Snapshot): Draft = Draft(
        id = id,
        root = binding?.workspace?.root ?: originalRoot,
        relativePath = binding?.file?.relativePath ?: originalPath,
        title = nameForTab,
        baseFingerprint = if (binding != null) binding?.fingerprint else originalFingerprint,
        content = snapshot.content,
    )

    private fun editorRepaint() {
        primary.editorChanged()
        secondary?.editorChanged()
    }

    private fun updateLanguage() {
        highlighting.language = languageOverride ?: Language.fromFilename(nameForTab)
        editorRepaint()
    }

    private fun makeArea(): EditorSurface = EditorSurface(text, highlighting).apply {
        applyAppearance(appearance)
        addFocusListener(object : FocusAdapter() {
            override fun focusGained(event: FocusEvent) {
                activeArea = this@apply
                onCaretMove(this@EditorTab)
            }
        })
        addCaretListener { onCaretMove(this@EditorTab) }
    }
}
