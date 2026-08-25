# Third-party licenses

Nishi depends on the projects below. **Original licenses are preserved** — we do
not relicense third-party work. Full license texts ship inside each package
under `node_modules/<name>/LICENSE`.

This file is maintained by hand for now. Regenerating it from the lockfile is
tracked as a Stage 8 packaging task.

_Last verified: 2026-08-25, against the versions resolved in `bun.lock`._

## Bundled into the application

Code or assets that end up inside a Nishi build.

| Project | Version | License | Author | Home |
| --- | --- | --- | --- | --- |
| alpinejs | 3.16.3 | MIT | Caleb Porzio | https://alpinejs.dev |
| lucide-static | 1.34.0 | ISC | Lucide Contributors | https://lucide.dev |

### Lucide

Nishi's icon system is Lucide. Icons are read from `lucide-static` at build time
and inlined into the application markup as an SVG sprite
(`scripts/build-sprite.ts`), so they are **distributed as part of Nishi** and
the ISC notice below applies to shipped builds.

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## Build and development dependencies

Used to produce a build; not themselves shipped inside it.

| Project | Version | License | Author | Home |
| --- | --- | --- | --- | --- |
| electrobun | 2.0.1 | MIT | Blackboard Technologies Inc. | https://electrobun.dev |
| sass (Dart Sass) | 1.103.1 | MIT | Natalie Weizenbaum | https://github.com/sass/dart-sass |
| typescript | 5.9.3 | Apache-2.0 | Microsoft Corp. | https://www.typescriptlang.org/ |
| @types/alpinejs | 3.13.11 | MIT | DefinitelyTyped contributors | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/bun | 1.4.0 | MIT | DefinitelyTyped contributors | https://github.com/DefinitelyTyped/DefinitelyTyped |

## Toolchain

| Project | License | Notes |
| --- | --- | --- |
| Bun | MIT | Runtime and bundler. Not vendored; expected on the developer's machine. |
| Hutch / Cottontail | See upstream | Electrobun 2.x build toolchain, downloaded on demand into `~/.hutch`. Not redistributed by Nishi. The Electrobun runtime it resolves is embedded in packaged builds under Electrobun's own MIT terms. |

## Inspiration, not dependency

| Project | License | Relationship |
| --- | --- | --- |
| Atom | MIT | **Inspiration only.** Nishi is a new implementation, not a fork. No Atom source is redistributed. A read-only clone may sit in the gitignored `.ref/` folder during development; it is never part of a build. |

## Themes

Bundled themes keep their upstream licenses. Nishi-maintained themes are MIT.

| Theme | Upstream | License | Status |
| --- | --- | --- | --- |
| Catppuccin | https://github.com/catppuccin | MIT | Planned — Stage 3 |
| Rose Pine | https://rosepinetheme.com | MIT | Planned — Stage 3 |
| Dracula | https://draculatheme.com | MIT | Planned — Stage 3 |

Attribution for each will be completed when the themes are actually bundled;
listing them here early keeps the obligation visible rather than discovered at
release time.
