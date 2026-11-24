package dev.nishi.workspace

import dev.nishi.editor.FileText
import java.nio.file.Files
import java.util.UUID
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class WorkspaceTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun switchingFoldersKeepsExistingFilesBoundToTheirOriginalRoot() {
        val first = Workspace.open(temporary.newFolder("first").toPath())
        val second = Workspace.open(temporary.newFolder("second").toPath())
        val firstFile = first.file("notes.txt")
        val secondFile = second.file("notes.txt")
        val fingerprint = first.save(firstFile, FileText("first"), null)
        second.save(secondFile, FileText("second"), null)

        assertNotEquals(firstFile, secondFile)
        assertFailsWith<IllegalArgumentException> { second.read(firstFile) }
        first.save(firstFile, FileText("updated first"), fingerprint)
        assertEquals("updated first", first.read(firstFile).content.text)
        assertEquals("second", second.read(secondFile).content.text)
    }

    @Test
    fun saveRefusesExternalChangesAndExistingSaveAsTargets() {
        val workspace = Workspace.open(temporary.newFolder().toPath())
        val file = workspace.file("notes.txt")
        val fingerprint = workspace.save(file, FileText("original"), null)
        Files.writeString(workspace.root.resolve(file.relativePath), "external")

        assertFailsWith<SaveConflict> { workspace.save(file, FileText("unsaved"), fingerprint) }
        assertFailsWith<SaveConflict> { workspace.save(file, FileText("copy"), null) }
        assertEquals("external", workspace.read(file).content.text)
    }

    @Test
    fun rejectsInvalidSegmentsAndKeepsPercentSequencesLiteral() {
        val workspace = Workspace.open(temporary.newFolder().toPath())
        for (name in listOf("../a", "/a", "a//b", "con.txt", "a:b", "a.", "a\\b")) {
            assertFailsWith<IllegalArgumentException>(name) { workspace.file(name) }
        }
        val literal = workspace.file("%2e%2e")
        workspace.save(literal, FileText("literal"), null)
        assertTrue(Files.isRegularFile(workspace.root.resolve("%2e%2e")))
    }

    @Test
    fun aFreshJournalInstanceRecoversTextFormatWorkspaceAndBaseRevision() {
        val workspace = Workspace.open(temporary.newFolder("project").toPath())
        val journalPath = temporary.newFolder("drafts").toPath()
        val draft = Draft(
            UUID.randomUUID(), workspace.root, "notes.txt", "notes.txt",
            "saved fingerprint", FileText.decode("\uFEFFunsaved\r\nλα\r\n"),
        )
        DraftJournal(journalPath).put(draft)
        val reopened = DraftJournal(journalPath)

        assertEquals(listOf(draft), reopened.recover())
        reopened.drop(draft.id)
        assertTrue(reopened.recover().isEmpty())
    }
}
