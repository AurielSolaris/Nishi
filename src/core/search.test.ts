import { describe, expect, test } from "bun:test";
import { TextBuffer } from "./buffer.ts";
import {
  EMPTY_OPTIONS,
  buildPattern,
  findMatches,
  nextMatchIndex,
  previousMatchIndex,
  replaceAll,
  type SearchOptions,
} from "./search.ts";

const opts = (over: Partial<SearchOptions> = {}): SearchOptions => ({ ...EMPTY_OPTIONS, ...over });

describe("findMatches", () => {
  test("finds every literal occurrence", () => {
    const b = new TextBuffer("cat catalog cat");
    const matches = findMatches(b, opts({ query: "cat" }));
    expect(matches).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 12, end: 15 },
    ]);
  });

  test("is case-insensitive by default and exact when asked", () => {
    const b = new TextBuffer("Cat cat CAT");
    expect(findMatches(b, opts({ query: "cat" }))).toHaveLength(3);
    expect(findMatches(b, opts({ query: "cat", caseSensitive: true }))).toHaveLength(1);
  });

  test("honours whole-word", () => {
    const b = new TextBuffer("cat catalog");
    const matches = findMatches(b, opts({ query: "cat", wholeWord: true }));
    expect(matches).toEqual([{ start: 0, end: 3 }]);
  });

  test("treats regex metacharacters literally unless regex is on", () => {
    const b = new TextBuffer("a.c abc");
    expect(findMatches(b, opts({ query: "a.c" }))).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches(b, opts({ query: "a.c", regex: true }))).toHaveLength(2);
  });

  test("an empty or invalid query yields nothing rather than throwing", () => {
    const b = new TextBuffer("anything");
    expect(findMatches(b, opts({ query: "" }))).toEqual([]);
    expect(buildPattern(opts({ query: "(unclosed", regex: true }))).toBeNull();
    expect(findMatches(b, opts({ query: "(unclosed", regex: true }))).toEqual([]);
  });

  test("skips zero-length matches instead of hanging", () => {
    const b = new TextBuffer("aaa");
    expect(findMatches(b, opts({ query: "b*", regex: true }))).toEqual([]);
  });

  test("matches across lines", () => {
    const b = new TextBuffer("one\ntwo\none");
    expect(findMatches(b, opts({ query: "one" }))).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });
});

describe("match navigation", () => {
  const matches = [
    { start: 0, end: 3 },
    { start: 10, end: 13 },
    { start: 20, end: 23 },
  ];

  test("next finds the first match at or after the offset", () => {
    expect(nextMatchIndex(matches, 0)).toBe(0);
    expect(nextMatchIndex(matches, 1)).toBe(1);
    expect(nextMatchIndex(matches, 11)).toBe(2);
  });

  test("next wraps around at the end", () => {
    expect(nextMatchIndex(matches, 99)).toBe(0);
  });

  test("previous finds the last match before the offset, wrapping", () => {
    expect(previousMatchIndex(matches, 15)).toBe(1);
    expect(previousMatchIndex(matches, 0)).toBe(2);
  });

  test("navigating an empty set reports -1", () => {
    expect(nextMatchIndex([], 0)).toBe(-1);
    expect(previousMatchIndex([], 0)).toBe(-1);
  });
});

describe("replaceAll", () => {
  test("replaces every occurrence", () => {
    const b = new TextBuffer("cat cat cat");
    expect(replaceAll(b, opts({ query: "cat" }), "dog")).toBe(3);
    expect(b.getText()).toBe("dog dog dog");
  });

  test("handles replacements longer and shorter than the match", () => {
    const b = new TextBuffer("a b a");
    replaceAll(b, opts({ query: "a" }), "longer");
    expect(b.getText()).toBe("longer b longer");

    const c = new TextBuffer("xxxx yy xxxx");
    replaceAll(c, opts({ query: "xxxx" }), "z");
    expect(c.getText()).toBe("z yy z");
  });

  test("expands capture groups for regex replacements", () => {
    const b = new TextBuffer("john smith");
    replaceAll(b, opts({ query: "(\\w+) (\\w+)", regex: true }), "$2, $1");
    expect(b.getText()).toBe("smith, john");
  });

  test("leaves $ alone in a literal replacement", () => {
    const b = new TextBuffer("price");
    replaceAll(b, opts({ query: "price" }), "$1");
    expect(b.getText()).toBe("$1");
  });

  test("replacing nothing changes nothing", () => {
    const b = new TextBuffer("abc");
    expect(replaceAll(b, opts({ query: "zzz" }), "x")).toBe(0);
    expect(b.getText()).toBe("abc");
  });

  test("the whole replacement undoes as one step per match", () => {
    const b = new TextBuffer("a a a");
    replaceAll(b, opts({ query: "a" }), "b");
    expect(b.getText()).toBe("b b b");

    b.undo();
    b.undo();
    b.undo();
    expect(b.getText()).toBe("a a a");
  });
});
