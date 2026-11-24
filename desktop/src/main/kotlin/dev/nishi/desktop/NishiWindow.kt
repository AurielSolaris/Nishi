package dev.nishi.desktop

import dev.nishi.editor.EditorDocument
import dev.nishi.workspace.DraftJournal
import dev.nishi.workspace.SaveConflict
import dev.nishi.workspace.Workspace
import dev.nishi.workspace.WorkspaceFile
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.event.ActionEvent
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.awt.Toolkit
import java.awt.event.WindowAdapter
import java.awt.event.WindowEvent
import java.nio.file.Path
import javax.swing.BorderFactory
import javax.swing.AbstractAction
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JFileChooser
import javax.swing.JFrame
import javax.swing.JMenuItem
import javax.swing.JOptionPane
import javax.swing.JPanel
import javax.swing.JPopupMenu
import javax.swing.KeyStroke
import javax.swing.SwingConstants
import javax.swing.Timer

internal class NishiWindow(private val journal: DraftJournal) : JFrame("Nishi") {
    private val tabs: EditorTabs = EditorTabs(::updateActiveTab, ::closeTab)
    private val status = Night.label("Ready", 11)
    private val cursorStatus = Night.label("", 11).apply { horizontalAlignment = SwingConstants.RIGHT }
    private val explorer = WorkspaceExplorer(::openFile, ::showError)
    private val find = FindBar { activeTab }
    private val sidebar = WorkbenchSidebar(
        explorer, ::chooseFolder, ::newBuffer, ::refreshExplorer, { find.open() }, ::changeAppearance,
    )
    private val chrome = WindowChrome(this, commands())
    private val draftTimer = Timer(600) { flushDrafts() }.apply { isRepeats = false }
    private var workspace: Workspace? = null
    private var untitledCount = 0
    private var appearance = EditorAppearance()

    private val activeTab: EditorTab? get() = tabs.active
    private fun openTabs(): List<EditorTab> = tabs.documents

    init {
        defaultCloseOperation = DO_NOTHING_ON_CLOSE
        isUndecorated = true
        iconImage = WorkbenchIcons.brand
        minimumSize = Dimension(760, 480)
        setSize(1280, 820)
        setLocationByPlatform(true)
        add(chrome, BorderLayout.NORTH)
        add(sidebar, BorderLayout.WEST)
        val footer = JPanel(BorderLayout(16, 0)).apply {
            background = Night.chrome
            preferredSize = Dimension(0, Night.statusHeight)
            maximumSize = Dimension(Int.MAX_VALUE, Night.statusHeight)
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(1, 0, 0, 0, Night.border),
                BorderFactory.createEmptyBorder(0, 14, 0, 14),
            )
            add(status, BorderLayout.CENTER)
            add(cursorStatus, BorderLayout.EAST)
        }
        add(JPanel(BorderLayout()).apply {
            background = Night.editor
            add(tabs, BorderLayout.CENTER)
            add(JPanel().apply {
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                add(find)
                add(footer)
            }, BorderLayout.SOUTH)
        }, BorderLayout.CENTER)
        addWindowListener(object : WindowAdapter() {
            override fun windowClosing(event: WindowEvent) = closeWindow()
        })
    }

    fun openFolder(directory: Path) = attempt {
        val next = Workspace.open(directory)
        explorer.mount(next)
        workspace = next
        sidebar.workspaceSelected(next.name)
        status.text = "Workspace  ·  ${next.name}"
    }

    fun recoverDrafts() = attempt {
        val drafts = journal.recover()
        if (drafts.isEmpty()) return@attempt
        val roots = mutableMapOf<Path, Workspace?>()
        var restoredCount = 0
        for (draft in drafts) {
            val home = draft.root?.let { root ->
                if (root !in roots) roots[root] = runCatching { Workspace.open(root) }.getOrNull()
                roots[root]
            }
            val file = draft.relativePath?.let { runCatching { home?.file(it) }.getOrNull() }
            val binding = if (home != null && file != null) FileBinding(home, file, draft.baseFingerprint) else null
            val disk = binding?.let { runCatching { it.workspace.read(it.file) }.getOrNull() }
            if (disk?.content == draft.content) {
                journal.drop(draft.id)
                continue
            }
            val tab = EditorTab(
                state = EditorDocument(draft.content, recovered = true),
                untitledName = draft.title,
                originalRoot = draft.root,
                homeWorkspace = home,
                binding = binding,
                originalPath = draft.relativePath,
                originalFingerprint = draft.baseFingerprint,
                id = draft.id,
                onEdit = ::edited,
                onCaretMove = ::updateCursor,
            )
            tab.hasDiskConflict = draft.relativePath != null &&
                (disk == null || disk.fingerprint != draft.baseFingerprint)
            addTab(tab)
            restoredCount++
        }
        if (restoredCount > 0) {
            val conflicts = openTabs().count { it.hasDiskConflict }
            status.text = if (conflicts == 0) "Recovered $restoredCount unsaved draft(s)."
            else "Recovered $restoredCount draft(s), $conflicts with disk conflicts."
        }
    }

    private fun chooseFolder() {
        val picker = JFileChooser(workspace?.root?.toFile())
        picker.fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
        picker.dialogTitle = "Open workspace folder"
        if (picker.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) openFolder(picker.selectedFile.toPath())
    }

    private fun refreshExplorer() = attempt {
        workspace?.let(explorer::mount)
    }

    private fun openFile(mounted: Workspace, file: WorkspaceFile) = attempt {
        val existing = openTabs().find { it.binding?.file == file }
        if (existing != null) {
            tabs.select(existing)
            return@attempt
        }
        val loaded = mounted.read(file)
        addTab(
            EditorTab(
                state = EditorDocument(loaded.content),
                untitledName = file.name,
                originalRoot = mounted.root,
                homeWorkspace = mounted,
                binding = FileBinding(mounted, file, loaded.fingerprint),
                onEdit = ::edited,
                onCaretMove = ::updateCursor,
            ),
        )
    }

    private fun newBuffer() {
        val home = workspace
        addTab(
            EditorTab(
                state = EditorDocument(),
                untitledName = "untitled-${++untitledCount}",
                originalRoot = home?.root,
                homeWorkspace = home,
                onEdit = ::edited,
                onCaretMove = ::updateCursor,
            ),
        )
    }

    private fun addTab(tab: EditorTab) {
        tab.applyAppearance(appearance)
        tabs.open(tab)
    }

    private fun edited(tab: EditorTab) {
        updateTabLabel(tab)
        draftTimer.restart()
        find.refresh()
    }

    private fun updateTabLabel(tab: EditorTab) {
        tabs.refresh(tab)
        if (activeTab == tab) updateTitle(tab)
    }

    private fun updateActiveTab() {
        val tab = activeTab
        updateTitle(tab)
        status.text = tab?.location ?: "Ready"
        if (tab == null) cursorStatus.text = "" else updateCursor(tab)
        find.refresh()
    }

    private fun updateTitle(tab: EditorTab?) {
        val label = if (tab == null) "Nishi" else "${if (tab.state.isDirty) "● " else ""}${tab.nameForTab} — Nishi"
        chrome.setCaption(label)
        title = label
    }

    private fun changeAppearance(settings: EditorAppearance) {
        appearance = settings
        openTabs().forEach { it.applyAppearance(settings) }
    }

    private fun updateCursor(tab: EditorTab) {
        if (activeTab != tab) return
        val area = tab.activeArea
        val caret = area.caretPosition.coerceAtMost(area.document.length)
        val line = area.getLineOfOffset(caret)
        val column = caret - area.getLineStartOffset(line) + 1
        val format = tab.state.snapshot().content.format.lineEnding
        val count = area.selectionEnd - area.selectionStart
        val selection = if (count > 0) "$count selected     " else ""
        cursorStatus.text = "${selection}Ln ${line + 1}, Col $column     $format"
    }

    private fun save(copy: Boolean = false) = attempt {
        val tab = activeTab ?: return@attempt
        val original = tab.binding
        val target = if (copy || original == null) {
            val destination = (if (copy) workspace else tab.homeWorkspace ?: workspace)
                ?: throw IllegalStateException("Open a folder before saving a new file.")
            val proposed = if (original == null) "${tab.nameForTab}.txt" else "copy-${original.file.name}"
            val answer = JOptionPane.showInputDialog(
                this,
                "Path inside ${destination.name}",
                proposed,
            ) ?: return@attempt
            FileBinding(destination, destination.file(answer.replace('\\', '/')), null)
        } else {
            original
        }

        val snapshot = tab.state.snapshot()
        val fingerprint = try {
            target.workspace.save(target.file, snapshot.content, target.fingerprint)
        } catch (conflict: SaveConflict) {
            if (target === original) {
                tab.hasDiskConflict = true
                updateTabLabel(tab)
            }
            throw conflict
        }
        tab.binding = target.copy(fingerprint = fingerprint)
        tab.hasDiskConflict = false
        tab.state.markSaved(snapshot)
        updateTabLabel(tab)
        journal.drop(tab.id)
        if (target.fingerprint == null && workspace?.root == target.workspace.root) refreshExplorer()
        status.text = "Saved ${target.file.name}"
    }

    private fun flushDrafts(): Boolean {
        var firstError: Exception? = null
        for (tab in openTabs()) {
            if (!tab.state.isDirty || tab.state.isJournalled) continue
            val snapshot = tab.state.snapshot()
            try {
                journal.put(tab.draft(snapshot))
                tab.state.markJournalled(snapshot)
            } catch (error: Exception) {
                if (firstError == null) firstError = error
            }
        }
        if (firstError != null) status.text = "Could not store draft  ·  ${firstError.message}"
        return firstError == null
    }

    private fun closeTab(tab: EditorTab): Unit = attempt {
        if (tab.state.isDirty && JOptionPane.showConfirmDialog(
                this, "Discard unsaved edits in ${tab.nameForTab}?", "Close tab",
                JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE,
            ) != JOptionPane.YES_OPTION
        ) return@attempt
        journal.drop(tab.id)
        tabs.removeTab(tab)
    }

    private fun closeWindow() {
        draftTimer.stop()
        if (flushDrafts()) {
            dispose()
        } else {
            JOptionPane.showMessageDialog(this, status.text, "Could not close Nishi", JOptionPane.ERROR_MESSAGE)
        }
    }

    private fun commands(): JPopupMenu {
        val shortcut = Toolkit.getDefaultToolkit().menuShortcutKeyMaskEx
        val menu = JPopupMenu()
        fun item(label: String, id: String, key: Int, shift: Boolean = false, action: () -> Unit) {
            val modifiers = shortcut or if (shift) InputEvent.SHIFT_DOWN_MASK else 0
            val stroke = KeyStroke.getKeyStroke(key, modifiers)
            rootPane.getInputMap(JComponent.WHEN_IN_FOCUSED_WINDOW).put(stroke, id)
            rootPane.actionMap.put(id, object : AbstractAction() {
                override fun actionPerformed(event: ActionEvent) = action()
            })
            menu.add(JMenuItem(label).apply {
                accelerator = stroke
                addActionListener { action() }
            })
        }
        item("Open Folder…", "open-folder", KeyEvent.VK_O, action = ::chooseFolder)
        item("New Buffer", "new-buffer", KeyEvent.VK_N, action = ::newBuffer)
        item("Save", "save", KeyEvent.VK_S) { save() }
        item("Save to New File…", "save-as", KeyEvent.VK_S, shift = true) { save(copy = true) }
        item("Close Tab", "close-tab", KeyEvent.VK_W) { activeTab?.let(::closeTab) }
        menu.addSeparator()
        item("Undo", "undo", KeyEvent.VK_Z) { activeTab?.undo() }
        item("Redo", "redo", KeyEvent.VK_Y) { activeTab?.redo() }
        rootPane.getInputMap(JComponent.WHEN_IN_FOCUSED_WINDOW)
            .put(KeyStroke.getKeyStroke(KeyEvent.VK_Z, shortcut or InputEvent.SHIFT_DOWN_MASK), "redo")
        item("Find…", "find", KeyEvent.VK_F) { find.open() }
        item("Replace…", "replace", KeyEvent.VK_H) { find.open(withReplace = true) }
        menu.addSeparator()
        item("Split Editor", "split", KeyEvent.VK_BACK_SLASH) { activeTab?.split() }
        item("Toggle Explorer", "explorer", KeyEvent.VK_B, action = sidebar::toggleExplorer)
        item("Editor Settings", "settings", KeyEvent.VK_COMMA, action = sidebar::toggleSettings)
        return menu
    }

    private inline fun attempt(action: () -> Unit) {
        try {
            action()
        } catch (error: Exception) {
            showError(error)
        }
    }

    private fun showError(error: Exception) {
        JOptionPane.showMessageDialog(this, error.message ?: error.toString(), "Nishi", JOptionPane.ERROR_MESSAGE)
    }
}
