<div align="center">
  <img src="assets/icon.svg" width="96" height="96" alt="Nishi" />
  <h1>Nishi</h1>
  <p><em>nishi</em> — निशा / নিশি, <strong>night</strong></p>
  <p>A modern resurrection of Atom: a lightweight, hackable editor built on
  Electrobun&nbsp;+&nbsp;Bun, with a sandboxed filesystem, a VSCode-compatible
  extension ecosystem and alternative browser rendering.</p>
  <p><code>v0.3.1</code> — Stage 2, "Modern Runtime"</p>
</div>

---

> ## ⚠️ Early development — expect breakage
>
> **Nishi is in early development and is probably broken.** It is at version
> `0.3.1` of a ten-stage roadmap: the foundations work, but this is not a
> finished editor and is not ready to be anyone's daily driver.
>
> Concretely, at this point:
>
> - There is **no syntax highlighting**, and the text surface is still a
>   `<textarea>`.
> - Extensions and Lua support are **stubs that deliberately throw** — none of it
>   is implemented.
> - The sandboxed filesystem is new in this release and has not had outside
>   scrutiny. It is tested, and it is not audited. Do not treat it as a security
>   guarantee yet.
> - Only **Windows** has been exercised so far. macOS and Linux builds are
>   configured but untested.
> - Interfaces, file formats and settings keys **will change** without migration
>   paths. `0.3.x` changed how files are addressed internally, which is exactly
>   the kind of break to expect again.
>
> **Back up anything you open with it.** It writes real files to disk, and it has
> not been through the kind of testing that earns trust with your data. Bug
> reports are welcome; assumptions of stability are not warranted yet.

---

## What this release is

**The release where the editor stopped touching your filesystem directly.**

v0.1.0 was a shell. v0.2.0 gave it a buffer, an explorer, splits, search and
settings. v0.2.1 put it in a native window. `0.3.0` changes what is underneath
all of it: the editor no longer holds operating-system paths at all.

It addresses files like this —

```
nishi://workspace/src/core/buffer.ts
```

— and only the host process can turn one of those into a real path. There is no
drive letter, no `~`, no `..`, no way to name a file outside the folder you
opened, because the path type has no syntax for one. See
[Sandboxed filesystem](#sandboxed-filesystem).

On top of that boundary, the rest of Stage 2: the host now **watches the
workspace** and tells the editor when something changed underneath it, files left
open but untouched for **30 minutes unload themselves** and reload on demand, and
unsaved work is **journalled to disk** — so a modified file no longer has to sit
in memory forever, and your edits survive the process dying.

It is not finished — there is no syntax highlighting yet. That is named below
rather than glossed.

## Quick start

```sh
bun install
bun run dev          # browser dev host → http://127.0.0.1:4373
bun run desktop      # native window (needs Hutch — see Runtime)
```

The dev host opens the current directory as the workspace; the desktop app
reopens the folder you last used, falling back to your home directory. Override
either with `NISHI_ROOT`, or use the explorer's `…` button.

### Commands

**Running**

| Command | What it does |
| --- | --- |
| `bun run dev` | Browser dev host with hot reload and the filesystem API |
| `bun run desktop` | Builds and runs the desktop app |
| `bun run desktop:watch` | Same, rebuilding as files change |

**Desktop build pipeline** — each Hutch step separately, for when the combined
command is too blunt:

| Command | What it does |
| --- | --- |
| `bun run desktop:prepare` | Projects the Electrobun SDK into `.hutch/devkit`. Run once, and after any version change. |
| `bun run desktop:build` | Builds the dev app without launching it |
| `bun run desktop:run` | Launches the last dev build without rebuilding |
| `bun run desktop:sync` | Advances the SDK projection to the active channel |
| `bun run desktop:update` | Moves to the latest stable Electrobun, then syncs |

**Release builds**

| Command | What it does |
| --- | --- |
| `bun run build` | Stable desktop build |
| `bun run build:canary` | Canary desktop build |

**Assets, quality, housekeeping**

| Command | What it does |
| --- | --- |
| `bun run icon` | Regenerates `assets/icon.png`, `.ico` and `.svg` |
| `bun run sprite` | Rebuilds the inline icon sprite (mark + Lucide set) |
| `bun run assets` | Both of the above, in order |
| `bun run test` | Test suite (151 tests) |
| `bun run typecheck` | `tsc --noEmit`, including the main process |
| `bun run check` | Typecheck then test |
| `bun run clean` | Removes `build/` and `.build/` |

Every `desktop:*` and `build*` command goes through `scripts/hutch.ts`, which
resolves the Hutch binary from `~/.hutch/bin` directly — so they work even in a
terminal opened before Hutch was installed and PATH updated.

## Sandboxed filesystem

Nishi is not only an opinionated Atom. The editor runs against a **virtual
filesystem**, not the disk.

Every file the UI touches is named by mount and POSIX segments:

```
nishi://workspace/src/core/buffer.ts
```

`src/host/vfs.ts` owns the mount table and is the only module in the tree that
turns one of those into a real path. Everything above it — explorer, tabs, save
path, and in Stage 4 the extension host — cannot express a path outside a mount.

**Why the editor and not just extensions.** The design notes always called for a
VFS for extensions. Putting the editor behind the same boundary is what makes it
trustworthy: a boundary only guests use is a boundary nobody tests, and the
editor is the heaviest filesystem user there is. Stage 4's extension VFS becomes
a capability-checked *subset* of this module rather than a second implementation
of path handling — which is where filesystem sandboxes usually fail.

**What it enforces:**

| Attack | What happens |
| --- | --- |
| `../../etc/passwd` | Rejected at parse time — `..` is not a legal segment |
| A raw `C:\Windows\win.ini` | Rejected — not a Nishi path |
| A symlink out of the workspace | Does not resolve; the entry is omitted from listings |
| `notes.txt:hidden` (NTFS alternate data stream) | Rejected — `:` is not legal in a name |
| `CON`, `LPT1.txt` (Windows devices) | Rejected, on every platform |
| `evil.` / `evil ` (Windows strips these) | Rejected — one file to the OS, two entries to us |
| `%2e%2e` | Stays literal. Paths are never percent-decoded |
| Writing through a read-only mount | Refused at mapping time, not by the caller |

Containment is **canonical, not lexical**: every mapping resolves the deepest
existing ancestor with `realpath` and re-checks it against the mount's own
realpath. A string-prefix check — which is what the previous release did — calls
a link inside the workspace pointing at `~/.ssh` "inside the workspace".

The view is also never told the workspace's absolute path. It gets a mount URI, a
folder label, and a display string with your home directory elided
(`~/Code/nishi`), so your username stays out of the DOM and out of window titles.

**The one privileged operation** is mounting a folder. "Open folder" takes a real
path, because that is the user's explicit gesture and carries the same authority
a native folder picker would. It is marked `PRIVILEGED` in the source and is the
only route by which a new region of disk becomes reachable.

> This is tested, not audited. 47 tests cover the boundary, including symlink
> escapes against a real temporary directory rather than a mocked filesystem. A
> security audit is Stage 9 work. Until then, treat it as a well-built fence, not
> a proof.

## What works

**Editing** — a piece-table text buffer with a per-piece line index, undo/redo
that groups consecutive typing into single steps, and CRLF files that stay CRLF
when saved. The buffer is the source of truth, not the DOM.

**Files** — a lazy explorer tree with per-type icons, expand/collapse, new file,
new folder, rename, delete and change-folder. Open a file, edit it, `Ctrl+S`
writes it to disk. Optional trim-trailing-whitespace and insert-final-newline on
save, plus auto-save.

**Tabs and splits** — per-pane tab strips with file icons, dirty markers,
middle-click close, and a prompt before discarding unsaved work. Split the view
and both panes share **one** document: one buffer, one undo history, independent
carets.

**Find and replace** — literal, regex, match-case and whole-word; navigation
wraps; replace one or replace all; `$1` capture groups expand in regex mode.

**File watching** — the host watches the workspace and pushes changes to the
editor. Edit a file in another program and a clean tab reloads itself; a tab with
unsaved changes is flagged rather than overwritten, because the copy in memory is
the one with your work in it. The explorer redraws only the folders that moved.
Events are coalesced, and the editor's own saves are muted so a save does not
come back as "this file changed on disk".

**Memory** — a file left untouched for 30 minutes releases its contents. The tab,
the cursor and the scroll position all stay; the text is read back the moment you
look at the file again. Whatever is currently on screen is never unloaded, however
long it has been open. Both the timeout and the ceiling on loaded files are
settings; set the timeout to 0 to switch it off.

**Unsaved work is written down** — edits are journalled to `~/.nishi/journal/`
shortly after you make them. Two things follow. A modified file can be unloaded
like any other and comes back *still modified*, so twenty edited files no longer
mean twenty buffers pinned in memory. And if Nishi dies, the next launch offers
the unsaved work back as dirty tabs — it does not write to your files on your
behalf, because the previous session never decided to save them.

The rule the whole cache rests on:

> **A document is never unloaded unless its content is recoverable** — either
> saved to its file, or written to the journal. An untitled buffer nobody has
> journalled yet is neither, so it stays in memory.

**Native dialogs** — opening a folder and confirming a destructive action use
real OS dialogs on the desktop. The browser dev host falls back to the DOM's own
prompt and confirm, and says so rather than pretending.

**Settings** — schema-driven, so the pane renders itself from the schema and
adding a setting is one entry. Values are coerced and clamped, and persist to
`~/.nishi/settings.json`.

**Desktop shell** — custom frameless chrome with working minimise / maximise /
close, window title tracking the active file, and an unsaved-changes prompt
before the window closes.

## Keybindings

| Key | Action |
| --- | --- |
| `Ctrl+N` | New buffer |
| `Ctrl+S` | Save |
| `Ctrl+W` | Close tab |
| `Ctrl+F` / `Ctrl+H` | Find / find and replace |
| `Ctrl+\` | Split editor |
| `Ctrl+K` | Cycle panes |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+,` | Settings |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |

## What is not here yet

Named plainly, so nothing reads as broken:

- **No syntax highlighting.** The text surface is a `<textarea>`, which cannot
  render coloured spans. Replacing it with a line renderer is Stage 3 work, and
  the buffer API is already shaped for it. Find highlights only the current
  match for the same reason.
- **No command palette**, no drag-and-drop in the explorer, no multi-select.
- **Extensions and Lua are stubs.** They throw rather than pretend to work. See
  `EXTRAS.md`.
- **No Save As outside the workspace.** Electrobun has no native *save* dialog,
  and under the VFS a real path may only enter through the folder-open gesture —
  so Save As takes a workspace-relative path. To save elsewhere, open that folder.
  That is a consequence of the sandbox rather than a missing feature.
- **No terminal yet.** A complete ConPTY binding is in the tree
  (`src/host/pty/conpty.ts`) but is not wired to anything: on the development
  machine ConPTY returns no output at all, reproduced independently in .NET, so
  it would have shipped unverified. See `PLAN.MD` for the full investigation.
- **Startup time is unmeasured.** It was on the Stage 2 list and did not get
  done; there is no baseline against the packaged app yet, and a number invented
  without one would be worse than an unticked box. Carried to Stage 3.
- **Recursive file watching is not available on every platform.** Where it fails,
  the editor says so and Refresh still works, rather than pretending to watch.

## Runtime

Nishi runs on **Electrobun**, which builds through a toolchain called **Hutch**
rather than from npm alone. Hutch resolves the pinned Electrobun runtime and
projects its SDK into `.hutch/devkit`.

First-time setup:

```sh
npx electrobun init --help   # bootstraps Hutch into ~/.hutch/bin
bun run desktop:prepare      # projects the SDK for the pinned version
bun run desktop
```

`hutch.config.ts` pins the Electrobun version; dependencies stay with Bun.
`tsconfig.json` extends the projected devkit config, so `src/bun/index.ts` and
`electrobun.config.ts` are typechecked against the **real** SDK rather than
taken on faith.

Nishi's UI never talks to a runtime directly — it talks to a `NishiHost`
(`src/core/platform.ts`). The desktop shell and the dev host implement it over
RPC and HTTP respectively, and **both delegate to the same `FsService` over the
same `Vfs`**, so behaviour cannot drift between them. That seam is also what lets
a Gecko renderer drop in at Stage 6.

As of `0.3.0` the seam runs both ways. File watching means the host has something
to say on its own, so it pushes: an RPC message on the desktop, Server-Sent
Events on the dev host. Both directions are declared once, in
`src/core/host-rpc.ts`, which both ends import — a message declared on one side
and not the other fails at runtime, and one definition makes the compiler check
both ends against the same thing.

The desktop build differs from the dev host in three ways, all handled by the
`preBuild` hook in `scripts/build-view.ts`: HTML is copied verbatim (so asset
references must point at the built `index.js`), the view bundler has no SCSS
loader (so the stylesheet is compiled ahead of it), and under `views://` a
leading-slash href resolves inside the view folder.

> **Stop the app before rebuilding.** Hutch fails with `FileBusy` if the
> binaries are in use, and leaves `build/` half-wiped — the next run then reports
> `BuiltMainNotFound`. If that happens: `bun run clean` and rebuild.

## Layout

```
assets/                 generated icon set (PNG, ICO, SVG)
lua/                    config.lua / main.lua templates (stubs — Stage 7)
scripts/
  hutch.ts              resolves and runs the Hutch toolchain
  clean.ts              removes build/ and .build/
  dev-server.ts         Bun dev host + filesystem/settings API + SSE events
  sass-plugin.ts        compiles SCSS in Bun's bundler — no .css in the tree
  build-view.ts         preBuild hook: compiles SCSS + rewrites asset refs
  build-sprite.ts       inlines the mark + Lucide icons into the markup
  gen-icon.ts           parametric icon renderer — edit geometry here
src/
  bun/index.ts          Electrobun main process — RPC over the same FsService
  core/
    branding.ts         brand constants and palette
    buffer.ts           piece-table text buffer + undo history
    document.ts         a buffer plus where it came from
    workspace.ts        documents, panes, tabs
    search.ts           find and replace
    settings.ts         schema-driven settings store
    document-cache.ts   active/cold cache — 30-minute idle unload
    vfs-path.ts         what a legal nishi:// path is (shared, node-free)
    host-rpc.ts         every type that crosses the host seam
    platform.ts         the host seam: Electrobun vs browser
  extensions/           sandbox, extension VFS, network, permissions (stubs — Stage 4)
  host/
    vfs.ts              the mount table — the only place a path becomes real
    fs-service.ts       filesystem service, shared by both hosts
    watcher.ts          recursive file watching, emitting nishi:// paths
    journal.ts          unsaved work on disk, and crash recovery
    pty/conpty.ts       ConPTY over bun:ffi (not wired up — see PLAN.MD)
  lua/runtime.ts        Lua config runtime (stub — Stage 7)
  mainview/
    index.html          shell markup + generated icon sprite
    index.ts            boot + keymap
    app.ts              the application object every view talks to
    editor-view.ts      panes, tabs, text surface (imperative)
    components.ts       Alpine components: explorer, settings, find
    icons.ts            file-type → icon mapping
    styles/             SCSS sources — the only stylesheet layer
```

## Stack

| Choice | Why |
| --- | --- |
| **Bun + Electrobun** | No Electron. A system webview instead of a bundled Chromium. |
| **A VFS under the editor, not just under extensions** | A boundary only guests use is a boundary nobody tests. Routing the editor through it means bugs in the mapping surface in normal use. |
| **Alpine.js → htmx → Ember** | A strict ladder; no rung is skipped without hitting its real limit. v0.2.x uses Alpine for the explorer, settings and find bar. |
| **Imperative editor surface** | Alpine drives the panels, but the text surface needs exact control over when a value is written back, or the caret jumps. |
| **SCSS, not Tailwind** | If we are writing the classes anyway, they may as well be our own. A Bun plugin compiles `.scss` directly — there is no `.css` file in the tree. |
| **Lucide icons, inlined** | Under `views://` an SVG has no usable image MIME type and will not render in an `<img>`. Inlining as a sprite works in both hosts and lets icons inherit `currentColor`. |

Atom is studied, not forked: archived, CoffeeScript-era, Electron-bound. Its
keymaps, pane semantics and package-manifest shape inform Nishi; its runtime
does not. No Atom source is redistributed.

## Icons

Nishi's icon set is [Lucide](https://lucide.dev), used under the ISC License and
inlined at build time by `scripts/build-sprite.ts`. To change the set, edit the
`ICONS` list there and run `bun run sprite`.

## Design notes

`EXTRAS.md` covers the design behind the security model — extensions are guests,
and the abstraction layer exists regardless of permission status — along with the
parts still to be built: network and environment virtualization, VS Code
compatibility, and Lua support. The virtualized filesystem and the document cache
described there are no longer plans; both shipped in `0.3.0`.

## Roadmap

| Stage | Version | Focus | Status |
| --- | --- | --- | --- |
| 0 | 0.1.0 | Foundation | **shipped** (desktop shell live in 0.2.1) |
| 1 | 0.2.1 | Core editor — buffer, explorer, splits, search, settings | **shipped** |
| 2 | 0.3.1 | Modern runtime — sandboxed VFS, file watching, push IPC, document cache, journal | **shipped** |
| 3 | 0.4.0 | Themes — Catppuccin, Rose Pine, Dracula + syntax highlighting | next |
| 4 | 0.5.0 | Extensions — sandbox, VFS, VSCode compatibility | planned |
| 5 | 0.6.0 | Language support — LSP, tree-sitter | planned |
| 6 | 0.7.0 | Gecko renderer experiment | planned |
| 7 | 0.8.0 | Developer experience — marketplace, CLI, imports, Lua | planned |
| 8 | 0.9.0 | Beta — stable API, docs, Windows/Linux builds | planned |
| 9 | 0.9.5 | Release candidate — perf, security audit, packaging | planned |
| 10 | 1.0.0 | Stable release | planned |

## Contact

Issues and pull requests are welcome on
[GitHub](https://github.com/AurielSolaris/Nishi). For anything else:
debadityamalakar@gmail.com

## License

Component-based. The rule is short:

> **The core application is Apache-2.0. Everything else we write is MIT.
> Everything else we use keeps whatever license it already came with.**

- **Core application** — Apache-2.0 (`LICENSE`). Editor core, runtime
  integration, extension sandbox, API layers, platform abstractions, core
  infrastructure — everything under `src/` and `scripts/`.
- **Nishi-maintained extensions, themes, docs and examples** — MIT
  (`LICENSE-MIT`).
- **Third-party code and bundled themes** — their original licenses, preserved
  unchanged.

Attribution lives in `NOTICE.md` and `THIRD_PARTY_LICENSE.md`.
