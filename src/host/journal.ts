/**
 * The dirty-buffer journal — unsaved work that survives being unloaded, and
 * survives the process dying.
 *
 * ## Why this exists
 *
 * D11 says a dirty document is never evicted, because unsaved text exists only
 * in memory and dropping it destroys the user's work. That rule is correct and
 * it is also a leak with a nice name: leave twenty modified files open and Nishi
 * holds all twenty forever, which is precisely the memory the document cache was
 * built to reclaim.
 *
 * The journal is the way out. Unsaved content is written to `~/.nishi/journal/`
 * shortly after it changes, so the in-memory copy stops being the *only* copy.
 * Once a document is journalled it may be unloaded like any other, and reviving
 * it reads the journal rather than the file — restoring the edits, not the last
 * saved state.
 *
 * The rule therefore tightens rather than relaxes:
 *
 *     A DIRTY DOCUMENT IS NEVER EVICTED UNTIL ITS CONTENT IS RECOVERABLE.
 *
 * "Recoverable" was always the real test; before the journal, "saved to its own
 * file" was the only way to satisfy it.
 *
 * ## The free half
 *
 * Content on disk before the process ends is also content that survives the
 * process ending badly. Recovering unsaved work after a crash falls out of the
 * same mechanism, so the journal is checked at startup and anything left behind
 * is offered back.
 *
 * ## Why not inside the workspace
 *
 * The journal is host state, addressed by real path, and deliberately not on the
 * VFS mount table — the same reasoning as the settings file (D13). If it were
 * mountable it would be addressable, and therefore writable, by anything holding
 * a VfsPath, including Stage 4's extensions. Journalled work is exactly the sort
 * of thing that should not be reachable that way.
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { VfsPath } from "../core/vfs-path.ts";

/**
 * One document's unsaved state.
 *
 * `key` is the document's stable identity — a UUID minted when the document is
 * opened, not its `doc-N` runtime id, which is a counter that restarts every
 * session and would collide across runs.
 */
export type JournalEntry = {
  key: string;
  /** null for a buffer that has never been saved anywhere. */
  path: VfsPath | null;
  name: string;
  content: string;
  /** When this journal record was written. */
  journalledAt: number;
  /**
   * Modification time of the underlying file when the edits began.
   *
   * Recovery compares it against the file now: if the file changed since, the
   * journal may be based on a version that no longer exists, and silently
   * restoring over it would undo whatever happened in between.
   */
  baseModifiedMs: number;
};

/** A recovered entry, plus what recovery found on disk. */
export type RecoveredEntry = JournalEntry & {
  /** True when the underlying file changed after these edits were journalled. */
  fileChangedSince: boolean;
  /** True when the file the edits belong to is no longer there. */
  fileMissing: boolean;
};

const JOURNAL_DIR = join(homedir(), ".nishi", "journal");

/** Keys become filenames, so they must not be able to name anything else. */
const SAFE_KEY = /^[A-Za-z0-9_-]{1,64}$/;

function assertKey(key: string): void {
  if (!SAFE_KEY.test(key)) throw new Error(`Illegal journal key ${JSON.stringify(key)}`);
}

export class Journal {
  #dir: string;

  constructor(dir: string = JOURNAL_DIR) {
    this.#dir = dir;
  }

  get directory(): string {
    return this.#dir;
  }

  #file(key: string): string {
    assertKey(key);
    return join(this.#dir, `${key}.json`);
  }

  /**
   * Write a document's unsaved content.
   *
   * Written to a temporary file and renamed into place, never written over the
   * live record. A partial write here is a corrupt journal, and a corrupt
   * journal is worse than none: it is the copy someone reaches for precisely
   * when the other copy is already gone. `rename` replaces atomically on POSIX,
   * and Node's implementation uses `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`
   * on Windows, so the record is never observed half-written on either.
   */
  async put(entry: JournalEntry): Promise<void> {
    await mkdir(this.#dir, { recursive: true });

    const target = this.#file(entry.key);
    const temporary = `${target}.${process.pid}.tmp`;

    await writeFile(temporary, JSON.stringify(entry), "utf8");
    try {
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<JournalEntry | null> {
    try {
      return JSON.parse(await readFile(this.#file(key), "utf8")) as JournalEntry;
    } catch {
      return null;
    }
  }

  /** Forget a document's unsaved state — it was saved, or deliberately discarded. */
  async drop(key: string): Promise<void> {
    await rm(this.#file(key), { force: true });
  }

  /**
   * Everything the journal is still holding.
   *
   * Unreadable records are skipped rather than thrown on: one corrupt file must
   * not deny the user the other nine that are fine.
   */
  async list(): Promise<JournalEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.#dir);
    } catch {
      return []; // no journal directory yet — nothing was ever unsaved
    }

    const entries: JournalEntry[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue; // skip .tmp leftovers from a crash
      try {
        const parsed = JSON.parse(await readFile(join(this.#dir, name), "utf8")) as JournalEntry;
        if (typeof parsed.key === "string" && typeof parsed.content === "string") {
          entries.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return entries.sort((a, b) => b.journalledAt - a.journalledAt);
  }

  /** Remove temporary files a crashed run left behind. */
  async sweepTemporaries(): Promise<void> {
    try {
      for (const name of await readdir(this.#dir)) {
        if (name.endsWith(".tmp")) await rm(join(this.#dir, name), { force: true });
      }
    } catch {
      // No directory, or no permission to tidy it. Not worth failing startup.
    }
  }

  async clear(): Promise<void> {
    await rm(this.#dir, { recursive: true, force: true });
  }
}

/**
 * Journal entries left over from a previous run, annotated with what the
 * filesystem looks like now.
 *
 * `resolveReal` maps a VfsPath to a real path, or null when the path is not in
 * any current mount — a journal entry for a folder that is no longer open is
 * still worth showing, it just cannot be compared against a file.
 */
export async function recover(
  journal: Journal,
  resolveReal: (path: VfsPath) => Promise<string | null>,
): Promise<RecoveredEntry[]> {
  await journal.sweepTemporaries();

  const recovered: RecoveredEntry[] = [];
  for (const entry of await journal.list()) {
    let fileChangedSince = false;
    let fileMissing = false;

    if (entry.path !== null) {
      const real = await resolveReal(entry.path);
      if (real === null) {
        fileMissing = true;
      } else {
        try {
          const info = await stat(real);
          // A whole millisecond of slack: mtime resolution varies by filesystem
          // and an exact comparison reports spurious conflicts on FAT/exFAT.
          fileChangedSince = info.mtimeMs - entry.baseModifiedMs > 1;
        } catch {
          fileMissing = true;
        }
      }
    }

    recovered.push({ ...entry, fileChangedSince, fileMissing });
  }

  return recovered;
}
