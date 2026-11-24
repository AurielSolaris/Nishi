package dev.nishi.desktop

import java.awt.Component
import java.nio.file.Path
import javax.swing.JFileChooser

internal enum class FilePickerMode { OPEN, SAVE }

internal fun interface FilePicker {
    fun choose(owner: Component, mode: FilePickerMode, directory: Path?, suggestedName: String?): Path?
}

internal val desktopFilePicker = FilePicker { owner, mode, directory, suggestedName ->
    val picker = JFileChooser(directory?.toFile()).apply {
        fileSelectionMode = JFileChooser.FILES_ONLY
        dialogTitle = if (mode == FilePickerMode.SAVE) "Save to New File" else "Open File"
        if (suggestedName != null) selectedFile = currentDirectory.toPath().resolve(suggestedName).toFile()
    }
    val answer = when (mode) {
        FilePickerMode.OPEN -> picker.showOpenDialog(owner)
        FilePickerMode.SAVE -> picker.showSaveDialog(owner)
    }
    picker.selectedFile?.toPath()?.takeIf { answer == JFileChooser.APPROVE_OPTION }
}
