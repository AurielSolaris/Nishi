/**
 * Active/cold document cache — Stage 2.
 *
 * An open file stays in RAM while it is being used. After **30 minutes**
 * untouched, a clean document's buffer is released and the document goes cold:
 * its tab, its carets and its scroll position all survive, and the text is read
 * back from disk the moment the file is focused or viewed again.
 *
 * That is the whole user-visible contract. A long editing session with forty
 * tabs open should not hold forty files in memory when thirty-nine of them were
 * last looked at before lunch.
 *
 * ## The invariant
 *
 *     A DOCUMENT IS NEVER EVICTED UNLESS ITS CONTENT IS RECOVERABLE.
 *
 * Recoverable means one of:
 *
 *   - clean and saved   — the file is the copy
 *   - dirty, journalled — `~/.nishi/journal/` holds the copy (src/host/journal.ts)
 *   - neither           — the buffer *is* the work, so it stays in memory
 *
 * Until the journal existed, only the first case qualified and the rule read "a
 * dirty document is never evicted". Journalling widens what qualifies without
 * weakening the rule: the test was always whether the text survives, never
 * whether it happens to be saved.
 *
 * This is enforced in two places on purpose: `Document.release()` refuses, and
 * `evictionCandidates()` never offers. The double check is not redundancy for
 * its own sake — the sweep and the manual path are different callers, and the
 * cost of getting this wrong is silently deleting someone's work.
 *
 * ## Why a sweep rather than a timer per document
 *
 * One interval over the whole set, rather than a `setTimeout` per open file.
 * Forty documents would otherwise mean forty timers being cleared and reset on
 * every keystroke, which is more bookkeeping than the memory it saves.
 */

import type { Document } from "./document.ts";

export type CacheState = "active" | "cold";

export type CacheEntry = {
  documentId: string;
  state: CacheState;
  /** Preserved across eviction so a cold document reopens where it was. */
  caretOffset: number;
  scrollTop: number;
  lastTouched: number;
};

export type CacheOptions = {
  /** Idle time before a clean document becomes eligible for eviction. */
  idleTimeoutMs: number;
  /** Never hold more than this many active buffers, dirty ones excepted. */
  maxActive: number;
  /** How often to look for evictable documents. */
  sweepIntervalMs: number;
};

export const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  idleTimeoutMs: 30 * 60 * 1000,
  maxActive: 24,
  sweepIntervalMs: 60 * 1000,
};

/**
 * What the cache needs from the rest of the app.
 *
 * Passed in rather than imported so the cache has no opinion about hosts and
 * can be tested against a plain function. `read` returns null when the file is
 * gone, which is a real case: a cold document whose file was deleted while it
 * was cold cannot be revived, and the caller has to be told rather than handed
 * an empty buffer.
 */
export type CacheDeps = {
  /**
   * Put a cold document's text back, from wherever that document's text lives.
   *
   * The cache deliberately does not know whether that is the file or the
   * journal — a dirty document reloads its *edits*, a clean one reloads the
   * file, and only the app has the context to tell them apart. Returns false
   * when the content could not be found, which is a real case: the file may
   * have been deleted while the document was cold.
   */
  load(doc: Document): Promise<boolean>;
  /**
   * True while a document is the active tab of some pane.
   *
   * A file the user is looking at is not idle, however long it has been since
   * they last typed in it. Without this, leaving the editor open on a document
   * for half an hour would unload the thing on screen — technically within the
   * policy, obviously wrong.
   */
  isVisible(documentId: string): boolean;
  /** Called after a document's state changes, so the UI can redraw. */
  onChange?(): void;
};

export interface DocumentCache {
  touch(doc: Document): void;
  /** Eligible = clean, saved, active, and idle past the timeout. */
  evictionCandidates(now?: number): readonly CacheEntry[];
  /** Returns false when the document was pinned (dirty or untitled) and kept. */
  evict(doc: Document): boolean;
  /** Read a cold document back from disk, restoring caret and scroll. */
  revive(doc: Document): Promise<Document>;
  /** Revive if cold, otherwise a no-op. The call every focus path makes. */
  warm(doc: Document): Promise<Document>;
  entry(documentId: string): CacheEntry | null;
  /** Apply changed settings without discarding what is already tracked. */
  configure(options: Partial<CacheOptions>): void;
  forget(documentId: string): void;
  /** Run one sweep now. Returns how many documents went cold. */
  sweep(now?: number): Promise<number>;
  start(): void;
  stop(): void;
  readonly activeCount: number;
}

export function createDocumentCache(
  deps: CacheDeps,
  options: Partial<CacheOptions> = {},
): DocumentCache {
  let config: CacheOptions = { ...DEFAULT_CACHE_OPTIONS, ...options };

  /** 0 minutes means "never unload on idle", not "unload immediately". */
  const idleTimeout = (): number =>
    config.idleTimeoutMs <= 0 ? Number.POSITIVE_INFINITY : config.idleTimeoutMs;
  const entries = new Map<string, CacheEntry>();
  const documents = new Map<string, Document>();

  /** Revivals in flight, so two panes focusing at once read the file once. */
  const reviving = new Map<string, Promise<Document>>();

  let timer: ReturnType<typeof setInterval> | undefined;

  const record = (doc: Document): CacheEntry => {
    let entry = entries.get(doc.id);
    if (!entry) {
      entry = {
        documentId: doc.id,
        state: doc.isCold ? "cold" : "active",
        caretOffset: 0,
        scrollTop: 0,
        lastTouched: Date.now(),
      };
      entries.set(doc.id, entry);
    }
    documents.set(doc.id, doc);
    return entry;
  };

  const cache: DocumentCache = {
    get activeCount() {
      let count = 0;
      for (const entry of entries.values()) if (entry.state === "active") count++;
      return count;
    },

    touch(doc) {
      const entry = record(doc);
      entry.lastTouched = Date.now();
      entry.state = doc.isCold ? "cold" : "active";
    },

    entry(documentId) {
      return entries.get(documentId) ?? null;
    },

    configure(next) {
      const restart = timer !== undefined && next.sweepIntervalMs !== undefined
        && next.sweepIntervalMs !== config.sweepIntervalMs;
      config = { ...config, ...next };
      if (restart) {
        cache.stop();
        cache.start();
      }
    },

    forget(documentId) {
      entries.delete(documentId);
      documents.delete(documentId);
      reviving.delete(documentId);
    },

    evictionCandidates(now = Date.now()) {
      const idle: CacheEntry[] = [];
      for (const entry of entries.values()) {
        if (entry.state !== "active") continue;
        const doc = documents.get(entry.documentId);
        // Pinned: nothing anywhere to read the content back from.
        if (!doc || !doc.isRecoverable) continue;
        // On screen right now — not a candidate, regardless of age.
        if (deps.isVisible(entry.documentId)) continue;
        if (now - entry.lastTouched < idleTimeout()) continue;
        idle.push(entry);
      }
      // Coldest first, so an over-cap sweep drops the least recently used.
      return idle.sort((a, b) => a.lastTouched - b.lastTouched);
    },

    evict(doc) {
      const entry = entries.get(doc.id);
      if (!entry || entry.state === "cold") return true;

      // Snapshot before releasing: these are what make the tab reopen where the
      // user left it rather than at the top of the file.
      entry.caretOffset = Math.max(0, ...[...doc.carets.values(), 0]);
      entry.scrollTop = Math.max(0, ...[...doc.scrollTops.values(), 0]);

      if (!doc.release()) return false;

      entry.state = "cold";
      deps.onChange?.();
      return true;
    },

    async revive(doc) {
      const inFlight = reviving.get(doc.id);
      if (inFlight) return inFlight;

      const work = (async () => {
        if (!(await deps.load(doc))) {
          throw new Error(`${doc.name} could not be reloaded`);
        }

        const entry = record(doc);
        entry.state = "active";
        entry.lastTouched = Date.now();

        // Clamp: the file may have shrunk while it was cold.
        const max = doc.buffer.length;
        const caret = Math.min(entry.caretOffset, max);
        for (const paneId of doc.carets.keys()) doc.carets.set(paneId, caret);
        for (const paneId of doc.scrollTops.keys()) doc.scrollTops.set(paneId, entry.scrollTop);

        deps.onChange?.();
        return doc;
      })();

      reviving.set(doc.id, work);
      try {
        return await work;
      } finally {
        reviving.delete(doc.id);
      }
    },

    async warm(doc) {
      if (!doc.isCold) {
        cache.touch(doc);
        return doc;
      }
      return cache.revive(doc);
    },

    async sweep(now = Date.now()) {
      let evicted = 0;
      for (const entry of cache.evictionCandidates(now)) {
        const doc = documents.get(entry.documentId);
        if (doc && cache.evict(doc)) evicted++;
      }

      // Over the active cap even after the idle pass: drop the least recently
      // used clean documents until we are back under it. A cap breach means a
      // lot of files were opened quickly, which is exactly when the 30-minute
      // timeout has not helped yet.
      if (cache.activeCount > config.maxActive) {
        const byAge = [...entries.values()]
          .filter((entry) => entry.state === "active")
          .sort((a, b) => a.lastTouched - b.lastTouched);

        for (const entry of byAge) {
          if (cache.activeCount <= config.maxActive) break;
          if (deps.isVisible(entry.documentId)) continue;
          const doc = documents.get(entry.documentId);
          if (doc && doc.isRecoverable && cache.evict(doc)) evicted++;
        }
      }

      return evicted;
    },

    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => void cache.sweep(), config.sweepIntervalMs);
      // Never hold the process open for a sweep; Bun and node both support this.
      (timer as unknown as { unref?: () => void }).unref?.();
    },

    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };

  return cache;
}
