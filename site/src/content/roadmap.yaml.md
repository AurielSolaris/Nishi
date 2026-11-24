# Roadmap

The Kotlin rewrite keeps the project’s dark workbench and split editing while separating document state, workspace I/O, and the desktop shell.

## Available

Editing, workspace navigation, split views, find and replace, TextMate grammars, per-tab language modes, safer saves, and local draft recovery are in the current Kotlin source. See the [feature reference](/features/) for details.

## Planned

- File watching for external changes.
- Idle buffer eviction.
- Language-server connections, followed by capabilities such as completion and diagnostics. Current builds detect the matching server command locally.
- [Extensions and Lua support](/extensions/).
- An integrated terminal.

The project has no published delivery dates for these items. Follow [development on GitHub](https://github.com/AurielSolaris/Nishi/commits/main/) for the latest source changes.
