package dev.nishi.editor

enum class LineEnding(val characters: String) {
    LF("\n"),
    CRLF("\r\n"),
    CR("\r"),
}

data class TextFormat(val lineEnding: LineEnding = LineEnding.LF, val hasBom: Boolean = false) {
    fun encode(text: String): String =
        (if (hasBom) "\uFEFF" else "") + text.replace("\n", lineEnding.characters)
}

data class FileText(val text: String, val format: TextFormat = TextFormat()) {
    companion object {
        fun decode(raw: String): FileText {
            val hasBom = raw.startsWith('\uFEFF')
            val text = raw.removePrefix("\uFEFF")
            val lineEnding = when {
                "\r\n" in text -> LineEnding.CRLF
                '\n' in text -> LineEnding.LF
                '\r' in text -> LineEnding.CR
                else -> LineEnding.LF
            }
            return FileText(text.replace("\r\n", "\n").replace('\r', '\n'), TextFormat(lineEnding, hasBom))
        }
    }
}

/** Owned by the editor thread. Background I/O receives immutable snapshots. */
class EditorDocument(initial: FileText = FileText(""), recovered: Boolean = false) {
    class Snapshot internal constructor(val revision: Long, val content: FileText)

    private var text = initial.text
    private val format = initial.format
    private var revision = 0L
    private var savedRevision = if (recovered) -1L else 0L
    private var journalledRevision = if (recovered) 0L else -1L

    val isDirty: Boolean get() = revision != savedRevision
    val isJournalled: Boolean get() = revision == journalledRevision

    fun replaceText(value: String) {
        if (value != text) {
            text = value
            revision++
        }
    }

    fun snapshot(): Snapshot = Snapshot(revision, FileText(text, format))

    fun markSaved(snapshot: Snapshot) {
        savedRevision = snapshot.revision
    }

    fun markJournalled(snapshot: Snapshot) {
        journalledRevision = snapshot.revision
    }
}
