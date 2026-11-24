package dev.nishi.editor

import org.eclipse.tm4e.core.TMException
import org.eclipse.tm4e.core.grammar.IStateStack
import org.eclipse.tm4e.core.registry.IGrammarSource
import org.eclipse.tm4e.core.registry.IRegistryOptions
import org.eclipse.tm4e.core.registry.Registry
import java.time.Duration
import java.util.logging.Level
import java.util.logging.Logger

enum class SyntaxKind {
    KEYWORD, STRING, NUMBER, COMMENT, TYPE, PROPERTY, HEADING, TAG,
    FUNCTION, VARIABLE, PARAMETER, CONSTANT, OPERATOR, PUNCTUATION, ESCAPE, MARKUP, INVALID,
}

data class SyntaxToken(val start: Int, val end: Int, val kind: SyntaxKind)

class SyntaxState internal constructor(internal val ruleStack: IStateStack?) {
    companion object {
        val Initial = SyntaxState(null)
    }
}

data class SyntaxLine(val tokens: List<SyntaxToken>, val nextState: SyntaxState)

/** Stateful TextMate tokenization. The UI owns line caching and paints the resulting spans. */
class SyntaxLexer(private val language: Language) {
    private val grammar by lazy { TextMateGrammars.load(language) }
    private var failed = false

    fun line(text: String, previous: SyntaxState = SyntaxState.Initial): SyntaxLine {
        if (failed || text.length > maxLineLength) return SyntaxLine(emptyList(), SyntaxState.Initial)
        val result = try {
            grammar?.tokenizeLine(text, previous.ruleStack, lineTimeLimit)
        } catch (error: TMException) {
            failed = true
            logger.log(Level.WARNING, "Unable to tokenize ${language.label} with TextMate", error)
            null
        } ?: return SyntaxLine(emptyList(), SyntaxState.Initial)
        if (result.isStoppedEarly) return SyntaxLine(emptyList(), SyntaxState.Initial)
        val codePointCount = text.codePointCount(0, text.length)
        val utf16Offsets = if (codePointCount == text.length) null else codePointOffsets(text, codePointCount)
        val tokens = ArrayList<SyntaxToken>()
        for (token in result.tokens) {
            val last = minOf(token.endIndex, codePointCount)
            if (token.startIndex >= last) continue // TextMate also tokenizes the line terminator.
            val start = utf16Offsets?.get(token.startIndex) ?: token.startIndex
            val end = utf16Offsets?.get(last) ?: last
            val kind = token.scopes.syntaxKind() ?: continue
            val previousToken = tokens.lastOrNull()
            if (previousToken != null && previousToken.end == start && previousToken.kind == kind) {
                tokens[tokens.lastIndex] = previousToken.copy(end = end)
            } else {
                tokens.add(SyntaxToken(start, end, kind))
            }
        }
        return SyntaxLine(tokens, SyntaxState(result.ruleStack))
    }

    // TM4E/Joni reports Unicode code-point offsets, while the Swing document uses UTF-16.
    private fun codePointOffsets(text: String, count: Int): IntArray {
        var offset = 0
        return IntArray(count + 1) { index ->
            val start = offset
            if (index < count) offset += Character.charCount(text.codePointAt(offset))
            start
        }
    }

    private companion object {
        val logger: Logger = Logger.getLogger(SyntaxLexer::class.java.name)
        const val maxLineLength = 20_000
        // A grammar compiles new rules lazily the first time it sees a construct.
        val lineTimeLimit: Duration = Duration.ofSeconds(1)
    }
}

private object TextMateGrammars {
    private val scopeByLanguage = mapOf(
        Language.HTML to "text.html.basic",
        Language.CSS to "source.css",
        Language.SCSS to "source.css.scss",
        Language.JAVASCRIPT to "source.js",
        Language.JSX to "source.js.jsx",
        Language.TYPESCRIPT to "source.ts",
        Language.TSX to "source.tsx",
        Language.JAVA to "source.java",
        Language.KOTLIN to "source.kotlin",
        Language.GROOVY to "source.groovy",
        Language.BASH to "source.shell",
        Language.BATCH to "source.batchfile",
        Language.GO to "source.go",
        Language.JSON to "source.json",
        Language.JSONC to "source.json.comments",
        Language.MARKDOWN to "text.html.markdown",
        Language.PYTHON to "source.python",
        Language.RUST to "source.rust",
    )

    private val registry = Registry(object : IRegistryOptions {
        override fun getGrammarSource(scopeName: String): IGrammarSource? {
            val resource = "grammars/$scopeName.tmLanguage"
            val owner = TextMateGrammars::class.java
            return when {
                owner.getResource("$resource.json") != null -> IGrammarSource.fromResource(owner, "$resource.json")
                owner.getResource(resource) != null -> IGrammarSource.fromResource(owner, resource)
                else -> null
            }
        }

        override fun getInjections(scopeName: String): Collection<String> = when (scopeName) {
            "source.js", "source.js.jsx" -> listOf("documentation.injection.js.jsx")
            "source.ts", "source.tsx" -> listOf("documentation.injection.ts")
            "text.html.markdown" -> listOf("markdown.kotlin.codeblock")
            else -> emptyList()
        }
    })

    @Synchronized
    fun load(language: Language) = scopeByLanguage[language]?.let(registry::loadGrammar)
}

private fun List<String>.syntaxKind(): SyntaxKind? {
    for (index in lastIndex downTo 0) {
        val scope = this[index]
        val kind = when {
            scope.isScope("meta.embedded") -> return null
            scope.isScope("invalid") -> SyntaxKind.INVALID
            scope.isScope("comment") -> SyntaxKind.COMMENT
            scope.isScope("constant.character.escape") || scope.isScope("constant.character.entity") -> SyntaxKind.ESCAPE
            scope.isScope("constant.numeric") || scope.isScope("constant.other.color") -> SyntaxKind.NUMBER
            scope.isScope("constant") || scope.isScope("variable.language") || scope.isScope("support.constant") -> SyntaxKind.CONSTANT
            scope.isScope("entity.name.function") || scope.isScope("support.function") -> SyntaxKind.FUNCTION
            scope.isScope("entity.name.tag") || scope.isScope("punctuation.definition.tag") -> SyntaxKind.TAG
            scope.isScope("entity.name.type") || scope.isScope("entity.name.class") ||
                scope.isScope("entity.name.namespace") || scope.isScope("support.class") ||
                (scope.isScope("support.type") && !scope.isScope("support.type.property-name")) -> SyntaxKind.TYPE
            scope.isScope("entity.other.attribute-name") || scope.isScope("support.type.property-name") ||
                scope.isScope("support.variable.property") || scope.isScope("support.variable.object") ||
                (scope.isScope("variable.other") && ".property" in scope) -> SyntaxKind.PROPERTY
            scope.isScope("variable.parameter") -> SyntaxKind.PARAMETER
            scope.isScope("variable") -> SyntaxKind.VARIABLE
            scope.isScope("keyword.operator") || scope.isScope("punctuation.section.embedded") ||
                scope.isScope("punctuation.definition.template-expression") -> SyntaxKind.OPERATOR
            scope.isScope("keyword") || scope.isScope("storage") -> SyntaxKind.KEYWORD
            scope.isScope("entity.name.section") || scope.isScope("markup.heading") -> SyntaxKind.HEADING
            scope.isScope("markup") -> SyntaxKind.MARKUP
            scope.isScope("string") -> SyntaxKind.STRING
            scope.isScope("punctuation") && !scope.isScope("punctuation.definition.string") &&
                !scope.isScope("punctuation.definition.comment") -> SyntaxKind.PUNCTUATION
            else -> null
        }
        if (kind != null) return kind
    }
    return null
}

private fun String.isScope(selector: String): Boolean = this == selector || startsWith("$selector.")
