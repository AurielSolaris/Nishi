# Editor features

These capabilities are available in the Kotlin/JVM workbench. Windows is the tested platform.

## Editing and navigation

- **Files and workspaces.** Open an individual UTF-8 file or browse a folder in the explorer.
- **Split views.** Each view has its own caret and shares the document and undo history with the other view.
- **Find and replace.** Enable case matching, whole-word matching, or regular expressions. Replace All can be undone in a single step.
- **Editor controls.** Set font size, tab width, line wrapping, line numbers, and current-line highlighting for the current session.

## Highlighting and language modes

Bundled TextMate grammars cover HTML, CSS, SCSS, JavaScript, TypeScript, JSX, TSX, Java, Kotlin, Groovy, Bash, Batch, Go, JSON, JSONC, Markdown, Python, and Rust. Nishi also highlights embedded CSS and JavaScript in HTML and supported fenced blocks in Markdown.

The language picker lets you select a mode per tab or return to filename detection. The status bar reports matching language-server commands on `PATH`. Language-server connections, completion, diagnostics, and semantic highlighting are [planned](/roadmap/#planned).

## Saves and recovery

Nishi preserves a file’s line-ending style and UTF-8 byte-order mark, checks for external changes before overwriting, and keeps each open tab attached to its original workspace. A local journal restores unsaved edits as drafts on the next launch and flags disk conflicts in the tab strip.

[Learn the workbench controls](/docs/)
