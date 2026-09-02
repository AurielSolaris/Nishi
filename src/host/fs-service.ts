/**
 * Filesystem service — the host-side half of the file explorer and save path.
 *
 * Lives in src/host/ rather than in the dev server because the Electrobun main
 * process (src/bun/index.ts) needs exactly these operations behind RPC. Keeping
 * them here means both hosts share one implementation instead of drifting.
 *
 * Every method takes and returns `VfsPath` (src/core/vfs-path.ts). No real
 * operating-system path enters or leaves this class — the mapping happens in
 * src/host/vfs.ts, once, with capability and containment checks that no caller
 * can skip. The one exception is `openFolder`, which is how a real directory
 * becomes a mount in the first place; it is marked loudly below.
 */

import { readdir, readFile, writeFile, mkdir, stat, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  DirEntry,
  EntryKind,
  FileContent,
  WorkspaceInfo,
  WriteResult,
} from "../core/host-rpc.ts";
import {
  WORKSPACE_MOUNT,
  formatVfsPath,
  mountRoot,
  parseVfsPath,
  vfsBasename,
  type VfsPath,
} from "../core/vfs-path.ts";
import { Vfs, VfsError, displayRealPath } from "./vfs.ts";

export type { DirEntry, EntryKind, FileContent, WorkspaceInfo } from "../core/host-rpc.ts";

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

export { IGNORED };

/** Refuse to open anything larger than this; there is no virtualization yet. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export class FsService {
  readonly vfs: Vfs;

  constructor(vfs: Vfs) {
    this.vfs = vfs;
  }

  /**
   * Build a service with the open folder mounted read-write.
   *
   * `realRoot` is the one real path this class ever accepts, and it comes from
   * the user choosing a folder — the same authority a native open dialog would
   * carry. Everything downstream of here is addressed through the mount.
   */
  static withWorkspace(realRoot: string): FsService {
    const vfs = new Vfs();
    vfs.mount({
      id: WORKSPACE_MOUNT,
      realRoot,
      capabilities: ["read", "write", "watch"],
    });
    return new FsService(vfs);
  }

  get workspace(): WorkspaceInfo {
    const mount = this.vfs.workspace;
    return {
      uri: mountRoot(mount.id),
      label: mount.label,
      displayPath: displayRealPath(mount.realRoot),
    };
  }

  /**
   * Point the workspace mount at a different real folder.
   *
   * PRIVILEGED. This is the only way a new region of the real filesystem becomes
   * reachable, so it belongs to the user's explicit "open folder" gesture and
   * nothing else. It must never be reachable from extension code (Stage 4) or
   * from a document's own content.
   */
  async openFolder(realPath: string): Promise<WorkspaceInfo> {
    await this.vfs.remount(WORKSPACE_MOUNT, realPath);
    return this.workspace;
  }

  // ------------------------------------------------------------ reading --

  async list(path?: VfsPath): Promise<{ path: VfsPath; entries: DirEntry[] }> {
    const uri = path ?? mountRoot(WORKSPACE_MOUNT);
    const { mount, real } = await this.vfs.toReal(uri, "read");
    const { segments } = parseVfsPath(uri);

    const dirents = await readdir(real, { withFileTypes: true });
    const entries: DirEntry[] = [];

    for (const dirent of dirents) {
      if (IGNORED.has(dirent.name)) continue;

      // Build the child path from the *requested* segments rather than from the
      // resolved real path: `real` may have been canonicalized through a link,
      // and the explorer should keep addressing files by the route the user
      // navigated, not by wherever they physically live.
      let childUri: VfsPath;
      try {
        childUri = formatVfsPath(mount.id, [...segments, dirent.name]);
      } catch {
        // A real file Nishi has no legal name for — a trailing dot, a control
        // character. It exists on disk; it is not addressable here, and showing
        // a row that cannot be opened is worse than omitting it.
        continue;
      }

      const link = dirent.isSymbolicLink();
      let kind: EntryKind;
      let size = 0;

      if (link) {
        // A link is only listed if it still lands inside the mount. toReal does
        // the canonical containment check, so a link out of the workspace simply
        // is not in the workspace.
        try {
          await this.vfs.toReal(childUri, "read");
          const info = await stat(join(real, dirent.name));
          if (info.isDirectory()) kind = "directory";
          else if (info.isFile()) {
            kind = "file";
            size = info.size;
          } else continue;
        } catch {
          continue;
        }
      } else if (dirent.isDirectory()) {
        kind = "directory";
      } else if (dirent.isFile()) {
        kind = "file";
        try {
          size = (await stat(join(real, dirent.name))).size;
        } catch {
          continue; // vanished between readdir and stat
        }
      } else {
        continue; // sockets, devices, fifos
      }

      entries.push({ name: dirent.name, path: childUri, kind, size, link });
    }

    // Directories first, then case-insensitive by name — Atom's ordering.
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return { path: uri, entries };
  }

  async read(path: VfsPath): Promise<FileContent> {
    const { real } = await this.vfs.toReal(path, "read");

    const info = await stat(real);
    if (!info.isFile()) throw new VfsError("not-found", "Not a file");
    if (info.size > MAX_FILE_BYTES) {
      throw new VfsError(
        "denied",
        `File is too large to open (${Math.round(info.size / 1024 / 1024)} MB)`,
      );
    }

    const bytes = await readFile(real);
    // A NUL byte in the first block is the usual binary tell.
    const binary = bytes.subarray(0, 4096).includes(0);

    return {
      path,
      name: vfsBasename(path),
      content: binary ? "" : bytes.toString("utf8"),
      binary,
      size: info.size,
      modifiedMs: info.mtimeMs,
    };
  }

  /** Modification time, or null when the file is gone. Used by change detection. */
  async modifiedMs(path: VfsPath): Promise<number | null> {
    try {
      const { real } = await this.vfs.toReal(path, "read");
      return (await stat(real)).mtimeMs;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ writing --

  async write(path: VfsPath, content: string): Promise<WriteResult> {
    const { real } = await this.vfs.toReal(path, "write");
    await mkdir(dirname(real), { recursive: true });
    await writeFile(real, content, "utf8");

    let modifiedMs = Date.now();
    try {
      modifiedMs = (await stat(real)).mtimeMs;
    } catch {
      // Written but unstattable — keep the wall clock rather than failing a save.
    }

    return { path, size: Buffer.byteLength(content, "utf8"), modifiedMs };
  }

  async create(path: VfsPath, kind: EntryKind): Promise<{ path: VfsPath }> {
    const { real } = await this.vfs.toReal(path, "write");
    if (kind === "directory") {
      await mkdir(real, { recursive: true });
    } else {
      await mkdir(dirname(real), { recursive: true });
      // Never clobber an existing file.
      await writeFile(real, "", { encoding: "utf8", flag: "wx" });
    }
    return { path };
  }

  async rename(from: VfsPath, to: VfsPath): Promise<{ path: VfsPath }> {
    const source = await this.vfs.toReal(from, "write");
    const target = await this.vfs.toReal(to, "write");
    await rename(source.real, target.real);
    return { path: to };
  }

  async remove(path: VfsPath): Promise<void> {
    const { mount, real } = await this.vfs.toReal(path, "write");
    if (parseVfsPath(path).segments.length === 0) {
      throw new VfsError("denied", `Refusing to delete the ${mount.id} root`);
    }
    await rm(real, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------- settings ----

/**
 * Settings live outside the workspace so they follow the user, not the repo.
 *
 * They are handled by real path rather than through the VFS on purpose: the
 * settings file is host state, not a document, and mounting `~/.nishi` would
 * make it addressable — and therefore writable — from anywhere that holds a
 * VfsPath, including Stage 4's extensions. Keeping it off the mount table means
 * the only way to change settings is the settings API.
 */
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
