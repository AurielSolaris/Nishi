# Nishi — Extras & Design Notes

## Purpose

This document contains additional design decisions, philosophies, and ecosystem
notes that do not belong directly in the main roadmap.

Nishi is a modern resurrection of Atom: a lightweight, hackable editor built
around a safer extension model, modern runtime choices, and a user-controlled
ecosystem.

Status markers below point at where each idea lands on the roadmap. Nothing
here is implemented yet beyond the stubs noted in "Current status".

---

## Licensing model

Nishi uses a component-based licensing approach.

### Core application

The Nishi core application is licensed under **Apache License 2.0**
(see `LICENSE`).

This includes:

- Editor core
- Runtime integration
- Extension sandbox
- API layers
- Platform abstractions
- Core infrastructure

Apache 2.0 provides a strong foundation for long-term development, including
clearer contributor and patent terms.

### Ecosystem components

The following components use permissive licensing (see `LICENSE-MIT`):

**Extensions** are licensed individually, with MIT as the default for
Nishi-maintained extensions. Goals: easy community contribution, simple
redistribution, a low barrier for developers.

**Themes** remain under their original licenses. Nishi-maintained and bundled
themes use MIT where applicable. Example bundled themes: Catppuccin, Rose Pine,
Dracula.

**Documents and examples** — documentation examples, templates, and sample
projects — use MIT.

### Third-party attribution

Nishi maintains `NOTICE.md` and `THIRD_PARTY_LICENSE.md`, documenting
third-party projects, original authors, licenses, and required attribution
notices. Original licenses are preserved whenever possible.

---

## Relationship with Atom

Nishi is inspired by Atom, the hackable editor originally created by GitHub.
Atom is an archived Electron-based project.

Nishi is **not a direct fork** of Atom's runtime or legacy implementation.
Instead, Nishi reimplements the ideas that made Atom special:

- Hackable editor design
- Package-based customization
- Familiar editor workflows
- User ownership of the editor

Nishi modernizes these ideas through Bun + Electrobun, sandboxed extensions,
modern APIs, renderer abstraction, an improved security model, and lower memory
usage goals.

Atom is the inspiration. Nishi is a new implementation.

---

## Extension security model

Nishi extensions do not receive direct system access. All extensions interact
through abstraction layers.

```
Extension
    |
    v
Nishi Extension API
    |
    v
Sandbox Layer
    |
    +--> Allowed capability
    |
    +--> Virtualized / denied resource
```

The abstraction layer exists **regardless of permission status**. Permissions
determine whether an abstraction maps to a real resource — they do not decide
whether the abstraction is there at all. That distinction is what keeps the
sandbox from being bypassable by a permission bug.

### Virtualized environment

**Filesystem.** Extensions interact with a Virtual Filesystem.

```
Extension
    |
    v
Nishi VFS
    |
    +--> Real file access
    |
    +--> Virtual response
```

Extensions do not directly see user home paths, private files, OS layout, or
hidden system data.

**Network.** Network access is abstracted. The extension does not directly
control raw sockets, DNS identity, or local network information. Nishi can
provide proxy access, filtering, identity protection, and permission-based
networking.

**Environment.** Sensitive information — username, hostname, platform details,
environment variables — is abstracted. Extensions receive the Nishi environment
instead of unrestricted system information.

### Built-in extensions

Nishi ships certain extensions as first-class components. **First-class does not
mean unrestricted**: built-in extensions use the same sandbox model as
third-party extensions.

Examples: Auto Rename Tags, Auto Close Tags, Auto Suggest Tags, Emmet support,
live preview/server tooling.

The goal is to prove that useful tooling can exist without unrestricted
permissions.

### VS Code extension compatibility

Nishi aims to support the VS Code extension ecosystem through compatibility. The
goal is not to copy VS Code internally.

```
VS Code Extension API
          |
          v
Nishi Compatibility Layer
          |
          v
Nishi Sandbox Runtime
```

Extensions gain compatibility while keeping Nishi's security rules.

---

## Lua support

Nishi includes Lua support for users familiar with Vim and Neovim.

Two primary files:

```
config.lua    editor configuration — themes, preferences, UI, keybindings
main.lua      deeper customization — commands, automation, scripting, workflows
```

Lua scripts interact through Nishi APIs rather than unrestricted system access —
the same rule that governs extensions.

---

## Memory management philosophy

Nishi aims to maintain a smaller memory footprint through efficient allocation
patterns, reduced unnecessary object creation, better lifecycle management, and
extension isolation.

### Document cache system

Nishi uses an active/cold document model. Recently used files stay in memory;
unused files may be unloaded after inactivity.

```
Opened File
     |
     v
Active RAM Cache
     |
     | inactivity timeout
     v
Cold Storage
     |
     v
Reload when needed
```

The system preserves cursor position, file state, and workspace information
while reducing memory usage. **Modified files receive special handling to
prevent data loss** — a dirty buffer is never evicted to cold storage without
its content being recoverable.

---

## Design philosophy

**Extensions are guests.** Extensions should enhance the editor, not own the
machine.

**The editor belongs to the user.** Users should be able to customize Nishi
through extensions, themes, Lua, and configuration.

**Security should be invisible.** Users should not constantly approve actions.
The architecture should enforce safety by default.

**Performance through design.** The goal is not micro-optimizing everything —
it is avoiding unnecessary work.

---

## Future direction

Nishi aims to combine Atom's hackability, VS Code's ecosystem approach,
Neovim's configuration culture, and modern security practices, while creating a
lightweight editor for the next generation.

---

## Current status

Everything in this document is design intent. What exists in the tree today:

| Area | Where | State |
| --- | --- | --- |
| Licensing | `LICENSE`, `LICENSE-MIT`, `NOTICE.md`, `THIRD_PARTY_LICENSE.md` | **Done** |
| Icon system | `scripts/build-sprite.ts`, `src/mainview/icons.ts` | **Done** — Lucide (ISC) |
| Desktop shell | `src/bun/index.ts`, `electrobun.config.ts`, `hutch.config.ts` | **Done** — v0.2.1 |
| Extension API surface | `src/extensions/api.ts` | Stub — Stage 4 |
| Sandbox layer | `src/extensions/sandbox.ts` | Stub — Stage 4 |
| Virtual filesystem | `src/extensions/vfs.ts` | Stub — Stage 4 |
| Network abstraction | `src/extensions/network.ts` | Stub — Stage 4 |
| Environment virtualization | `src/extensions/environment.ts` | Stub — Stage 4 |
| Permission model | `src/extensions/permissions.ts` | Stub — Stage 4 |
| VS Code compatibility | `src/extensions/vscode-compat.ts` | Stub — Stage 4 |
| Lua runtime | `src/lua/runtime.ts`, `lua/config.lua`, `lua/main.lua` | Stub — Stage 7 |
| Document cache | `src/core/document-cache.ts` | Stub — Stage 2 |

Stubs define the shape and record the constraints. They deliberately do not
pretend to enforce anything yet — a sandbox that looks real but isn't is worse
than one that says it isn't.
