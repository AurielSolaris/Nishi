package dev.nishi.desktop

import dev.nishi.workspace.DraftJournal
import java.awt.Component
import java.awt.Container
import java.awt.GraphicsEnvironment
import java.awt.event.ActionEvent
import java.awt.event.WindowEvent
import java.nio.file.Files
import dev.nishi.editor.EditorDocument
import dev.nishi.editor.FileText
import dev.nishi.editor.Language
import javax.swing.JButton
import javax.swing.JTextField
import javax.swing.JTree
import javax.swing.SwingUtilities
import org.junit.Assume.assumeFalse
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NishiWindowTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun aTabSavesToItsOriginalFolderAndRestartsWithItsUnsavedDraft() {
        assumeFalse(GraphicsEnvironment.isHeadless())
        val first = temporary.newFolder("first").toPath()
        val second = temporary.newFolder("second").toPath()
        val journal = DraftJournal(temporary.newFolder("journal").toPath())
        Files.writeString(first.resolve("notes.txt"), "first\r\n")
        Files.writeString(second.resolve("notes.txt"), "second\r\n")

        SwingUtilities.invokeAndWait {
            val window = NishiWindow(journal)
            try {
                window.openFolder(first)
                val explorer = descendants(window.contentPane).filterIsInstance<JTree>().single()
                explorer.setSelectionRow(0)
                explorer.actionMap.get("open-file").actionPerformed(ActionEvent(explorer, 0, "open"))
                val tab = descendants(window.contentPane).filterIsInstance<EditorTab>().single { it.isVisible }
                tab.activeArea.append("saved\n")
                window.openFolder(second)
                window.rootPane.actionMap.get("save").actionPerformed(ActionEvent(window.rootPane, 0, "save"))

                assertEquals("first\r\nsaved\r\n", Files.readString(first.resolve("notes.txt")))
                assertEquals("second\r\n", Files.readString(second.resolve("notes.txt")))
                tab.activeArea.append("unsaved\n")
                window.dispatchEvent(WindowEvent(window, WindowEvent.WINDOW_CLOSING))
                assertEquals(first.toRealPath(), journal.recover().single().root)
            } finally {
                window.dispose()
            }

            val reopened = NishiWindow(journal)
            try {
                reopened.openFolder(second)
                reopened.recoverDrafts()
                val recovered = descendants(reopened.contentPane).filterIsInstance<EditorTab>().single { it.isVisible }
                assertTrue(recovered.state.isDirty)
                assertEquals("first\nsaved\nunsaved\n", recovered.activeArea.text)
                assertEquals(first.toRealPath(), recovered.binding?.workspace?.root)
            } finally {
                reopened.dispose()
            }
        }
    }

    @Test
    fun replacingRegexMatchesFromTheDockedBarIsOneUndoStep() {
        SwingUtilities.invokeAndWait {
            val original = "tag one, tag two"
            val tab = EditorTab(EditorDocument(FileText(original)), "sample", null, onEdit = {}, onCaretMove = {})
            val find = FindBar { tab }
            find.open(withReplace = true)
            val controls = descendants(find).toList()
            val fields = controls.filterIsInstance<JTextField>()
            val buttons = controls.filterIsInstance<JButton>()
            fields.single { it.toolTipText == "Find" }.text = "(?<=tag )(one|two)"
            fields.single { it.toolTipText == "Replace" }.text = "$1!"
            buttons.single { it.toolTipText == "Regular expression" }.doClick(0)
            buttons.single { it.text == "Replace all" }.doClick(0)

            assertEquals("tag one!, tag two!", tab.activeArea.text)
            tab.undo()
            assertEquals(original, tab.activeArea.text)
        }
    }

    @Test
    fun savesAndReopensAnIndividualFileWithoutMountingItsFolder() {
        assumeFalse(GraphicsEnvironment.isHeadless())
        val path = temporary.newFolder("standalone").toPath().resolve("note.txt")
        val modes = mutableListOf<FilePickerMode>()
        val picker = FilePicker { _, mode, directory, _ ->
            assertEquals(null, directory)
            modes.add(mode)
            path
        }
        val journal = DraftJournal(temporary.newFolder("journal").toPath())
        SwingUtilities.invokeAndWait {
            val window = NishiWindow(journal, picker)
            try {
                command(window, "new-buffer")
                val tab = descendants(window.contentPane).filterIsInstance<EditorTab>().single()
                tab.activeArea.append("standalone\n")
                command(window, "save")
                assertEquals("standalone\n", Files.readString(path))
                assertEquals(path.fileName.toString(), tab.nameForTab)
                tab.activeArea.append("updated\n")
                command(window, "save")
                assertEquals("standalone\nupdated\n", Files.readString(path))
                command(window, "open-file")
                assertEquals(1, descendants(window.contentPane).filterIsInstance<EditorTab>().count())
                assertEquals(0, descendants(window.contentPane).filterIsInstance<JTree>().single().rowCount)
                assertEquals(listOf(FilePickerMode.SAVE, FilePickerMode.OPEN), modes)
            } finally {
                window.dispose()
            }
        }
    }

    @Test
    fun statusButtonOpensThePickerAndAutoDetectRestoresTheFileLanguage() {
        assumeFalse(GraphicsEnvironment.isHeadless())
        val workspace = temporary.newFolder("files").toPath()
        Files.writeString(workspace.resolve("sample.kt"), "val answer = 42")
        val journal = DraftJournal(temporary.newFolder("journal").toPath())
        SwingUtilities.invokeAndWait {
            val window = NishiWindow(journal)
            try {
                window.openFolder(workspace)
                val explorer = descendants(window.contentPane).filterIsInstance<JTree>().single()
                explorer.setSelectionRow(0)
                explorer.actionMap.get("open-file").actionPerformed(ActionEvent(explorer, 0, "open"))
                val tab = descendants(window.contentPane).filterIsInstance<EditorTab>().single()
                val button = descendants(window.contentPane).filterIsInstance<JButton>().single { it.name == "language-mode" }
                val picker = descendants(window.contentPane).filterIsInstance<LanguagePicker>().single()
                val filter = descendants(picker).filterIsInstance<JTextField>().single()

                assertEquals("Kotlin", button.text)
                button.doClick(0)
                assertTrue(picker.isVisible)
                filter.text = "typescript"
                filter.postActionEvent()
                assertEquals(Language.TYPESCRIPT, tab.language)
                assertEquals("TypeScript", button.text)
                assertEquals(false, tab.state.isDirty)
                button.doClick(0)
                filter.text = "auto detect"
                filter.postActionEvent()
                assertEquals(Language.KOTLIN, tab.language)
                assertEquals(null, tab.languageOverride)
                assertEquals(false, picker.isVisible)
            } finally {
                window.dispose()
            }
        }
    }

    private fun command(window: NishiWindow, key: String) {
        window.rootPane.actionMap.get(key).actionPerformed(ActionEvent(window.rootPane, 0, key))
    }

    private fun descendants(parent: Container): Sequence<Component> = sequence {
        for (child in parent.components) {
            yield(child)
            if (child is Container) yieldAll(descendants(child))
        }
    }
}
