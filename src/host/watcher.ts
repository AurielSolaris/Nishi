/**
 * File watching — how the editor notices a change it did not make.
 *
 * Until now an external edit was invisible until the user hit Refresh. This
 * watches each watchable mount and pushes changes up to the view, which is the
 * other half of Stage 2's "better IPC": the host finally has something to say
 * on its own rather than only answering.
 *
 * Three things this deliberately does:
 *
 *   - **Emits VfsPaths, never real paths.** `fs.watch` hands back OS paths; they
 *     are translated here and dropped if they fall outside the mount. That keeps
 *     the watcher from becoming the one channel that leaks the layout of the
 *     disk back into the view.
 *   - **Coalesces.** A single save from another editor is routinely three or
 *     four events (write, truncate, rename-into-place). Debouncing per path
 *     turns that back into one, so the explorer does not thrash.
 *   - **Mutes our own writes.** Saving a file fires the same events as an
 *     external change. Without muting, every save would come back as "this file
 *     changed on disk" and the editor would argue with itself.
 */

import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { sep } from "node:path";
import type { FsChange } from "../core/host-rpc.ts";
import { formatVfsPath, type VfsPath } from "../core/vfs-path.ts";
import { IGNORED } from "./fs-service.ts";
import type { Vfs } from "./vfs.ts";

export type { FsChange, FsChangeType } from "../core/host-rpc.ts";

export type FsChangeListener = (changes: FsChange[]) => void;

export type WatcherOptions = {
  /** How long to gather events before emitting a batch. */
  debounceMs: number;
  /** How long a path stays muted after we write it ourselves. */
  muteMs: number;
};

export const DEFAULT_WATCHER_OPTIONS: WatcherOptions = {
  debounceMs: 120,
  muteMs: 1500,
};

export class FsWatcher {
  #vfs: Vfs;
  #options: WatcherOptions;
  #watchers = new Map<string, FSWatcher>();
  #listeners = new Set<FsChangeListener>();

  /** Paths seen since the last flush, deduplicated. */
  #pending = new Set<VfsPath>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** uri -> timestamp after which events for it count again. */
  #muted = new Map<VfsPath, number>();

  /** True when the platform refused a recursive watch; reported once. */
  degraded = false;

  constructor(vfs: Vfs, options: Partial<WatcherOptions> = {}) {
    this.#vfs = vfs;
    this.#options = { ...DEFAULT_WATCHER_OPTIONS, ...options };
  }

  onChange(listener: FsChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Ignore events for a path for a moment.
   *
   * Called by the host around its own writes. It is a time window rather than a
   * counter because one logical save produces an unpredictable number of events
   * — counting them means guessing, and a wrong guess either leaks an echo or
   * swallows a real external change that landed in the same instant.
   */
  mute(uri: VfsPath): void {
    this.#muted.set(uri, Date.now() + this.#options.muteMs);
  }

  /** Begin watching a mount. Re-entrant: watching an already-watched mount restarts it. */
  watchMount(mountId: string): void {
    this.unwatchMount(mountId);

    const mount = this.#vfs.lookup(mountId);
    if (!mount.capabilities.has("watch")) return;

    try {
      const watcher = watch(mount.realRoot, { recursive: true, persistent: false }, (_event, filename) => {
        if (filename === null) return;
        this.#note(mountId, String(filename));
      });
      watcher.on("error", (error) => {
        console.warn(`[nishi] watch error on ${mountId}:`, error);
      });
      this.#watchers.set(mountId, watcher);
    } catch (error) {
      // Recursive watching is not available everywhere. Degrade to no watching
      // rather than to a watcher that silently sees only the top level — the
      // manual Refresh still works, and claiming to watch when we do not is
      // worse than admitting we do not.
      this.degraded = true;
      console.warn(`[nishi] recursive watch unavailable for ${mountId}; external changes need Refresh`, error);
    }
  }

  unwatchMount(mountId: string): void {
    this.#watchers.get(mountId)?.close();
    this.#watchers.delete(mountId);
  }

  stop(): void {
    for (const id of [...this.#watchers.keys()]) this.unwatchMount(id);
    clearTimeout(this.#timer);
    this.#pending.clear();
  }

  #note(mountId: string, relative: string): void {
    const segments = relative.split(sep).filter((s) => s !== "");
    if (segments.length === 0) return;
    // A change anywhere under an ignored folder is noise by definition.
    if (segments.some((segment) => IGNORED.has(segment))) return;

    let uri: VfsPath;
    try {
      uri = formatVfsPath(mountId, segments);
    } catch {
      return; // not expressible as a VfsPath, so not a file the editor knows
    }

    this.#pending.add(uri);
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#flush(), this.#options.debounceMs);
  }

  async #flush(): Promise<void> {
    const batch = [...this.#pending];
    this.#pending.clear();
    if (batch.length === 0) return;

    const now = Date.now();
    for (const [uri, until] of this.#muted) {
      if (until <= now) this.#muted.delete(uri);
    }

    const changes: FsChange[] = [];
    for (const uri of batch) {
      if ((this.#muted.get(uri) ?? 0) > now) continue;

      // Ask the VFS rather than the raw path: a change under a symlink that now
      // points out of the mount must not be reported as a workspace change.
      let real: string;
      try {
        ({ real } = await this.#vfs.toReal(uri, "watch"));
      } catch {
        continue;
      }

      try {
        const info = await stat(real);
        changes.push({
          uri,
          type: "changed",
          kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "unknown",
        });
      } catch {
        // Gone. Rename shows up as a removal here plus a change at the new name,
        // which is all the explorer needs to redraw correctly.
        changes.push({ uri, type: "removed", kind: "unknown" });
      }
    }

    if (changes.length === 0) return;
    for (const listener of this.#listeners) {
      try {
        listener(changes);
      } catch (error) {
        console.error("[nishi] fs change listener threw", error);
      }
    }
  }
}
