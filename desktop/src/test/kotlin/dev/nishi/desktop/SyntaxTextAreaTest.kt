package dev.nishi.desktop

import dev.nishi.editor.EditorDocument
import dev.nishi.editor.FileText
import dev.nishi.editor.SyntaxKind
import java.awt.image.BufferedImage
import javax.swing.SwingUtilities
import kotlin.test.Test
import kotlin.test.assertTrue

class SyntaxTextAreaTest {
    @Test
    fun paintsSyntaxInBothWrappedAndUnwrappedViewsAndInvalidatesLaterLines() {
        SwingUtilities.invokeAndWait {
            val tab = EditorTab(
                EditorDocument(FileText("/*\nval answer = 42\n")), "Example.kt", null,
                onEdit = {}, onCaretMove = {},
            )
            val area = tab.activeArea
            area.setSize(210, 120)
            assertTrue(paintsColor(area, SyntaxKind.COMMENT))
            tab.replaceRange(0, 2, "")
            assertTrue(paintsColor(area, SyntaxKind.KEYWORD))
            assertTrue(paintsColor(area, SyntaxKind.NUMBER))
            tab.applyAppearance(EditorAppearance(wordWrap = true))
            assertTrue(paintsColor(area, SyntaxKind.KEYWORD))
            assertTrue(paintsColor(area, SyntaxKind.NUMBER))
        }
    }

    private fun paintsColor(area: javax.swing.JTextArea, kind: SyntaxKind): Boolean {
        val image = BufferedImage(area.width, area.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            area.paint(graphics)
        } finally {
            graphics.dispose()
        }
        val expected = syntaxColors.getValue(kind).rgb
        return (0 until image.height).any { y -> (0 until image.width).any { x -> image.getRGB(x, y) == expected } }
    }
}
