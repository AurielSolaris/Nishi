package dev.nishi.workspace

import dev.nishi.editor.Language
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.util.Locale

data class ServerDetection(
    val command: String,
    val executable: Path?,
    val projectRoot: Path,
)

/** Inspects project markers and PATH. Launching or validating a server is a separate operation. */
class LanguageServerDetector(
    searchPath: String = System.getenv("PATH").orEmpty(),
    private val windows: Boolean = System.getProperty("os.name").startsWith("Windows", ignoreCase = true),
    pathExt: String = System.getenv("PATHEXT") ?: ".COM;.EXE;.BAT;.CMD",
) {
    private val directories = searchPath.split(File.pathSeparatorChar).mapNotNull { raw ->
        try {
            Path.of(raw.trim().removeSurrounding("\"")).takeIf { it.isAbsolute }
        } catch (_: InvalidPathException) {
            null
        }
    }.distinct()
    private val suffixes = if (windows) {
        pathExt.split(';').map { it.lowercase(Locale.ROOT) }
            .filter { it in executableSuffixes }.ifEmpty { executableSuffixes.toList() }.distinct()
    } else listOf("")

    fun supports(language: Language): Boolean = language in servers

    fun detect(language: Language, workspace: Workspace, file: WorkspaceFile): ServerDetection? {
        val server = servers[language] ?: return null
        require(file.root == workspace.root) { "This file belongs to a different workspace." }
        val folder = try {
            workspace.containingDirectory(file)
        } catch (_: IOException) {
            workspace.root
        }
        val project = generateSequence(folder) { it.parent?.takeIf { path -> path.startsWith(workspace.root) } }
            .firstOrNull { directory ->
                server.markers.any { marker -> Files.isRegularFile(directory.resolve(marker), NOFOLLOW_LINKS) }
            } ?: workspace.root
        val executable = server.commands.firstNotNullOfOrNull { command ->
            directories.firstNotNullOfOrNull { directory ->
                suffixes.firstNotNullOfOrNull { suffix ->
                    directory.resolve(command + suffix).takeIf { path ->
                        Files.isRegularFile(path) && (windows || Files.isExecutable(path))
                    }
                }
            }
        }
        return ServerDetection(server.commands.first(), executable, project)
    }

    private data class Server(val commands: List<String>, val markers: List<String>)

    companion object {
        private val executableSuffixes = setOf(".com", ".exe", ".bat", ".cmd")
        private val gradle = listOf("settings.gradle.kts", "settings.gradle", "build.gradle.kts", "build.gradle", "pom.xml")
        private val web = listOf("package.json")
        private val typescript = Server(listOf("typescript-language-server"), listOf("tsconfig.json", "jsconfig.json") + web)
        private val stylesheet = Server(listOf("vscode-css-language-server"), web)
        private val json = Server(listOf("vscode-json-language-server"), web)
        private val servers = mapOf(
            Language.KOTLIN to Server(listOf("kotlin-lsp", "intellij-server", "kotlin-language-server"), gradle),
            Language.JAVA to Server(listOf("jdtls"), gradle),
            Language.HTML to Server(listOf("vscode-html-language-server"), web),
            Language.CSS to stylesheet,
            Language.SCSS to stylesheet,
            Language.JAVASCRIPT to typescript,
            Language.JSX to typescript,
            Language.TYPESCRIPT to typescript,
            Language.TSX to typescript,
            Language.BASH to Server(listOf("bash-language-server"), emptyList()),
            Language.PYTHON to Server(listOf("pyright-langserver", "pylsp"), listOf("pyrightconfig.json", "pyproject.toml", "setup.py", "requirements.txt")),
            Language.GO to Server(listOf("gopls"), listOf("go.work", "go.mod")),
            Language.RUST to Server(listOf("rust-analyzer"), listOf("Cargo.toml", "rust-project.json")),
            Language.JSON to json,
            Language.JSONC to json,
        )
    }
}
