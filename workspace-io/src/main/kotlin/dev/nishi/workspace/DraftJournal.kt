package dev.nishi.workspace

import dev.nishi.editor.FileText
import dev.nishi.editor.LineEnding
import dev.nishi.editor.TextFormat
import java.io.IOException
import java.nio.channels.Channels
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.nio.file.StandardOpenOption.WRITE
import java.util.Properties
import java.util.UUID

data class Draft(
    val id: UUID,
    val root: Path?,
    val relativePath: String?,
    val title: String,
    val baseFingerprint: String?,
    val content: FileText,
)

class DraftJournal(private val directory: Path) {
    fun put(draft: Draft) {
        val values = Properties().apply {
            setProperty("version", "1")
            draft.root?.let { setProperty("root", it.toString()) }
            draft.relativePath?.let { setProperty("path", it) }
            draft.baseFingerprint?.let { setProperty("baseFingerprint", it) }
            setProperty("title", draft.title)
            setProperty("lineEnding", draft.content.format.lineEnding.name)
            setProperty("bom", draft.content.format.hasBom.toString())
            setProperty("text", draft.content.text)
        }
        Files.createDirectories(directory)
        val temporary = Files.createTempFile(directory, ".draft-", ".tmp")
        try {
            FileChannel.open(temporary, WRITE).use { channel ->
                values.store(Channels.newOutputStream(channel), null)
                channel.force(true)
            }
            Files.move(temporary, recordPath(draft.id), ATOMIC_MOVE, REPLACE_EXISTING)
        } finally {
            Files.deleteIfExists(temporary)
        }
    }

    fun drop(id: UUID) {
        Files.deleteIfExists(recordPath(id))
    }

    fun recover(): List<Draft> {
        if (!Files.exists(directory)) return emptyList()
        return Files.list(directory).use { files ->
            files.iterator().asSequence()
                .filter { it.fileName.toString().endsWith(".properties") }
                .mapNotNull(::read)
                .sortedBy { it.title }
                .toList()
        }
    }

    private fun read(path: Path): Draft? = try {
        val id = UUID.fromString(path.fileName.toString().removeSuffix(".properties"))
        val values = Properties()
        Files.newInputStream(path).use { values.load(it) }
        require(values.getProperty("version") == "1")
        val root = values.getProperty("root")?.let(Path::of)
        val relativePath = values.getProperty("path")
        require(relativePath == null || root != null)
        Draft(
            id = id,
            root = root,
            relativePath = relativePath,
            title = requireNotNull(values.getProperty("title")),
            baseFingerprint = values.getProperty("baseFingerprint"),
            content = FileText(
                requireNotNull(values.getProperty("text")),
                TextFormat(
                    LineEnding.valueOf(requireNotNull(values.getProperty("lineEnding"))),
                    requireNotNull(values.getProperty("bom")).toBooleanStrict(),
                ),
            ),
        )
    } catch (_: IOException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    private fun recordPath(id: UUID): Path = directory.resolve("$id.properties")
}
