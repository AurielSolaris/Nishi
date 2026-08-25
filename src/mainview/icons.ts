/**
 * Icon lookup for explorer entries.
 *
 * Returns the id of a symbol inlined by scripts/build-sprite.ts. Every name
 * here must appear in that script's ICONS list, or the reference resolves to
 * nothing and the row renders iconless.
 *
 * Icons are Lucide (ISC) — https://lucide.dev
 */

import type { EntryKind } from "../core/platform.ts";

/** Extension → symbol id. Extensions are matched lowercase, without the dot. */
const BY_EXTENSION: Record<string, string> = {
  // Code
  ts: "file-code",
  tsx: "file-code",
  js: "file-code",
  jsx: "file-code",
  mjs: "file-code",
  cjs: "file-code",
  py: "file-code",
  rs: "file-code",
  go: "file-code",
  c: "file-code",
  h: "file-code",
  cpp: "file-code",
  lua: "file-code",
  html: "file-code",
  zig: "file-code",
  odin: "file-code",

  // Styles
  css: "palette",
  scss: "palette",
  sass: "palette",

  // Data / config
  json: "file-json",
  jsonc: "file-json",
  toml: "file-cog",
  yml: "file-cog",
  yaml: "file-cog",
  ini: "file-cog",
  env: "file-lock",
  lock: "file-lock",

  // Prose
  md: "book-open",
  mdx: "book-open",
  txt: "file-text",

  // Images
  svg: "file-image",
  png: "file-image",
  jpg: "file-image",
  jpeg: "file-image",
  gif: "file-image",
  webp: "file-image",
  ico: "file-image",

  // Shell
  sh: "terminal",
  bash: "terminal",
  ps1: "terminal",
  bat: "terminal",
  cmd: "terminal",
};

/** Whole filenames that beat the extension rule. */
const BY_NAME: Record<string, string> = {
  "package.json": "file-cog",
  "tsconfig.json": "file-cog",
  "bunfig.toml": "file-cog",
  "bun.lock": "file-lock",
  ".gitignore": "file-cog",
  license: "file-text",
  "license-mit": "file-text",
  "notice.md": "file-text",
};

export function iconForEntry(kind: EntryKind, name: string, expanded = false): string {
  if (kind === "directory") return expanded ? "#i-folder-open" : "#i-folder";

  const lower = name.toLowerCase();

  const byName = BY_NAME[lower];
  if (byName) return `#i-${byName}`;

  // "a.test.ts" -> "ts"; a dotfile like ".gitignore" has no extension to take.
  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot + 1) : "";

  return `#i-${BY_EXTENSION[ext] ?? "file"}`;
}
