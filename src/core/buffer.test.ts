import { describe, expect, test } from "bun:test";
import { TextBuffer } from "./buffer.ts";

describe("TextBuffer reading", () => {
  test("round-trips its initial text", () => {
    const b = new TextBuffer("hello\nworld");
    expect(b.getText()).toBe("hello\nworld");
    expect(b.length).toBe(11);
    expect(b.lineCount).toBe(2);
  });

  test("reports lines and ranges", () => {
    const b = new TextBuffer("alpha\nbeta\ngamma");
    expect(b.getLine(0)).toBe("alpha");
    expect(b.getLine(1)).toBe("beta");
    expect(b.getLine(2)).toBe("gamma");
    expect(b.getTextRange(6, 10)).toBe("beta");
    expect(b.offsetOfLine(1)).toBe(6);
    expect(b.offsetOfLine(2)).toBe(11);
  });

  test("handles an empty buffer", () => {
    const b = new TextBuffer("");
    expect(b.getText()).toBe("");
    expect(b.lineCount).toBe(1);
    expect(b.getLine(0)).toBe("");
    expect(b.positionAt(0)).toEqual({ line: 0, column: 0 });
  });

  test("counts a trailing newline as a final empty line", () => {
    const b = new TextBuffer("a\n");
    expect(b.lineCount).toBe(2);
    expect(b.getLine(1)).toBe("");
  });

  test("normalizes CRLF but restores it on save", () => {
    const b = new TextBuffer("one\r\ntwo\r\n");
    expect(b.eol).toBe("\r\n");
    expect(b.getText()).toBe("one\ntwo\n");
    expect(b.lineCount).toBe(3);
    expect(b.getTextForSave()).toBe("one\r\ntwo\r\n");
  });
});

describe("TextBuffer positions", () => {
  test("maps offsets to positions and back", () => {
    const b = new TextBuffer("alpha\nbeta\ngamma");
    expect(b.positionAt(0)).toEqual({ line: 0, column: 0 });
    expect(b.positionAt(5)).toEqual({ line: 0, column: 5 });
    expect(b.positionAt(6)).toEqual({ line: 1, column: 0 });
    expect(b.positionAt(13)).toEqual({ line: 2, column: 2 });

    for (let offset = 0; offset <= b.length; offset++) {
      expect(b.offsetAt(b.positionAt(offset))).toBe(offset);
    }
  });

  test("clamps out-of-range input", () => {
    const b = new TextBuffer("ab");
    expect(b.positionAt(999)).toEqual({ line: 0, column: 2 });
    expect(b.offsetAt({ line: 99, column: 99 })).toBe(2);
    expect(b.offsetAt({ line: -1, column: -5 })).toBe(0);
  });
});

describe("TextBuffer mutation", () => {
  test("inserts at the start, middle and end", () => {
    const b = new TextBuffer("bd");
    b.insert(1, "c");
    expect(b.getText()).toBe("bcd");
    b.insert(0, "a");
    expect(b.getText()).toBe("abcd");
    b.insert(b.length, "e");
    expect(b.getText()).toBe("abcde");
  });

  test("deletes across piece boundaries", () => {
    const b = new TextBuffer("hello world");
    b.insert(5, ", cruel");
    expect(b.getText()).toBe("hello, cruel world");
    expect(b.delete(5, 7)).toBe(", cruel");
    expect(b.getText()).toBe("hello world");
  });

  test("keeps line bookkeeping correct after edits", () => {
    const b = new TextBuffer("a\nb");
    b.insert(1, "X\nY");
    expect(b.getText()).toBe("aX\nY\nb");
    expect(b.lineCount).toBe(3);
    expect(b.getLine(0)).toBe("aX");
    expect(b.getLine(1)).toBe("Y");
    expect(b.getLine(2)).toBe("b");

    b.delete(2, 2); // remove "\nY"
    expect(b.getText()).toBe("aX\nb");
    expect(b.lineCount).toBe(2);
  });

  test("replaces a range", () => {
    const b = new TextBuffer("the quick fox");
    b.replace(4, 5, "slow");
    expect(b.getText()).toBe("the slow fox");
  });

  test("setText swaps the whole document", () => {
    const b = new TextBuffer("old");
    b.setText("new\ncontent");
    expect(b.getText()).toBe("new\ncontent");
    expect(b.lineCount).toBe(2);
  });

  test("survives many interleaved edits", () => {
    const b = new TextBuffer("0123456789");
    let expected = "0123456789";
    for (let i = 0; i < 60; i++) {
      const at = (i * 7) % (expected.length + 1);
      const text = `<${i}>`;
      b.insert(at, text);
      expected = expected.slice(0, at) + text + expected.slice(at);
      expect(b.getText()).toBe(expected);
    }
    for (let i = 0; i < 30; i++) {
      const at = (i * 5) % Math.max(1, expected.length - 3);
      b.delete(at, 3);
      expected = expected.slice(0, at) + expected.slice(at + 3);
      expect(b.getText()).toBe(expected);
    }
    expect(b.lineCount).toBe(1);
  });
});

describe("TextBuffer history", () => {
  test("undoes and redoes a single edit", () => {
    const b = new TextBuffer("hello");
    b.insert(5, " world");
    b.breakUndoGroup();
    expect(b.getText()).toBe("hello world");

    expect(b.undo()).toBe(5);
    expect(b.getText()).toBe("hello");
    expect(b.redo()).toBe(11);
    expect(b.getText()).toBe("hello world");
  });

  test("undoes a delete by restoring text", () => {
    const b = new TextBuffer("abcdef");
    b.delete(2, 2);
    b.breakUndoGroup();
    expect(b.getText()).toBe("abef");
    b.undo();
    expect(b.getText()).toBe("abcdef");
  });

  test("groups consecutive typing into one step", () => {
    const b = new TextBuffer("");
    for (const ch of "hello") b.insert(b.length, ch);
    b.breakUndoGroup();
    expect(b.getText()).toBe("hello");

    b.undo();
    expect(b.getText()).toBe("");
    expect(b.canUndo).toBe(false);
  });

  test("starts a new group when the caret jumps", () => {
    const b = new TextBuffer("..");
    b.insert(0, "a");
    b.breakUndoGroup();
    b.insert(b.length, "z");
    b.breakUndoGroup();

    b.undo();
    expect(b.getText()).toBe("a..");
    b.undo();
    expect(b.getText()).toBe("..");
  });

  test("a fresh edit clears the redo stack", () => {
    const b = new TextBuffer("a");
    b.insert(1, "b");
    b.breakUndoGroup();
    b.undo();
    expect(b.canRedo).toBe(true);

    b.insert(1, "c");
    expect(b.canRedo).toBe(false);
    expect(b.getText()).toBe("ac");
  });

  test("undo restores multi-line structure", () => {
    const b = new TextBuffer("one\ntwo");
    b.replace(0, b.length, "single");
    b.breakUndoGroup();
    expect(b.lineCount).toBe(1);

    b.undo();
    expect(b.getText()).toBe("one\ntwo");
    expect(b.lineCount).toBe(2);
    expect(b.getLine(1)).toBe("two");
  });
});
