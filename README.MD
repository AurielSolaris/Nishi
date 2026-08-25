<div align="center">
  <img src="assets/icon.svg" width="96" height="96" alt="Nishi" />
  <h1>Nishi</h1>
  <p><em>nishi</em> — निशा / নিশি, <strong>night</strong></p>
  <p>A modern resurrection of Atom: a lightweight, hackable editor built on
  Electrobun&nbsp;+&nbsp;Bun, with a VSCode-compatible extension ecosystem and
  alternative browser rendering.</p>
  <p><code>v0.2.1</code> — Stage 1, "Core Editor"</p>
</div>

---

> ## ⚠️ Early development — expect breakage
>
> **Nishi is in early development and is probably broken.** It is at version
> `0.2.1` of a ten-stage roadmap: the foundations work, but this is not a
> finished editor and is not ready to be anyone's daily driver.
>
> Concretely, at this point:
>
> - There is **no syntax highlighting**, and the text surface is still a
>   `<textarea>`.
> - There is **no file watching**, so changes made outside the editor go
>   unnoticed until you refresh.
> - Extensions, Lua support and the document cache are **stubs that deliberately
>   throw** — none of it is implemented.
> - Only **Windows** has been exercised so far. macOS and Linux builds are
>   configured but untested.
> - Interfaces, file formats and settings keys **will change** without migration
>   paths.
>
> **Back up anything you open with it.** It writes real files to disk, and it has
> not been through the kind of testing that earns trust with your data. Bug
> reports are welcome; assumptions of stability are not warranted yet.

---

## What this release is

**A real desktop editor you can work in.** v0.1.0 was a shell with nothing
behind it. v0.2.0 gave it a text buffer, an explorer, splits, search and
settings. v0.2.1 puts it in a **native window** on Electrobun, with the same
editor and the same filesystem service behind RPC instead of HTTP.

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
| `bun run test` | Test suite (54 tests) |
| `bun run typecheck` | `tsc --noEmit`, including the main process |
| `bun run check` | Typecheck then test |
| `bun run clean` | Removes `build/` and `.build/` |

Every `desktop:*` and `build*` command goes through `scripts/hutch.ts`, which
resolves the Hutch binary from `~/.hutch/bin` directly — so they work even in a
terminal opened before Hutch was installed and PATH updated.

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
- **No file watching** — an external change is not noticed until you hit Refresh.
- **No command palette**, no drag-and-drop in the explorer, no multi-select.
- **Extensions, Lua and the document cache are stubs.** They throw rather than
  pretend to work. See `EXTRAS.md`.

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
RPC and HTTP respectively, and **both delegate to the same `FsService`**, so
behaviour cannot drift between them. That seam is also what lets a Gecko
renderer drop in at Stage 6.

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
  dev-server.ts         Bun dev host + filesystem/settings API
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
    document-cache.ts   active/cold cache (stub — Stage 2)
    platform.ts         the host seam: Electrobun vs browser
  extensions/           sandbox, VFS, network, permissions (stubs — Stage 4)
  host/fs-service.ts    filesystem service, shared by both hosts
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

`EXTRAS.md` covers the parts that are decided but not yet built — the extension
security model (extensions are guests; the abstraction layer exists regardless
of permission status), the virtualized filesystem/network/environment, VS Code
compatibility, Lua support, and the active/cold document cache.

## Roadmap

| Stage | Version | Focus | Status |
| --- | --- | --- | --- |
| 0 | 0.1.0 | Foundation | **shipped** (desktop shell live in 0.2.1) |
| 1 | 0.2.1 | Core editor — buffer, explorer, splits, search, settings | **shipped** |
| 2 | 0.3.0 | Modern runtime — native fs, IPC, startup, document cache | next |
| 3 | 0.4.0 | Themes — Catppuccin, Rose Pine, Dracula + syntax highlighting | planned |
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
