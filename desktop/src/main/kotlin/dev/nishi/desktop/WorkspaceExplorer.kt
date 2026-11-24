package dev.nishi.desktop

import dev.nishi.workspace.DirectoryEntry
import dev.nishi.workspace.Workspace
import dev.nishi.workspace.WorkspaceFile
import java.awt.Graphics
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.AbstractAction
import javax.swing.JTree
import javax.swing.KeyStroke
import javax.swing.SwingUtilities
import javax.swing.event.TreeExpansionEvent
import javax.swing.event.TreeWillExpandListener
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.DefaultTreeCellRenderer
import javax.swing.tree.ExpandVetoException
import javax.swing.tree.TreePath
import javax.swing.plaf.basic.BasicTreeUI

internal class WorkspaceExplorer(
    private val openFile: (Workspace, WorkspaceFile) -> Unit,
    private val reportError: (Exception) -> Unit,
) : JTree(DefaultMutableTreeNode("Open a folder")) {
    private var workspace: Workspace? = null

    init {
        name = "workspace-explorer"
        font = Night.ui(13)
        background = Night.panel
        foreground = Night.text
        setRowHeight(23)
        border = javax.swing.BorderFactory.createEmptyBorder(4, 4, 0, 0)
        isRootVisible = false
        showsRootHandles = true
        toggleClickCount = 0
        val treeUi = object : BasicTreeUI() {
            override fun paintHorizontalLine(g: Graphics, c: javax.swing.JComponent, y: Int, left: Int, right: Int) = Unit
            override fun paintVerticalLine(g: Graphics, c: javax.swing.JComponent, x: Int, top: Int, bottom: Int) = Unit
        }
        setUI(treeUi)
        treeUi.setExpandedIcon(WorkbenchIcons.glyph("chevron-down", 12))
        treeUi.setCollapsedIcon(WorkbenchIcons.glyph("chevron-right", 12))
        treeUi.setLeftChildIndent(5)
        treeUi.setRightChildIndent(12)
        setCellRenderer(object : DefaultTreeCellRenderer() {
            override fun getTreeCellRendererComponent(
                tree: JTree, value: Any?, selected: Boolean, expanded: Boolean, leaf: Boolean, row: Int, hasFocus: Boolean,
            ): java.awt.Component {
                super.getTreeCellRendererComponent(tree, value, selected, expanded, leaf, row, hasFocus)
                val entry = (value as? DefaultMutableTreeNode)?.userObject as? DirectoryEntry
                val glyph = when {
                    entry?.isDirectory == true -> if (expanded) "folder-open" else "folder"
                    entry != null -> WorkbenchIcons.file(entry.file.name)
                    else -> "folder"
                }
                icon = WorkbenchIcons.glyph(glyph, 15, if (entry?.isDirectory == true) Night.accent else Night.muted)
                foreground = if (selected || entry?.isDirectory == true) Night.bright else Night.text
                return this
            }
        }.apply {
            backgroundSelectionColor = Night.hover
            backgroundNonSelectionColor = Night.panel
            borderSelectionColor = Night.accent
            iconTextGap = 5
        })
        addTreeWillExpandListener(object : TreeWillExpandListener {
            override fun treeWillCollapse(event: TreeExpansionEvent) = Unit

            override fun treeWillExpand(event: TreeExpansionEvent) {
                val node = event.path.lastPathComponent as DefaultMutableTreeNode
                val entry = node.userObject as? DirectoryEntry ?: return
                if (node.childCount == 1 && (node.getChildAt(0) as DefaultMutableTreeNode).userObject == null) {
                    try {
                        val mounted = workspace ?: return
                        load(node, mounted.list(entry.file))
                    } catch (error: Exception) {
                        reportError(error)
                        throw ExpandVetoException(event)
                    }
                }
            }
        })
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(event: MouseEvent) {
                if (!SwingUtilities.isLeftMouseButton(event) || event.clickCount != 1) return
                val path = getPathForLocation(event.x, event.y) ?: return
                val node = path.lastPathComponent as DefaultMutableTreeNode
                val entry = node.userObject as? DirectoryEntry ?: return
                if (!entry.isDirectory) open(node)
                else if (isExpanded(path)) collapsePath(path)
                else expandPath(path)
            }
        })
        inputMap.put(KeyStroke.getKeyStroke("ENTER"), "open-file")
        actionMap.put("open-file", object : AbstractAction() {
            override fun actionPerformed(event: java.awt.event.ActionEvent) = open(lastSelectedPathComponent as? DefaultMutableTreeNode)
        })
    }

    fun mount(workspace: Workspace) {
        val entries = workspace.list()
        val root = DefaultMutableTreeNode(workspace.name)
        this.workspace = workspace
        model = DefaultTreeModel(root)
        load(root, entries)
        expandPath(TreePath(root.path))
    }

    override fun convertValueToText(
        value: Any?, selected: Boolean, expanded: Boolean, leaf: Boolean, row: Int, hasFocus: Boolean,
    ): String {
        val entry = (value as? DefaultMutableTreeNode)?.userObject as? DirectoryEntry
        return entry?.file?.name ?: super.convertValueToText(value, selected, expanded, leaf, row, hasFocus)
    }

    private fun open(node: DefaultMutableTreeNode?) {
        val entry = node?.userObject as? DirectoryEntry ?: return
        val mounted = workspace ?: return
        if (!entry.isDirectory) openFile(mounted, entry.file)
    }

    private fun load(node: DefaultMutableTreeNode, entries: List<DirectoryEntry>) {
        node.removeAllChildren()
        for (entry in entries) {
            node.add(DefaultMutableTreeNode(entry, entry.isDirectory).apply {
                if (entry.isDirectory) add(DefaultMutableTreeNode())
            })
        }
        (model as DefaultTreeModel).nodeStructureChanged(node)
    }
}
