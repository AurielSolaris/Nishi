package dev.nishi.desktop

import java.awt.Color
import java.awt.image.BufferedImage
import javax.swing.JButton
import javax.swing.SwingUtilities
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class WorkbenchIconsTest {
    @Test
    fun lucideSvgInheritsTheButtonColorAtHiDpiScale() {
        SwingUtilities.invokeAndWait {
            val foreground = Color(0x78B3F1)
            val button = JButton().apply { this.foreground = foreground }
            val icon = WorkbenchIcons.glyph("minus", 16)
            val image = BufferedImage(40, 40, BufferedImage.TYPE_INT_ARGB)
            val graphics = image.createGraphics()
            try {
                graphics.scale(2.0, 2.0)
                icon.paintIcon(button, graphics, 2, 2)
            } finally {
                graphics.dispose()
            }

            assertEquals(0, image.getRGB(2, 2))
            assertTrue((16..23).any { image.getRGB(20, it) == foreground.rgb })
        }
    }
}
