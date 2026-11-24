package dev.nishi.workspace

import dev.nishi.editor.Language
import java.io.File
import java.nio.file.Files
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LanguageServerDetectorTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun findsWindowsShimsOnPathAndUsesTheClosestProjectMarker() {
        val workspace = Workspace.open(temporary.newFolder("workspace").toPath())
        val folder = Files.createDirectories(workspace.root.resolve("packages/site/src"))
        Files.writeString(workspace.root.resolve("package.json"), "{}")
        Files.writeString(folder.parent.resolve("tsconfig.json"), "{}")
        Files.writeString(folder.resolve("view.tsx"), "export default <div />;")
        val bin = temporary.newFolder("bin").toPath()
        val launcher = Files.writeString(bin.resolve("typescript-language-server.cmd"), "this file is never executed")
        val detector = LanguageServerDetector(
            searchPath = listOf("relative", "\"$bin\"").joinToString(File.pathSeparator),
            windows = true,
            pathExt = ".EXE;.CMD",
        )

        val result = detector.detect(Language.TSX, workspace, workspace.file("packages/site/src/view.tsx"))
        assertEquals(ServerDetection("typescript-language-server", launcher, folder.parent), result)
    }

    @Test
    fun missingServerAndUnsupportedLanguageHaveDistinctResults() {
        val parent = temporary.newFolder("outside").toPath()
        Files.writeString(parent.resolve("settings.gradle.kts"), "")
        val workspace = Workspace.open(Files.createDirectory(parent.resolve("workspace")))
        val file = workspace.file("sample.kt")
        val detector = LanguageServerDetector(searchPath = "")

        assertEquals(ServerDetection("kotlin-lsp", null, workspace.root), detector.detect(Language.KOTLIN, workspace, file))
        assertNull(detector.detect(Language.PLAIN_TEXT, workspace, file))
    }
}
