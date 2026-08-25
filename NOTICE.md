# NOTICE

Nishi
Copyright 2026 Nishi contributors

This product includes software developed by the Nishi project.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

---

## Licensing model

Nishi uses component-based licensing. The rule is short:

> **The core application is Apache-2.0. Everything else we write is MIT.
> Everything else we use keeps whatever license it already came with.**

### Core application — Apache-2.0 (`LICENSE`)

Apache-2.0 covers the editor itself: editor core, runtime integration,
extension sandbox, API layers, platform abstractions, core infrastructure.
Concretely, that is everything under `src/`, `scripts/`, and the build
configuration.

Apache-2.0 was chosen for its clearer contributor and patent terms, which
matter for a project meant to be maintained long-term and extended by others.

### What we write on top — MIT (`LICENSE-MIT`)

Nishi-maintained **extensions**, **themes**, **documentation examples**,
**templates** and **sample projects** are MIT. Extensions are licensed
individually, with MIT as the default, so community contribution and
redistribution stay as frictionless as possible.

### What we use — unchanged

Third-party code keeps its own license, always. Bundled third-party themes stay
under their upstream terms; dependencies stay under theirs. We do not relicense
other people's work, and we preserve their notices.

Every third-party project, its author and its license is recorded in
`THIRD_PARTY_LICENSE.md`.

| Component | License |
| --- | --- |
| Core application | Apache-2.0 (`LICENSE`) |
| Nishi-maintained extensions | MIT (`LICENSE-MIT`) |
| Nishi-maintained themes | MIT (`LICENSE-MIT`) |
| Documentation examples, templates, samples | MIT (`LICENSE-MIT`) |
| Bundled third-party themes | Their original licenses |
| Dependencies and bundled assets | Their original licenses |

---

## Attribution

### Lucide

Nishi's icon set is [Lucide](https://lucide.dev), used under the **ISC License**.

    Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022
    as part of Feather (MIT). All other copyright (c) for Lucide are held by
    Lucide Contributors 2022.

Lucide icons are inlined into the application markup as an SVG sprite at build
time (`scripts/build-sprite.ts`) rather than shipped as separate files. They
remain under the ISC License; see `THIRD_PARTY_LICENSE.md` for the full text
reference.

### Atom

Nishi is **inspired by** Atom, the hackable editor originally created by GitHub
(MIT licensed, now archived). Nishi is **not a fork** of Atom's runtime or
legacy implementation — it is a new implementation of the ideas Atom
popularised. No Atom source is redistributed as part of Nishi.

### Electrobun

Nishi's desktop shell is built on [Electrobun](https://electrobun.dev) (MIT),
by Blackboard Technologies Inc. Its runtime and toolchain are resolved at build
time and are not redistributed in this repository.
