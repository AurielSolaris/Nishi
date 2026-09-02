/**
 * VFS paths — the only way the editor names a file.
 *
 * Nishi's UI never handles an operating-system path. It handles a `VfsPath`:
 *
 *     nishi://workspace/src/core/buffer.ts
 *
 * A mount id, then POSIX segments. No drive letters, no UNC roots, no `~`, no
 * backslashes, no notion that a filesystem outside the mount exists. The host
 * (src/host/vfs.ts) owns the mount table and is the only place a VfsPath
 * becomes a real path.
 *
 * This module is deliberately free of node imports so the view bundle and the
 * host can share one definition of what a legal path is — a second, laxer
 * parser on the view side would be a way to smuggle segments past the host.
 *
 * **This is not a URL.** It borrows the shape because it reads well, but it is
 * never percent-decoded and must never be handed to `new URL()`. Decoding is
 * exactly the step that would let `%2e%2e` arrive here looking like an ordinary
 * segment and leave as `..`, so there is no decode step to exploit: `%` is an
 * ordinary character in a filename and stays one.
 *
 * Nothing here is a security boundary on its own. The host re-validates
 * everything it is handed; these helpers exist so the UI does not have to build
 * strings by hand and get it subtly wrong. Enforcement lives host-side, where it
 * cannot be skipped by a caller that forgot to call a helper.
 */

/**
 * A validated `nishi://mount/segments` string.
 *
 * Branded so a plain string cannot be passed where a path is expected —
 * `fs.read(userInput)` stops compiling, which is the point.
 */
export type VfsPath = string & { readonly __vfs: unique symbol };

export const VFS_SCHEME = "nishi://";

/** The mount the open folder is published under. */
export const WORKSPACE_MOUNT = "workspace";

export type ParsedVfsPath = {
  mount: string;
  /** POSIX segments, already validated. Empty for the mount root. */
  segments: string[];
};

export class VfsPathError extends Error {
  constructor(
    message: string,
    readonly input: string,
  ) {
    super(message);
    this.name = "VfsPathError";
  }
}

/**
 * Names Windows resolves to a device rather than a file, with or without an
 * extension: `CON`, `NUL`, `COM3`, `LPT1.txt`. Writing to one is not writing to
 * a file, so they never name anything in a Nishi mount — on any platform, so a
 * workspace stays portable and a path minted on Linux cannot become a device
 * when the same folder is opened on Windows.
 */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Mount ids stay boring so they can never be confused with a segment. */
const MOUNT_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** NUL through US, plus DEL. Written as escapes so the source stays printable. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Reject a segment that cannot safely name a file.
 *
 * The list is longer than traversal alone because several of these are escapes
 * only on some filesystems, and a mount must mean the same thing everywhere:
 *
 *   - `.` / `..`       — traversal, the obvious one.
 *   - `/` `\`          — a separator hiding inside a name is traversal in disguise.
 *   - `:`              — an NTFS alternate data stream (`notes.txt:hidden`), a
 *                        second file the explorer would never show; on Windows
 *                        also a drive-letter split.
 *   - control chars    — a NUL truncates the path in any C-level syscall, so a
 *                        name with one in it is two different paths depending on
 *                        who is looking at it.
 *   - trailing ` `/`.` — Windows strips these when opening, so `evil.` and
 *                        `evil` are one file to the OS and two entries to us.
 */
export function assertSegment(segment: string, input: string): void {
  const fail = (why: string): never => {
    throw new VfsPathError(`Illegal path segment ${JSON.stringify(segment)}: ${why}`, input);
  };

  if (segment === "") fail("empty");
  if (segment === "." || segment === "..") fail("relative traversal");
  if (segment.includes("/") || segment.includes("\\")) fail("contains a path separator");
  if (segment.includes(":")) fail("contains a colon");
  if (CONTROL_CHARS.test(segment)) fail("contains a control character");
  if (segment.endsWith(" ") || segment.endsWith(".")) fail("ends with a space or dot");
  if (WINDOWS_DEVICE.test(segment)) fail("names a reserved device");
  if (segment.length > 255) fail("too long");
}

export function isVfsPath(value: unknown): value is VfsPath {
  if (typeof value !== "string") return false;
  try {
    parseVfsPath(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse and validate. Throws rather than returning null: every caller that
 * reached here already believes it holds a path, so a bad one is a bug or an
 * attack, and neither should vanish into an `if (!parsed)` branch.
 */
export function parseVfsPath(input: string): ParsedVfsPath {
  if (typeof input !== "string" || !input.startsWith(VFS_SCHEME)) {
    throw new VfsPathError(`Not a Nishi path (expected ${VFS_SCHEME}...)`, String(input));
  }

  const rest = input.slice(VFS_SCHEME.length);
  const slash = rest.indexOf("/");
  const mount = slash === -1 ? rest : rest.slice(0, slash);
  if (!MOUNT_ID.test(mount)) {
    throw new VfsPathError(`Illegal mount id ${JSON.stringify(mount)}`, input);
  }

  const tail = slash === -1 ? "" : rest.slice(slash + 1);
  const segments = tail.split("/").filter((s) => s !== "");
  for (const segment of segments) assertSegment(segment, input);

  return { mount, segments };
}

export function formatVfsPath(mount: string, segments: readonly string[]): VfsPath {
  if (!MOUNT_ID.test(mount)) {
    throw new VfsPathError(`Illegal mount id ${JSON.stringify(mount)}`, mount);
  }
  const joined = segments.join("/");
  for (const segment of segments) assertSegment(segment, joined);
  return `${VFS_SCHEME}${mount}/${joined}` as VfsPath;
}

/** The root of a mount, e.g. `nishi://workspace/`. */
export function mountRoot(mount: string): VfsPath {
  return formatVfsPath(mount, []);
}

/** Append segments. Each is validated, so a name typed by the user is safe here. */
export function vfsJoin(base: VfsPath, ...names: string[]): VfsPath {
  const { mount, segments } = parseVfsPath(base);
  return formatVfsPath(mount, [...segments, ...names]);
}

/** The containing directory. The root of a mount is its own parent. */
export function vfsDirname(path: VfsPath): VfsPath {
  const { mount, segments } = parseVfsPath(path);
  return formatVfsPath(mount, segments.slice(0, -1));
}

/** Final segment, or the mount id at the root. */
export function vfsBasename(path: VfsPath): string {
  const { mount, segments } = parseVfsPath(path);
  return segments.at(-1) ?? mount;
}

/** True when `path` is `parent` or sits underneath it. */
export function vfsContains(parent: VfsPath, path: VfsPath): boolean {
  const a = parseVfsPath(parent);
  const b = parseVfsPath(path);
  if (a.mount !== b.mount || b.segments.length < a.segments.length) return false;
  return a.segments.every((segment, i) => b.segments[i] === segment);
}

/**
 * Human-readable form for tab titles and the status bar: `src/core/buffer.ts`
 * inside the workspace, `settings:/keymap.json` elsewhere. Never round-trip this
 * back into a path — it is lossy on purpose.
 */
export function vfsDisplay(path: VfsPath): string {
  const { mount, segments } = parseVfsPath(path);
  const tail = segments.join("/");
  if (mount === WORKSPACE_MOUNT) return tail === "" ? "/" : tail;
  return `${mount}:/${tail}`;
}

/** Split a user-typed relative path into segments, validating each one. */
export function splitRelative(input: string): string[] {
  const segments = input.split(/[\\/]+/).filter((s) => s !== "");
  for (const segment of segments) assertSegment(segment, input);
  return segments;
}
