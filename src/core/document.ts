/**
 * Document — a buffer plus where it came from.
 *
 * One Document per file, shared by every pane showing it. That sharing is the
 * point: split the same file into two panes and both views edit one buffer,
 * with one undo history and one dirty state.
 */

import { TextBuffer } from "./buffer.ts";

export type DocumentInit = {
  path?: string | null;
  name: string;
  content?: string;
};

let nextId = 0;

export class Document {
  readonly id: string;
  readonly buffer: TextBuffer;

  /** Absolute path, or null for a buffer that has never been saved. */
  path: string | null;
  name: string;

  /** Buffer version at the last save; dirty is a comparison, not a flag. */
  #savedVersion: number;

  /** Caret offset per pane, so split views keep independent cursors. */
  readonly carets = new Map<string, number>();

  constructor(init: DocumentInit) {
    this.id = `doc-${++nextId}`;
    this.path = init.path ?? null;
    this.name = init.name;
    this.buffer = new TextBuffer(init.content ?? "");
    this.#savedVersion = this.buffer.version;
  }

  get isDirty(): boolean {
    return this.buffer.version !== this.#savedVersion;
  }

  get isUntitled(): boolean {
    return this.path === null;
  }

  markSaved(path?: string): void {
    if (path) {
      this.path = path;
      this.name = path.split(/[\\/]/).pop() ?? this.name;
    }
    this.#savedVersion = this.buffer.version;
    this.buffer.breakUndoGroup();
  }

  /** Language id from the file extension. Stage 5 replaces this with a registry. */
  get languageId(): string {
    const ext = this.name.includes(".") ? this.name.split(".").pop()!.toLowerCase() : "";
    return LANGUAGES[ext] ?? "Plain Text";
  }
}

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  json: "JSON",
  md: "Markdown",
  scss: "SCSS",
  css: "CSS",
  html: "HTML",
  svg: "SVG",
  toml: "TOML",
  yml: "YAML",
  yaml: "YAML",
  sh: "Shell",
  py: "Python",
  rs: "Rust",
  go: "Go",
  c: "C",
  h: "C",
  cpp: "C++",
  lock: "Lockfile",
  txt: "Plain Text",
};
