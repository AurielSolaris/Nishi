package dev.nishi.editor

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SyntaxLexerTest {
    @Test
    fun defaultLanguagesUseBundledGrammars() {
        val samples = listOf(
            Triple("index.html", Language.HTML, """<main class="hero">Hello</main>"""),
            Triple("style.css", Language.CSS, ".hero { color: #ffaabb; }"),
            Triple("app.js", Language.JAVASCRIPT, "const n = 42;"),
            Triple("app.ts", Language.TYPESCRIPT, "interface Card { title: string }"),
            Triple("style.scss", Language.SCSS, "\$accent: #ffaabb; // theme"),
            Triple("view.jsx", Language.JSX, "const view = <Card disabled />;"),
            Triple("view.tsx", Language.TSX, "const view = <div>{value as string}</div>;"),
            Triple("Hello.java", Language.JAVA, "public class Hello {}"),
            Triple("build.gradle.kts", Language.KOTLIN, "val name = \"nishi\""),
            Triple("gradlew", Language.BASH, "if test -n \$JAVA_HOME; then"),
            Triple("script.bash", Language.BASH, "echo 'hello' # comment"),
            Triple("gradlew.bat", Language.BATCH, "@echo %JAVA_HOME%"),
            Triple("build.gradle", Language.GROOVY, "def version = 2"),
            Triple("main.go", Language.GO, "func main() {}"),
            Triple("data.json", Language.JSON, """{"key": true}"""),
            Triple("settings.jsonc", Language.JSONC, "// comment"),
            Triple("README.md", Language.MARKDOWN, "# Heading"),
            Triple("main.py", Language.PYTHON, "def main(): pass"),
            Triple("main.rs", Language.RUST, "fn main() {}"),
        )
        for ((filename, language, code) in samples) {
            assertEquals(language, Language.fromFilename(filename), filename)
            val tokens = SyntaxLexer(language).line(code).tokens
            assertTrue(tokens.any { it.kind != SyntaxKind.PUNCTUATION }, "$filename: $tokens")
            assertTrue(tokens.all { it.start >= 0 && it.end <= code.length && it.start < it.end }, filename)
        }
    }

    @Test
    fun highlightsDeclarationsParametersAndOperatorsBeyondKeywords() {
        val code = "function welcome(name: string) { return name + \"!\"; }"
        val line = SyntaxLexer(Language.TYPESCRIPT).line(code)
        assertToken(code, line, "welcome", SyntaxKind.FUNCTION)
        assertToken(code, line, "name", SyntaxKind.PARAMETER)
        assertToken(code, line, "+", SyntaxKind.OPERATOR)
        assertToken(code, line, "\"!\"", SyntaxKind.STRING)
    }

    @Test
    fun htmlDelegatesScriptAndStyleContentsToTheirGrammars() {
        val lexer = SyntaxLexer(Language.HTML)
        val script = lexer.line("<script>")
        val js = "const value = 42;"
        val jsLine = lexer.line(js, script.nextState)
        assertToken(js, jsLine, "const", SyntaxKind.KEYWORD)
        assertToken(js, jsLine, "42", SyntaxKind.NUMBER)
        val style = lexer.line("</script><style>", jsLine.nextState)
        val css = ".card { display: flex; }"
        assertToken(css, lexer.line(css, style.nextState), "display", SyntaxKind.PROPERTY)
    }

    @Test
    fun usesTsxGrammarForMultilineMarkupAndEmbeddedCode() {
        val lexer = SyntaxLexer(Language.TSX)
        val opening = lexer.line("return <Card")
        val props = "  title={name + \"!\"}"
        val line = lexer.line(props, opening.nextState)
        assertToken(props, line, "title", SyntaxKind.PROPERTY)
        assertToken(props, line, "+", SyntaxKind.OPERATOR)
        val closing = " />;"
        assertToken(closing, lexer.line(closing, line.nextState), "/>", SyntaxKind.TAG)
    }

    @Test
    fun multilineCommentAndFencedMarkdownKeepTheirGrammarState() {
        val kotlin = SyntaxLexer(Language.KOTLIN)
        val comment = kotlin.line("/* opening")
        val after = "still comment */ val x = 42"
        val line = kotlin.line(after, comment.nextState)
        assertToken(after, line, "still comment", SyntaxKind.COMMENT)
        assertToken(after, line, "val", SyntaxKind.KEYWORD)
        val markdown = SyntaxLexer(Language.MARKDOWN)
        val fence = markdown.line("```js")
        val js = "const n = 42;"
        assertToken(js, markdown.line(js, fence.nextState), "const", SyntaxKind.KEYWORD)
    }

    @Test
    fun markdownStrikethroughAndUtf16OffsetsRemainIntact() {
        val markdown = "Keep ~~obsolete~~ out of the new version."
        assertToken(markdown, SyntaxLexer(Language.MARKDOWN).line(markdown), "obsolete", SyntaxKind.MARKUP)

        val code = "const label = \"🌙\"; const count = 42;"
        val line = SyntaxLexer(Language.JAVASCRIPT).line(code)
        assertToken(code, line, "\"🌙\"", SyntaxKind.STRING)
        assertToken(code, line, "42", SyntaxKind.NUMBER)
    }

    private fun assertToken(code: String, line: SyntaxLine, text: String, kind: SyntaxKind) {
        val start = code.indexOf(text)
        assertTrue(start >= 0)
        assertTrue(
            line.tokens.any { it.start <= start && it.end >= start + text.length && it.kind == kind },
            "$text expected $kind in $code, got " + line.tokens.joinToString { "${code.substring(it.start, it.end)}=${it.kind}" },
        )
    }
}
