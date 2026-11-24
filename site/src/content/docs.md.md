# Documentation

[Set up and launch Nishi](/download/#run-the-editor) with the Gradle wrapper, then open a local file or folder.

## Open and edit

1. Choose **Open File…** for a single file or **Open Folder…** to browse a workspace.
2. Choose **New** for an untitled buffer. **Save** opens a file chooser when the buffer has no path.
3. Use the split control at the right of the tab strip to open a second view of the same buffer. Edits and undo history are shared.
4. Click the language in the bottom-right status bar to open the searchable picker. Select a mode for the current tab or choose **Auto Detect** to restore filename-based selection.

For example, a file ending in `.kt` is detected as Kotlin.

```kotlin
fun main() {
    val editor = "Nishi"
    println("Hello, $editor")
}
```

## Recover unsaved edits

Nishi journals unsaved edits locally and reopens them as drafts on the next launch. A tab may show a disk conflict if its original file changed externally. Review the disk file and the recovered draft before deciding what to save.

## Windows shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+O` / `Ctrl+Shift+O` | Open file / open folder |
| `Ctrl+N` / `Ctrl+S` | New buffer / save |
| `Ctrl+F` / `Ctrl+H` | Find / replace |
| `Ctrl+Shift+L` | Select language mode |
| `Ctrl+\` | Toggle split view |
| `Ctrl+B` / `Ctrl+,` | Toggle explorer / editor settings |
