-- Nishi scripting — main.lua
--
-- STUB: the Lua runtime lands in Stage 7 (see EXTRAS.md). This file documents
-- the intended shape; Nishi does not read it yet.
--
-- main.lua is for behaviour: custom commands, automation, editor scripting and
-- workflows. It runs against the Nishi API, not the system — there is no io,
-- os or package table, by design. Anything touching files or the network goes
-- through nishi.* and is subject to the same sandbox as extensions.

local nishi = require("nishi")

-- Register a command, then bind it from config.lua's keymap.
nishi.commands.register("myconfig.insertDate", function()
  -- Dates come from the editor, not from os.date: the environment is
  -- virtualized (EXTRAS.md, "Environment").
  nishi.editor.insertText(nishi.env.today())
end)

-- React to editor events.
nishi.events.on("document:saved", function(doc)
  nishi.window.showMessage("Saved " .. doc.name)
end)

-- Workspace files are addressed relatively; absolute paths are not expressible.
nishi.commands.register("myconfig.openReadme", function()
  nishi.workspace.open("README.MD")
end)
