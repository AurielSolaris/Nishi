/**
 * preBuild hook for the Electrobun desktop build.
 *
 * The two hosts want different things from the same source:
 *
 *   - Bun dev host   bundles index.html directly, so it wants the authored
 *                    references: `./index.ts` and `./styles/index.scss`
 *                    (the latter handled by scripts/sass-plugin.ts).
 *   - Electrobun     copies HTML verbatim and builds the view entrypoint to
 *                    `index.js`; its bundler has no SCSS loader.
 *
 * Rather than keeping two hand-maintained HTML files, or reintroducing a
 * committed .css file, this compiles the stylesheet and rewrites the asset
 * references into `.build/mainview/`, which electrobun.config.ts copies into
 * the app. `.build/` is generated and gitignored — SCSS stays the only
 * stylesheet source in the tree.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { compile } from "sass";

const OUT_DIR = ".build/mainview";

await mkdir(OUT_DIR, { recursive: true });

// 1. Stylesheet: SCSS -> CSS, as a build artifact.
const css = compile("src/mainview/styles/index.scss", {
  style: "compressed",
  sourceMap: false,
});
await writeFile(`${OUT_DIR}/index.css`, css.css, "utf8");

// 2. Markup: point at what Electrobun actually produces.
let html = await readFile("src/mainview/index.html", "utf8");

const rewrites: [RegExp, string][] = [
  // The view entrypoint is bundled to index.js beside the HTML.
  [/(<script[^>]*\ssrc=")\.\/index\.ts(")/, "$1index.js$2"],
  // The stylesheet is the artifact written above.
  [/(<link[^>]*\shref=")\.\/styles\/index\.scss(")/, "$1index.css$2"],
];

for (const [pattern, replacement] of rewrites) {
  if (!pattern.test(html)) {
    // Fail loudly: a silent miss here ships a blank window, which is exactly
    // the bug this script exists to prevent.
    throw new Error(`build-view: expected asset reference not found: ${pattern}`);
  }
  html = html.replace(pattern, replacement);
}

await writeFile(`${OUT_DIR}/index.html`, html, "utf8");

console.log(`build-view: wrote ${OUT_DIR}/index.html and index.css`);
