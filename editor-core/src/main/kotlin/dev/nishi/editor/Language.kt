package dev.nishi.editor

enum class Language(val label: String, vararg extensions: String) {
    PLAIN_TEXT("Plain text", "txt"),
    KOTLIN("Kotlin", "kt", "kts"),
    JAVA("Java", "java"),
    GROOVY("Groovy", "gradle", "groovy"),
    HTML("HTML", "html", "htm", "xhtml"),
    CSS("CSS", "css"),
    SCSS("SCSS", "scss"),
    JAVASCRIPT("JavaScript", "js", "mjs", "cjs"),
    JSX("JSX", "jsx"),
    TYPESCRIPT("TypeScript", "ts", "mts", "cts"),
    TSX("TSX", "tsx"),
    BASH("Bash", "sh", "bash"),
    BATCH("Batch", "bat", "cmd"),
    PYTHON("Python", "py", "pyi"),
    RUST("Rust", "rs"),
    GO("Go", "go"),
    JSON("JSON", "json"),
    JSONC("JSON with comments", "jsonc"),
    MARKDOWN("Markdown", "md", "markdown");

    private val suffixes = extensions

    companion object {
        private val languagesBySuffix = entries.flatMap { language ->
            language.suffixes.map { it to language }
        }.toMap()

        fun fromFilename(filename: String): Language {
            val name = filename.lowercase()
            return when (name) {
                "gradlew", ".bashrc", ".bash_profile", ".bash_login", ".bash_logout" -> BASH
                else -> languagesBySuffix[name.substringAfterLast('.', "")] ?: PLAIN_TEXT
            }
        }
    }
}
