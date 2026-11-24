package dev.nishi.editor

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EditorDocumentTest {
    @Test
    fun olderSaveAndJournalAcknowledgementsDoNotCoverNewEdits() {
        val document = EditorDocument()
        document.replaceText("first edit")
        val written = document.snapshot()
        document.replaceText("later edit")

        document.markSaved(written)
        document.markJournalled(written)

        assertTrue(document.isDirty)
        assertFalse(document.isJournalled)
        assertEquals("later edit", document.snapshot().content.text)
        val current = document.snapshot()
        document.markJournalled(current)
        assertTrue(document.isJournalled)
        document.markSaved(current)
        assertFalse(document.isDirty)
    }

    @Test
    fun editingAndRecoveringKeepTheOriginalTextFormat() {
        val loaded = FileText.decode("\uFEFFone\r\ntwo\r\n")
        val document = EditorDocument(loaded)
        document.replaceText("ONE\ntwo\n")
        val recovered = EditorDocument(document.snapshot().content, recovered = true)
        val content = recovered.snapshot().content

        assertTrue(recovered.isDirty)
        assertTrue(recovered.isJournalled)
        assertEquals("\uFEFFONE\r\ntwo\r\n", content.format.encode(content.text))
    }
}
