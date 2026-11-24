package dev.nishi.desktop

import dev.nishi.editor.EditorDocument
import dev.nishi.editor.FileText
import javax.swing.JSplitPane
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.SwingUtilities
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

class EditorTabTest {
    @Test
    fun splitViewsShareTextAndUndoButKeepIndependentCarets() {
        SwingUtilities.invokeAndWait {
            val document = EditorDocument(FileText("abc"))
            val tab = EditorTab(document, "sample", null, onEdit = {}, onCaretMove = {})
            val left = tab.activeArea
            left.caretPosition = 1
            tab.split()
            val split = tab.getComponent(0) as JSplitPane
            val right = (split.rightComponent as JScrollPane).viewport.view as JTextArea
            right.caretPosition = 2

            assertSame(left.document, right.document)
            assertEquals(1, left.caretPosition)
            right.append("d")
            assertEquals("abcd", left.text)
            assertEquals("abcd", document.snapshot().content.text)
            assertTrue(document.isDirty)
            tab.undo()
            assertEquals("abc", right.text)
            tab.redo()
            assertEquals("abcd", left.text)
        }
    }
}
