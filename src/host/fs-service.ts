/**
 * Filesystem service — the host-side half of the file explorer and save path.
 *
 * Lives in src/host/ rather than in the dev server because the Electrobun main
 * process (src/bun/index.ts) needs exactly these operations behind RPC. Keeping
 * them here means wiring the desktop shell reuses this file instead of
 * reimplementing it.
 */

import { readdir, readFile, writeFile, mkdir, stat, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep, basename, dirname } from "node:path";

export type EntryKind = "file" | "directory";

export type DirEntry = {
  name: string;
  /** Absolute path. */
  path: string;
  kind: EntryKind;
  size: number;
};

export type FileContent = {
  path: string;
  name: string;
  content: string;
  /** True when the file looked binary and was not decoded. */
  binary: boolean;
  size: number;
};

/** Never walked into by the explorer — noise, or big enough to hurt. */
const IGNORED = new Set([
  "node_modules",
  ".git",
  ".hutch",
  ".cottontail-tmp",
  "dist",
  "build",
  ".DS_Store",
]);

/** Refuse to open anything larger than this; Stage 1 has no virtualization. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export class FsService {
  #root: string;

  constructor(root: string = process.cwd()) {
    this.#root = resolve(root);
  }

  get root(): string {
    return this.#root;
  }

  async setRoot(path: string): Promise<string> {
    const target = resolve(this.#expand(path));
    const info = await stat(target);
    if (!info.isDirectory()) throw new Error("Not a directory");
    this.#root = target;
    return this.#root;
  }

  #expand(path: string): string {
    if (path === "~") return homedir();
    if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
    return path;
  }

  /**
   * Resolve a caller-supplied path and refuse anything outside the workspace
   * root. The explorer only ever needs paths inside the open folder, so this
   * closes off traversal without limiting legitimate use.
   */
  resolveInRoot(path: string): string {
    const expanded = this.#expand(path);
    const target = resolve(isAbsolute(expanded) ? expanded : join(this.#root, expanded));
    const prefix = this.#root.endsWith(sep) ? this.#root : this.#root + sep;
    if (target !== this.#root && !target.startsWith(prefix)) {
      throw new Error("Path escapes the workspace root");
    }
    return target;
  }

  async list(path?: string): Promise<{ path: string; entries: DirEntry[] }> {
    const dir = path ? this.resolveInRoot(path) : this.#root;
    const dirents = await readdir(dir, { withFileTypes: true });

    const entries: DirEntry[] = [];
    for (const dirent of dirents) {
      if (IGNORED.has(dirent.name)) continue;

      const full = join(dir, dirent.name);
      let size = 0;
      if (dirent.isFile()) {
        try {
          size = (await stat(full)).size;
        } catch {
          continue; // vanished or unreadable between readdir and stat
        }
      } else if (!dirent.isDirectory()) {
        continue; // skip sockets, symlink loops, devices
      }

      entries.push({
        name: dirent.name,
        path: full,
        kind: dirent.isDirectory() ? "directory" : "file",
        size,
      });
    }

    // Directories first, then case-insensitive by name — Atom's ordering.
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return { path: dir, entries };
  }

  async read(path: string): Promise<FileContent> {
    const target = this.resolveInRoot(path);
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(`File is too large to open (${Math.round(info.size / 1024 / 1024)} MB)`);
    }

    const bytes = await readFile(target);
    // A NUL byte in the first block is the usual binary tell.
    const binary = bytes.subarray(0, 4096).includes(0);

    return {
      path: target,
      name: basename(target),
      content: binary ? "" : bytes.toString("utf8"),
      binary,
      size: info.size,
    };
  }

  async write(path: string, content: string): Promise<{ path: string; size: number }> {
    const target = this.resolveInRoot(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return { path: target, size: Buffer.byteLength(content, "utf8") };
  }

  async create(path: string, kind: EntryKind): Promise<{ path: string }> {
    const target = this.resolveInRoot(path);
    if (kind === "directory") {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      // Never clobber an existing file.
      await writeFile(target, "", { encoding: "utf8", flag: "wx" });
    }
    return { path: target };
  }

  async rename(from: string, to: string): Promise<{ path: string }> {
    const source = this.resolveInRoot(from);
    const target = this.resolveInRoot(to);
    await rename(source, target);
    return { path: target };
  }

  async remove(path: string): Promise<void> {
    const target = this.resolveInRoot(path);
    if (target === this.#root) throw new Error("Refusing to delete the workspace root");
    await rm(target, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------- settings ----

/** Settings live outside the workspace so they follow the user, not the repo. */
const SETTINGS_DIR = join(homedir(), ".nishi");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

export async function loadSettingsFile(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    return {}; // absent or corrupt — callers fall back to defaults
  }
}

export async function saveSettingsFile(values: Record<string, unknown>): Promise<string> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(values, null, 2), "utf8");
  return SETTINGS_FILE;
}
