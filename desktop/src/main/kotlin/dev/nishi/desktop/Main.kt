package dev.nishi.desktop

import dev.nishi.workspace.DraftJournal
import java.nio.file.Path
import javax.swing.SwingUtilities

fun main(args: Array<String>) {
    SwingUtilities.invokeLater {
        Night.install()
        val location = Path.of(System.getProperty("user.home"), ".nishi", "kotlin-journal")
        val window = NishiWindow(DraftJournal(location))
        window.isVisible = true
        args.firstOrNull()?.let { window.openFolder(Path.of(it)) }
        window.recoverDrafts()
    }
}
