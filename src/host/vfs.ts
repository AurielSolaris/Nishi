/**
 * The VFS — Nishi's filesystem boundary.
 *
 * This is the only module in the tree that turns a `VfsPath` into a real
 * operating-system path, and the only one that holds the mapping. Everything
 * above it — the editor, the explorer, the save path, and in Stage 4 the
 * extension host — addresses files as `nishi://mount/segments` and cannot name
 * a file outside a mount, because there is no syntax for one.
 *
 * ## Why the editor, and not just extensions
 *
 * EXTRAS.md describes a VFS for extensions. Nishi puts the editor behind the
 * same boundary, for two reasons:
 *
 *   1. A boundary only used by guests is a boundary nobody tests. The editor is
 *      the heaviest user of the filesystem, so running it through the VFS means
 *      every bug in the mapping shows up in normal use rather than the first
 *      time an extension trips over it.
 *   2. Stage 4's extension host is a *second* consumer of this module, not a
 *      second implementation. `src/extensions/vfs.ts` will narrow this surface
 *      to a capability-checked subset — it will not re-derive path handling,
 *      which is where filesystem sandboxes usually fail.
 *
 * ## What it enforces
 *
 * Lexical containment is the cheap half and the half most editors stop at. The
 * expensive half is that a path can *become* an escape after it is validated:
 * a symlink inside the workspace pointing at `~/.ssh`, a directory swapped for
 * a link between the check and the open. So every mapping resolves the deepest
 * existing ancestor with `realpath` and re-checks containment against the
 * mount's own realpath. A workspace that contains a link out of itself is a
 * workspace whose link does not resolve — not a workspace that reads your keys.
 *
 * Capabilities are per mount, and checked at mapping time rather than by the
 * caller, so there is no "forgot to check" path. A read-only mount cannot be
 * written through by any caller, privileged or not.
 */

import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep, basename, relative } from "node:path";
import {
  WORKSPACE_MOUNT,
  formatVfsPath,
  mountRoot,
  parseVfsPath,
  VfsPathError,
  type VfsPath,
} from "../core/vfs-path.ts";

export type VfsCapability = "read" | "write" | "watch";

export type MountSpec = {
  id: string;
  /** Real directory this mount publishes. Never leaves the host. */
  realRoot: string;
  capabilities: readonly VfsCapability[];
};

export type Mount = {
  readonly id: string;
  readonly realRoot: string;
  readonly capabilities: ReadonlySet<VfsCapability>;
  /** Basename of the real root — the only part of it the UI is shown. */
  readonly label: string;
};

export type VfsErrorCode =
  | "malformed"
  | "no-such-mount"
  | "escape"
  | "denied"
  | "not-found"
  | "not-a-directory";

/**
 * Every refusal carries a code so hosts can map it to a status without pattern
 * matching on prose — the dev server used to test error messages with a regex,
 * which quietly reclassifies the moment a message is reworded.
 */
export class VfsError extends Error {
  constructor(
    readonly code: VfsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VfsError";
  }
}

/** Expand a leading `~`. Host-side only: `~` is not expressible in a VfsPath. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Elide the user's home directory for display: `C:\Users\ada\Code\nishi` reads
 * back as `~/Code/nishi`.
 *
 * The UI is shown this and never the raw path. It is not a security boundary —
 * the user can obviously see their own screen — but it keeps the username out
 * of the DOM, out of screenshots, and out of anything that later renders a
 * document title, which is the cheap half of EXTRAS.md's environment
 * virtualization and costs nothing to do now.
 */
export function displayRealPath(path: string): string {
  const home = homedir();
  const rel = relative(home, path);
  if (rel === "") return "~";
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
    return `~/${rel.split(sep).join("/")}`;
  }
  return path.split(sep).join("/");
}

/** True when `child` is `root` or sits underneath it, comparing whole segments. */
function contains(root: string, child: string): boolean {
  if (child === root) return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return child.startsWith(prefix);
}

/**
 * Resolve a real path to its canonical form, tolerating the tail not existing
 * yet — which is the normal case for `create` and for saving a new file.
 *
 * Walks up to the deepest ancestor that exists, canonicalizes *that* with
 * realpath, then re-appends the missing tail. The result is a path whose
 * existing portion contains no unresolved symlinks, which is what containment
 * has to be checked against. Checking the lexical path instead is the classic
 * hole: `workspace/link/secrets` is lexically inside the workspace and really
 * is not.
 */
async function canonicalize(target: string): Promise<string> {
  const missing: string[] = [];
  let probe = target;

  for (;;) {
    try {
      const resolved = await realpath(probe);
      return missing.length === 0 ? resolved : join(resolved, ...missing.reverse());
    } catch {
      const parent = resolve(probe, "..");
      // Hit the filesystem root without finding anything that exists. Only
      // reachable via a bogus mount root; treat it as unresolvable.
      if (parent === probe) throw new VfsError("not-found", "No part of this path exists");
      missing.push(basename(probe));
      probe = parent;
    }
  }
}

export class Vfs {
  #mounts = new Map<string, Mount>();

  get mounts(): readonly Mount[] {
    return [...this.#mounts.values()];
  }

  mount(spec: MountSpec): Mount {
    const realRoot = resolve(expandHome(spec.realRoot));
    const mount: Mount = {
      id: spec.id,
      realRoot,
      capabilities: new Set(spec.capabilities),
      label: basename(realRoot) || realRoot,
    };
    // Validate the id through the shared parser rather than a second regex here,
    // so "what is a legal mount id" has exactly one definition.
    mountRoot(mount.id);
    this.#mounts.set(mount.id, mount);
    return mount;
  }

  unmount(id: string): void {
    this.#mounts.delete(id);
  }

  lookup(id: string): Mount {
    const mount = this.#mounts.get(id);
    if (!mount) throw new VfsError("no-such-mount", `No mount named ${JSON.stringify(id)}`);
    return mount;
  }

  /** Replace a mount's backing directory, keeping its id and capabilities. */
  async remount(id: string, realRoot: string): Promise<Mount> {
    const previous = this.lookup(id);
    const target = resolve(expandHome(realRoot));

    let info;
    try {
      info = await stat(target);
    } catch {
      throw new VfsError("not-found", `No such folder: ${displayRealPath(target)}`);
    }
    if (!info.isDirectory()) {
      throw new VfsError("not-a-directory", `Not a folder: ${displayRealPath(target)}`);
    }

    return this.mount({
      id,
      realRoot: target,
      capabilities: [...previous.capabilities],
    });
  }

  /**
   * Map a VfsPath to a real path, checking the capability the caller needs.
   *
   * The capability argument is not advisory. There is no overload that skips
   * it, and no method that returns a real path without one, so a mount's
   * read-only status cannot be bypassed by calling a different function — the
   * mistake D9 exists to prevent, applied to the editor rather than to guests.
   */
  async toReal(path: VfsPath | string, need: VfsCapability): Promise<{ mount: Mount; real: string }> {
    let parsed;
    try {
      parsed = parseVfsPath(path);
    } catch (error) {
      const message = error instanceof VfsPathError ? error.message : String(error);
      throw new VfsError("malformed", message);
    }

    const mount = this.lookup(parsed.mount);
    if (!mount.capabilities.has(need)) {
      throw new VfsError("denied", `The ${mount.id} mount does not allow ${need}`);
    }

    const lexical = join(mount.realRoot, ...parsed.segments);
    // Cheap check first: a lexical escape here means the mount root itself is
    // odd, since the segments were already validated. Fail before touching disk.
    if (!contains(mount.realRoot, lexical)) {
      throw new VfsError("escape", "Path escapes its mount");
    }

    const realRoot = await canonicalize(mount.realRoot);
    const real = await canonicalize(lexical);
    if (!contains(realRoot, real)) {
      throw new VfsError("escape", "Path resolves outside its mount");
    }

    return { mount, real };
  }

  /**
   * Map a real path back to a VfsPath, or null when it is not inside the mount.
   *
   * Returning null rather than throwing is deliberate: the caller is usually the
   * file watcher, which is handed paths it did not ask for and must be able to
   * drop the ones outside a mount without treating them as errors.
   */
  toVfs(id: string, real: string): VfsPath | null {
    const mount = this.#mounts.get(id);
    if (!mount) return null;

    const absolute = resolve(real);
    if (!contains(mount.realRoot, absolute)) return null;

    const rel = relative(mount.realRoot, absolute);
    const segments = rel === "" ? [] : rel.split(sep).filter((s) => s !== "");
    try {
      return formatVfsPath(mount.id, segments);
    } catch {
      // A real file whose name is not expressible as a segment — a trailing dot,
      // a control character. It exists, but Nishi has no name for it, so it is
      // not in the workspace as far as the editor is concerned.
      return null;
    }
  }

  /** Convenience for the common case: the open folder. */
  get workspace(): Mount {
    return this.lookup(WORKSPACE_MOUNT);
  }
}

export { WORKSPACE_MOUNT, mountRoot };
export type { VfsPath };
