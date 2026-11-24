# Contributing

Open a [GitHub issue](https://github.com/AurielSolaris/Nishi/issues) with steps to reproduce a problem, your OS and JDK, and relevant logs that are safe to share. For a code change, fork the repository, create a branch, and open a pull request with the behavior changed and the checks you ran.

## Project layout

| Module | Responsibility |
| --- | --- |
| `editor-core` | Document revisions, snapshots, text format, and syntax tokenization |
| `workspace-io` | File paths, conflict-aware saves, drafts, and language-server detection |
| `desktop` | Swing workbench, editing commands, and application packaging |
| `site` | Static marketing and documentation website |

## Check a desktop change

On Windows run:

```powershell
.\gradlew.bat check
```

Use `./gradlew check` with the Unix wrapper. The [source setup](/download/) explains the JDK requirement and how to launch the editor.

For site changes, use the npm commands in the website README in the `site` directory.
