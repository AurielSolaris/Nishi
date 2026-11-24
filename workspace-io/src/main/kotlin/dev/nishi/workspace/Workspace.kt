package dev.nishi.workspace

import dev.nishi.editor.FileText
import java.io.IOException
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.nio.file.attribute.BasicFileAttributes
import java.nio.file.attribute.PosixFileAttributeView
import java.security.MessageDigest
import java.util.HexFormat

@ConsistentCopyVisibility
data class WorkspaceFile internal constructor(val root: Path, val relativePath: String) {
    val name: String get() = relativePath.substringAfterLast('/')
}

data class DirectoryEntry(val file: WorkspaceFile, val isDirectory: Boolean)
data class ReadFile(val content: FileText, val fingerprint: String)

class SaveConflict(file: WorkspaceFile) : IOException("${file.name} changed on disk. Save a copy to keep your edits.")

class Workspace private constructor(val root: Path) {
    val name: String get() = root.fileName?.toString() ?: root.toString()

    fun file(relativePath: String): WorkspaceFile {
        val segments = relativePath.split('/')
        require(segments.all(::validSegment)) { "Enter a valid path inside the workspace." }
        return WorkspaceFile(root, relativePath)
    }

    fun list(directory: WorkspaceFile? = null): List<DirectoryEntry> {
        val path = directory?.let { resolve(it, allowMissing = false) } ?: checkedRoot()
        return Files.list(path).use { paths ->
            paths.iterator().asSequence().mapNotNull { child ->
                val name = child.fileName.toString()
                if (name in ignored || !validSegment(name)) return@mapNotNull null
                val relative = directory?.let { "${it.relativePath}/$name" } ?: name
                val entry = file(relative)
                val target = try {
                    resolve(entry, allowMissing = false)
                } catch (_: IOException) {
                    return@mapNotNull null
                }
                when {
                    Files.isDirectory(target) && !path.startsWith(target) -> DirectoryEntry(entry, true)
                    Files.isRegularFile(target) -> DirectoryEntry(entry, false)
                    else -> null
                }
            }.sortedWith(compareBy<DirectoryEntry> { !it.isDirectory }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.file.name })
                .toList()
        }
    }

    fun read(file: WorkspaceFile): ReadFile {
        val path = resolve(file, allowMissing = false)
        if (!Files.isRegularFile(path)) throw IOException("Only regular text files can be opened.")
        val bytes = Files.newInputStream(path).use { it.readNBytes(maxFileBytes + 1) }
        if (bytes.size > maxFileBytes) throw IOException("This file exceeds the 8 MiB editor limit.")
        if (bytes.any { it == 0.toByte() }) throw IOException("This file contains binary data.")
        val text = UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        return ReadFile(FileText.decode(text), fingerprint(bytes))
    }

    fun save(file: WorkspaceFile, content: FileText, expectedFingerprint: String?): String {
        val target = resolve(file, allowMissing = true)
        val bytes = content.format.encode(content.text).toByteArray(UTF_8)
        if (bytes.size > maxFileBytes) throw IOException("This file exceeds the 8 MiB editor limit.")
        if (bytes.any { it == 0.toByte() }) throw IOException("The text contains a NUL character.")
        val temporary = Files.createTempFile(target.parent, ".nishi-save-", ".tmp")
        try {
            Files.write(temporary, bytes)
            val actual = try {
                read(file).fingerprint
            } catch (_: NoSuchFileException) {
                null
            }
            if (actual != expectedFingerprint || resolve(file, allowMissing = true) != target) throw SaveConflict(file)

            if (actual == null) {
                // The default move refuses to replace a file created since the check.
                Files.move(temporary, target)
            } else {
                Files.getFileAttributeView(target, PosixFileAttributeView::class.java)
                    ?.let { Files.setPosixFilePermissions(temporary, it.readAttributes().permissions()) }
                Files.move(temporary, target, ATOMIC_MOVE, REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temporary)
        }
        return fingerprint(bytes)
    }

    private fun resolve(file: WorkspaceFile, allowMissing: Boolean): Path {
        require(file.root == root) { "This file belongs to a different workspace." }
        val segments = file.relativePath.split('/')
        require(segments.all(::validSegment)) { "Invalid workspace path." }
        var path = checkedRoot()
        for ((index, segment) in segments.withIndex()) {
            val child = path.resolve(segment)
            try {
                Files.readAttributes(child, BasicFileAttributes::class.java, NOFOLLOW_LINKS)
            } catch (error: NoSuchFileException) {
                if (allowMissing && index == segments.lastIndex) return child
                throw error
            }
            path = child.toRealPath()
            if (!path.startsWith(root)) throw IOException("The path leads outside the workspace.")
        }
        return path
    }

    private fun checkedRoot(): Path {
        if (root.toRealPath() != root) throw IOException("The workspace folder has moved.")
        return root
    }

    companion object {
        private const val maxFileBytes = 8 * 1024 * 1024
        private val ignored = setOf(".git", ".gradle", ".idea", "node_modules", "build", "dist")
        private val deviceName = Regex("(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\\..*)?", RegexOption.IGNORE_CASE)

        fun open(directory: Path): Workspace {
            val root = directory.toRealPath()
            if (!Files.isDirectory(root)) throw IOException("Choose a workspace folder.")
            return Workspace(root)
        }

        private fun validSegment(segment: String): Boolean =
            segment.isNotEmpty() && segment.length <= 255 &&
                !segment.endsWith('.') && !segment.endsWith(' ') &&
                segment.none { it < ' ' || it == '\u007F' || it in "\\/:*?\"<>|" } &&
                !deviceName.matches(segment)

        private fun fingerprint(bytes: ByteArray): String =
            HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
    }
}
