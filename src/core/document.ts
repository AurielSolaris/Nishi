/**
 * Document — a buffer plus where it came from.
 *
 * One Document per file, shared by every pane showing it. That sharing is the
 * point: split the same file into two panes and both views edit one buffer,
 * with one undo history and one dirty state.
 *
 * ## Cold documents
 *
 * A document that has sat untouched long enough has its buffer released and
 * goes "cold" (see document-cache.ts). The Document object survives — its tab,
 * its name, its per-pane carets — so the workspace layout does not change when
 * memory is reclaimed. Only the text goes, and only when the text is safely on
 * disk.
 *
 * `buffer` therefore throws while cold rather than returning an empty one. An
 * empty buffer would render as an empty file and could be saved over the real
 * contents; a throw is a bug report. Callers that might touch a cold document
 * go through `NishiApp.warm()` first, which is every path that focuses a tab.
 *
 * A document with unsaved changes may go cold too, but only once those changes
 * are in the journal (src/host/journal.ts) — at which point the buffer is no
 * longer the only copy. It revives *dirty*, from the journal rather than from
 * the file, so the edits come back rather than being quietly discarded.
 */

import { TextBuffer } from "./buffer.ts";
import { vfsBasename, type VfsPath } from "./vfs-path.ts";

export type DocumentInit = {
  path?: VfsPath | null;
  name: string;
  content?: string;
};

let nextId = 0;

export class Document {
  readonly id: string;

  #buffer: TextBuffer | null;

  /** VFS path, or null for a buffer that has never been saved. */
  path: VfsPath | null;
  name: string;

  /** Buffer version at the last save; dirty is a comparison, not a flag. */
  #savedVersion: number;

  /**
   * Modification time seen when this document was last read or written.
   * The watcher compares against it to tell a real external edit from the echo
   * of our own save.
   */
  modifiedMs = 0;

  /** Set when the file changed on disk underneath an open document. */
  staleOnDisk = false;

  /**
   * Stable identity, for anything that has to recognise this document across
   * process restarts — which is the journal, and only the journal.
   *
   * `id` is a per-session counter (`doc-1`, `doc-2`), so it collides across runs
   * and cannot key a file that outlives the run that wrote it.
   */
  readonly key: string = crypto.randomUUID();

  /**
   * True when the current unsaved content is safely in the journal.
   *
   * Cleared on every edit: the journal is written on a debounce, so between a
   * keystroke and the write there is a window where the buffer is once again the
   * only copy, and during that window the document must not be evicted.
   */
  journalled = false;

  /** Modification time the current edits were started from, for the journal. */
  editBaseModifiedMs = 0;

  /** Caret offset per pane, so split views keep independent cursors. */
  readonly carets = new Map<string, number>();

  /** Scroll offset per pane, restored when a cold document is revived. */
  readonly scrollTops = new Map<string, number>();

  constructor(init: DocumentInit) {
    this.id = `doc-${++nextId}`;
    this.path = init.path ?? null;
    this.name = init.name;
    this.#buffer = new TextBuffer(init.content ?? "");
    this.#savedVersion = this.#buffer.version;
  }

  get buffer(): TextBuffer {
    if (!this.#buffer) {
      throw new Error(
        `${this.name} is cold; call app.warm(doc) before touching its buffer`,
      );
    }
    return this.#buffer;
  }

  get isCold(): boolean {
    return this.#buffer === null;
  }

  get isDirty(): boolean {
    // A cold document is clean by construction — eviction refuses dirty ones —
    // and asking a released buffer for its version would throw.
    return this.#buffer !== null && this.#buffer.version !== this.#savedVersion;
  }

  get isUntitled(): boolean {
    return this.path === null;
  }

  /** True when unloading this document would lose something. */
  get isRecoverable(): boolean {
    if (!this.isDirty) return !this.isUntitled;
    return this.journalled;
  }

  /**
   * Drop the buffer. Refuses a document whose content is not recoverable, which
   * is the invariant the whole cache rests on: unsaved text may exist only here.
   *
   * Three ways to be recoverable, and a document needs one of them:
   *   - clean and saved  — re-read the file
   *   - dirty, journalled — re-read the journal
   *   - neither          — refuse, and keep holding the memory
   *
   * An untitled buffer that has never been journalled is the third case: no file
   * and no record, so the buffer is the work.
   */
  release(): boolean {
    if (this.#buffer === null) return true;
    if (!this.isRecoverable) return false;
    this.#wasDirtyWhenReleased = this.isDirty;
    this.#buffer = null;
    return true;
  }

  #wasDirtyWhenReleased = false;

  /** True when this cold document's content lives in the journal, not its file. */
  get revivesFromJournal(): boolean {
    return this.#buffer === null && this.#wasDirtyWhenReleased;
  }

  /** Re-attach content read back from disk. The document comes back clean. */
  restore(content: string, modifiedMs: number): void {
    this.#buffer = new TextBuffer(content);
    this.#savedVersion = this.#buffer.version;
    this.modifiedMs = modifiedMs;
    this.staleOnDisk = false;
    this.#wasDirtyWhenReleased = false;
  }

  /**
   * Re-attach journalled content. The document comes back **dirty**, because it
   * is: these edits are still not in the file.
   *
   * Undo history does not survive — it was in the buffer, and the buffer is what
   * was released. The text is what matters and the text is intact; a lost redo
   * stack is a fair price for not holding every modified file in memory forever.
   */
  restoreDirty(content: string, baseModifiedMs: number): void {
    this.#buffer = new TextBuffer(content);
    // One version behind the buffer, so isDirty is true from the first moment.
    this.#savedVersion = this.#buffer.version - 1;
    this.modifiedMs = baseModifiedMs;
    this.editBaseModifiedMs = baseModifiedMs;
    this.journalled = true;
    this.#wasDirtyWhenReleased = false;
  }

  markSaved(path?: VfsPath, modifiedMs?: number): void {
    if (path) {
      this.path = path;
      this.name = vfsBasename(path);
    }
    if (modifiedMs !== undefined) this.modifiedMs = modifiedMs;
    this.#savedVersion = this.buffer.version;
    this.buffer.breakUndoGroup();
    this.staleOnDisk = false;
    // The file is the record now; the journal entry is stale and its owner drops
    // it. `journalled` goes false because there is nothing left to journal.
    this.journalled = false;
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
