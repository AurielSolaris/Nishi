-- Nishi configuration — config.lua
--
-- STUB: the Lua runtime lands in Stage 7 (see EXTRAS.md). This file documents
-- the intended shape; Nishi does not read it yet.
--
-- config.lua is for declarative editor configuration: themes, preferences, UI
-- and keybindings. For commands and automation, use main.lua.
--
-- Every key here mirrors a setting in the settings schema
-- (src/core/settings.ts), so anything you can set in the settings pane you can
-- set from Lua, and vice versa.

return {
  editor = {
    fontSize = 13,
    tabSize = 2,
    insertSpaces = true,
    wordWrap = false,
    lineNumbers = true,
    highlightCurrentLine = true,
  },

  files = {
    trimTrailingWhitespace = false,
    insertFinalNewline = false,
    autoSave = false,
  },

  workbench = {
    -- Stage 3 ships catppuccin, rose-pine and dracula.
    theme = "nishi-night",
    sidebarVisible = true,
    splitDirection = "vertical",
  },

  -- "<modifier>+<key>" = "<command id>"
  keymap = {
    ["ctrl+n"] = "editor.newBuffer",
    ["ctrl+s"] = "editor.save",
    ["ctrl+f"] = "editor.find",
    ["ctrl+h"] = "editor.replace",
    ["ctrl+\\"] = "workbench.splitEditor",
    ["ctrl+b"] = "workbench.toggleSidebar",
  },
}
