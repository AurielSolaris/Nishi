/**
 * TextBuffer — a piece-table text buffer with an undo history.
 *
 * Replaces the `<textarea>`-as-truth model of Stage 0. The buffer, not the DOM,
 * now owns document text, which is what makes split views over one file, real
 * undo grouping, and (later) decorations possible.
 *
 * Design notes:
 *   - Text is kept as two immutable strings (the file as loaded, plus an
 *     append-only buffer of everything typed since) and an ordered list of
 *     pieces pointing into them. Edits splice the piece list; no large string
 *     is ever copied.
 *   - Each piece caches the relative offsets of the line starts inside it, so
 *     line lookups walk pieces (few) rather than characters (many).
 *   - CRLF is normalized to LF on load and restored on save; `eol` remembers
 *     which the file used. Editors that skip this corrupt Windows files.
 */

/** 0-based line, 0-based column. */
export type Position = { line: number; column: number };

export type Eol = "\n" | "\r\n";

type Source = 0 | 1; // 0 = original, 1 = added

type Piece = {
  src: Source;
  start: number;
  length: number;
  /** Offsets, relative to the piece, of the character after each newline. */
  lineStarts: number[];
};

type Edit = {
  offset: number;
  /** Text removed by this edit (empty for a pure insert). */
  removed: string;
  /** Text inserted by this edit (empty for a pure delete). */
  inserted: string;
};

/** Edits within this window that continue typing forward are merged. */
const TYPING_MERGE_MS = 400;

function computeLineStarts(text: string, from: number, length: number): number[] {
  const starts: number[] = [];
  for (let i = 0; i < length; i++) {
    if (text.charCodeAt(from + i) === 10) starts.push(i + 1);
  }
  return starts;
}

export class TextBuffer {
  #original: string;
  #added = "";
  #pieces: Piece[] = [];
  #length = 0;

  /** Bumped on every mutation; cheap way for views to detect staleness. */
  version = 0;

  readonly eol: Eol;

  #undo: Edit[][] = [];
  #redo: Edit[][] = [];
  #pendingGroup: Edit[] | null = null;
  #lastEditAt = 0;
  #lastEditEnd = -1;
  /** While applying undo/redo, don't record new history. */
  #applying = false;

  constructor(text = "") {
    this.eol = text.includes("\r\n") ? "\r\n" : "\n";
    this.#original = this.eol === "\r\n" ? text.replaceAll("\r\n", "\n") : text;
    this.#length = this.#original.length;
    if (this.#length > 0) {
      this.#pieces.push({
        src: 0,
        start: 0,
        length: this.#length,
        lineStarts: computeLineStarts(this.#original, 0, this.#length),
      });
    }
  }

  get length(): number {
    return this.#length;
  }

  #sourceText(src: Source): string {
    return src === 0 ? this.#original : this.#added;
  }

  // ------------------------------------------------------------- reading --

  getText(): string {
    let out = "";
    for (const p of this.#pieces) {
      out += this.#sourceText(p.src).substr(p.start, p.length);
    }
    return out;
  }

  /** Text as it should be written to disk, with the file's original EOL. */
  getTextForSave(): string {
    const text = this.getText();
    return this.eol === "\r\n" ? text.replaceAll("\n", "\r\n") : text;
  }

  getTextRange(start: number, end: number): string {
    const from = Math.max(0, Math.min(start, this.#length));
    const to = Math.max(from, Math.min(end, this.#length));
    if (from === to) return "";

    let out = "";
    let seen = 0;
    for (const p of this.#pieces) {
      const pieceEnd = seen + p.length;
      if (pieceEnd > from && seen < to) {
        const localStart = Math.max(0, from - seen);
        const localEnd = Math.min(p.length, to - seen);
        out += this.#sourceText(p.src).substr(p.start + localStart, localEnd - localStart);
      }
      seen = pieceEnd;
      if (seen >= to) break;
    }
    return out;
  }

  get lineCount(): number {
    let n = 1;
    for (const p of this.#pieces) n += p.lineStarts.length;
    return n;
  }

  /** Absolute offset at which `line` begins. */
  offsetOfLine(line: number): number {
    if (line <= 0) return 0;

    let linesSeen = 0;
    let offset = 0;
    for (const p of this.#pieces) {
      const inPiece = p.lineStarts.length;
      if (linesSeen + inPiece >= line) {
        return offset + p.lineStarts[line - linesSeen - 1]!;
      }
      linesSeen += inPiece;
      offset += p.length;
    }
    return this.#length;
  }

  /** Line text, without its trailing newline. */
  getLine(line: number): string {
    const start = this.offsetOfLine(line);
    if (line + 1 >= this.lineCount) return this.getTextRange(start, this.#length);
    // offsetOfLine(line + 1) sits just past the newline; drop it.
    return this.getTextRange(start, this.offsetOfLine(line + 1) - 1);
  }

  positionAt(offset: number): Position {
    const target = Math.max(0, Math.min(offset, this.#length));

    let linesSeen = 0;
    let seen = 0;
    let lineStartOffset = 0;

    for (const p of this.#pieces) {
      const pieceEnd = seen + p.length;
      if (target <= pieceEnd) {
        // Walk this piece's line starts to find the last one at or before target.
        for (const rel of p.lineStarts) {
          const abs = seen + rel;
          if (abs > target) break;
          linesSeen++;
          lineStartOffset = abs;
        }
        return { line: linesSeen, column: target - lineStartOffset };
      }
      if (p.lineStarts.length > 0) {
        linesSeen += p.lineStarts.length;
        lineStartOffset = seen + p.lineStarts[p.lineStarts.length - 1]!;
      }
      seen = pieceEnd;
    }
    return { line: linesSeen, column: target - lineStartOffset };
  }

  offsetAt(position: Position): number {
    const line = Math.max(0, Math.min(position.line, this.lineCount - 1));
    const start = this.offsetOfLine(line);
    const lineLength = this.getLine(line).length;
    return start + Math.max(0, Math.min(position.column, lineLength));
  }

  // ------------------------------------------------------------ mutation --

  /** Locate the piece holding `offset`, splitting it there if needed. */
  #splitAt(offset: number): number {
    if (offset <= 0) return 0;
    if (offset >= this.#length) return this.#pieces.length;

    let seen = 0;
    for (let i = 0; i < this.#pieces.length; i++) {
      const p = this.#pieces[i]!;
      const pieceEnd = seen + p.length;

      if (offset === seen) return i;

      if (offset < pieceEnd) {
        const localOffset = offset - seen;
        const text = this.#sourceText(p.src);
        const left: Piece = {
          src: p.src,
          start: p.start,
          length: localOffset,
          lineStarts: computeLineStarts(text, p.start, localOffset),
        };
        const right: Piece = {
          src: p.src,
          start: p.start + localOffset,
          length: p.length - localOffset,
          lineStarts: computeLineStarts(text, p.start + localOffset, p.length - localOffset),
        };
        this.#pieces.splice(i, 1, left, right);
        return i + 1;
      }
      seen = pieceEnd;
    }
    return this.#pieces.length;
  }

  #applyInsert(offset: number, text: string): void {
    if (text.length === 0) return;
    const index = this.#splitAt(offset);
    const start = this.#added.length;
    this.#added += text;
    this.#pieces.splice(index, 0, {
      src: 1,
      start,
      length: text.length,
      lineStarts: computeLineStarts(this.#added, start, text.length),
    });
    this.#length += text.length;
    this.version++;
  }

  #applyDelete(offset: number, length: number): void {
    if (length <= 0) return;
    const from = this.#splitAt(offset);
    const to = this.#splitAt(offset + length);
    this.#pieces.splice(from, to - from);
    this.#length -= length;
    this.version++;
  }

  // --------------------------------------------------------------- edits --

  #record(edit: Edit): void {
    if (this.#applying) return;

    this.#redo.length = 0;
    const now = Date.now();
    const isTypingForward =
      this.#pendingGroup !== null &&
      now - this.#lastEditAt < TYPING_MERGE_MS &&
      edit.removed === "" &&
      edit.offset === this.#lastEditEnd &&
      !edit.inserted.includes("\n");

    if (isTypingForward) {
      this.#pendingGroup!.push(edit);
    } else {
      this.#flushGroup();
      this.#pendingGroup = [edit];
    }

    this.#lastEditAt = now;
    this.#lastEditEnd = edit.offset + edit.inserted.length;
  }

  /** Close the current typing group so the next edit starts a new undo step. */
  #flushGroup(): void {
    if (this.#pendingGroup && this.#pendingGroup.length > 0) {
      this.#undo.push(this.#pendingGroup);
      if (this.#undo.length > 500) this.#undo.shift();
    }
    this.#pendingGroup = null;
  }

  /** Force the next edit to begin a fresh undo step (e.g. after a save). */
  breakUndoGroup(): void {
    this.#flushGroup();
    this.#lastEditEnd = -1;
  }

  insert(offset: number, text: string): void {
    if (text.length === 0) return;
    const at = Math.max(0, Math.min(offset, this.#length));
    this.#record({ offset: at, removed: "", inserted: text });
    this.#applyInsert(at, text);
  }

  delete(offset: number, length: number): string {
    const from = Math.max(0, Math.min(offset, this.#length));
    const count = Math.max(0, Math.min(length, this.#length - from));
    if (count === 0) return "";
    const removed = this.getTextRange(from, from + count);
    this.#record({ offset: from, removed, inserted: "" });
    this.#applyDelete(from, count);
    return removed;
  }

  replace(offset: number, length: number, text: string): void {
    const from = Math.max(0, Math.min(offset, this.#length));
    const count = Math.max(0, Math.min(length, this.#length - from));
    if (count === 0 && text.length === 0) return;

    const removed = count > 0 ? this.getTextRange(from, from + count) : "";
    this.#record({ offset: from, removed, inserted: text });
    if (count > 0) this.#applyDelete(from, count);
    if (text.length > 0) this.#applyInsert(from, text);
  }

  /** Replace the whole document, as a single undoable step. */
  setText(text: string): void {
    this.replace(0, this.#length, text);
    this.breakUndoGroup();
  }

  // ------------------------------------------------------------- history --

  get canUndo(): boolean {
    return this.#undo.length > 0 || (this.#pendingGroup?.length ?? 0) > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** Undo one step; returns where the caret should land, or null if empty. */
  undo(): number | null {
    this.#flushGroup();
    const group = this.#undo.pop();
    if (!group) return null;

    this.#applying = true;
    let caret = 0;
    // Reverse the group back-to-front so earlier offsets stay valid.
    for (let i = group.length - 1; i >= 0; i--) {
      const edit = group[i]!;
      if (edit.inserted.length > 0) this.#applyDelete(edit.offset, edit.inserted.length);
      if (edit.removed.length > 0) this.#applyInsert(edit.offset, edit.removed);
      caret = edit.offset + edit.removed.length;
    }
    this.#applying = false;

    this.#redo.push(group);
    this.#lastEditEnd = -1;
    return caret;
  }

  redo(): number | null {
    const group = this.#redo.pop();
    if (!group) return null;

    this.#applying = true;
    let caret = 0;
    for (const edit of group) {
      if (edit.removed.length > 0) this.#applyDelete(edit.offset, edit.removed.length);
      if (edit.inserted.length > 0) this.#applyInsert(edit.offset, edit.inserted);
      caret = edit.offset + edit.inserted.length;
    }
    this.#applying = false;

    this.#undo.push(group);
    this.#lastEditEnd = -1;
    return caret;
  }
}
