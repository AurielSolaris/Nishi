/**
 * Active/cold document cache. STUB — Stage 2.
 *
 * Open files stay in an active RAM cache; after an inactivity timeout, a clean
 * document's buffer is released and the document drops to "cold" — its tab,
 * cursor position and workspace placement survive, and the content is re-read
 * from disk on next touch (EXTRAS.md, "Document cache system").
 *
 * The invariant that matters:
 *
 *   A DIRTY DOCUMENT IS NEVER EVICTED.
 *
 * Unsaved content exists only in memory, so evicting it would destroy user
 * work. Stage 2 may add a spill-to-disk journal for dirty buffers; until that
 * exists, dirty documents are simply pinned. The rest of the editor may assume
 * `Document.buffer` is always readable — the cache is an optimisation, and it
 * must never change what the editor can do, only what it holds.
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
};

export const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  idleTimeoutMs: 5 * 60 * 1000,
  maxActive: 24,
};

export interface DocumentCache {
  touch(doc: Document): void;
  /** Eligible = clean, active, and idle past the timeout. */
  evictionCandidates(): readonly CacheEntry[];
  /** Returns false when the document was pinned (dirty) and kept. */
  evict(documentId: string): boolean;
  /** Re-read a cold document from disk, restoring caret and scroll. */
  revive(documentId: string): Promise<Document>;
  entry(documentId: string): CacheEntry | null;
}

export function createDocumentCache(_options: CacheOptions = DEFAULT_CACHE_OPTIONS): DocumentCache {
  throw new Error("Document cache is not implemented yet (Stage 2). See EXTRAS.md.");
}
