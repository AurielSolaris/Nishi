import { describe, expect, test } from "bun:test";
import {
  formatVfsPath,
  isVfsPath,
  mountRoot,
  parseVfsPath,
  splitRelative,
  vfsBasename,
  vfsContains,
  vfsDirname,
  vfsDisplay,
  vfsJoin,
  VfsPathError,
  type VfsPath,
} from "./vfs-path.ts";

const root = mountRoot("workspace");

describe("parsing", () => {
  test("splits a mount from its segments", () => {
    expect(parseVfsPath("nishi://workspace/src/core/buffer.ts")).toEqual({
      mount: "workspace",
      segments: ["src", "core", "buffer.ts"],
    });
  });

  test("a mount root has no segments", () => {
    expect(parseVfsPath(root).segments).toEqual([]);
    expect(root).toBe("nishi://workspace/" as VfsPath);
  });

  test("collapses repeated and trailing slashes", () => {
    expect(parseVfsPath("nishi://workspace//src///a.ts/").segments).toEqual(["src", "a.ts"]);
  });

  test("rejects anything without the scheme", () => {
    expect(() => parseVfsPath("/etc/passwd")).toThrow(VfsPathError);
    expect(() => parseVfsPath("C:\\Users\\ada")).toThrow(VfsPathError);
    expect(() => parseVfsPath("file:///etc/passwd")).toThrow(VfsPathError);
    expect(isVfsPath("nishi:/workspace/a")).toBe(false);
  });

  test("rejects an illegal mount id", () => {
    expect(() => parseVfsPath("nishi://Workspace/a")).toThrow(VfsPathError);
    expect(() => parseVfsPath("nishi://../a")).toThrow(VfsPathError);
    expect(() => parseVfsPath("nishi:///a")).toThrow(VfsPathError);
  });
});

describe("segment rules", () => {
  // Each of these is a way a path can mean something other than it looks like.
  const illegal: [string, string][] = [
    ["traversal", "nishi://workspace/src/../../etc/passwd"],
    ["a bare parent segment", "nishi://workspace/.."],
    ["a backslash inside a name", "nishi://workspace/src\\..\\secret"],
    ["an NTFS alternate data stream", "nishi://workspace/notes.txt:hidden"],
    ["a drive letter", "nishi://workspace/C:/Windows"],
    ["a trailing dot", "nishi://workspace/evil."],
    ["a trailing space", "nishi://workspace/evil "],
    ["a reserved device", "nishi://workspace/CON"],
    ["a reserved device with an extension", "nishi://workspace/lpt1.txt"],
  ];

  for (const [why, path] of illegal) {
    test(`rejects ${why}`, () => {
      expect(() => parseVfsPath(path)).toThrow(VfsPathError);
      expect(isVfsPath(path)).toBe(false);
    });
  }

  test("rejects a control character in a name", () => {
    expect(() => parseVfsPath("nishi://workspace/safe\u0000.txt")).toThrow(VfsPathError);
  });

  test("percent sequences stay literal rather than being decoded", () => {
    // Decoding here is what would let %2e%2e arrive as a legal segment and leave
    // as `..`, so `%` is just a character a file may be named with.
    const path = parseVfsPath("nishi://workspace/100%25.txt");
    expect(path.segments).toEqual(["100%25.txt"]);

    const encoded = parseVfsPath("nishi://workspace/%2e%2e");
    expect(encoded.segments).toEqual(["%2e%2e"]);
    expect(encoded.segments).not.toEqual([".."]);
  });

  test("accepts ordinary names, including dotfiles and spaces", () => {
    expect(parseVfsPath("nishi://workspace/.gitignore").segments).toEqual([".gitignore"]);
    expect(parseVfsPath("nishi://workspace/My Notes.md").segments).toEqual(["My Notes.md"]);
    expect(parseVfsPath("nishi://workspace/a.b.c").segments).toEqual(["a.b.c"]);
  });
});

describe("construction", () => {
  test("join validates the names it is given", () => {
    expect(vfsJoin(root, "src", "a.ts")).toBe("nishi://workspace/src/a.ts" as VfsPath);
    expect(() => vfsJoin(root, "..")).toThrow(VfsPathError);
    expect(() => vfsJoin(root, "a/../..")).toThrow(VfsPathError);
  });

  test("format refuses to build an illegal path", () => {
    expect(() => formatVfsPath("workspace", ["..", "etc"])).toThrow(VfsPathError);
  });

  test("splitRelative turns user input into validated segments", () => {
    expect(splitRelative("src\\core/a.ts")).toEqual(["src", "core", "a.ts"]);
    expect(() => splitRelative("../outside.txt")).toThrow(VfsPathError);
  });
});

describe("navigation", () => {
  const file = vfsJoin(root, "src", "core", "buffer.ts");

  test("dirname walks up and stops at the mount root", () => {
    expect(vfsDirname(file)).toBe("nishi://workspace/src/core" as VfsPath);
    expect(vfsDirname(vfsDirname(vfsDirname(file)))).toBe(root);
    expect(vfsDirname(root)).toBe(root);
  });

  test("basename is the last segment, or the mount at the root", () => {
    expect(vfsBasename(file)).toBe("buffer.ts");
    expect(vfsBasename(root)).toBe("workspace");
  });

  test("contains compares whole segments", () => {
    expect(vfsContains(root, file)).toBe(true);
    expect(vfsContains(vfsJoin(root, "src"), file)).toBe(true);
    expect(vfsContains(file, root)).toBe(false);
    // "src" must not be treated as a prefix of "srcfoo".
    expect(vfsContains(vfsJoin(root, "src"), vfsJoin(root, "srcfoo", "a.ts"))).toBe(false);
  });

  test("display is workspace-relative and mount-qualified elsewhere", () => {
    expect(vfsDisplay(file)).toBe("src/core/buffer.ts");
    expect(vfsDisplay(root)).toBe("/");
    expect(vfsDisplay(formatVfsPath("settings", ["keymap.json"]))).toBe("settings:/keymap.json");
  });
});
