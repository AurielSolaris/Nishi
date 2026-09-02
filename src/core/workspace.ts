/**
 * Workspace — open documents, and the panes showing them.
 *
 * Stage 1 rewrite. Stage 0 kept a flat list of "items"; this owns a set of
 * Documents plus a list of panes, each with its own tab strip and active tab.
 *
 * Panes are a flat list sharing one split direction rather than a nested tree.
 * That covers side-by-side and stacked editing — what splits are actually used
 * for — without the tree bookkeeping. If arbitrary nesting is ever needed, it
 * replaces `#panes` alone; nothing outside this file assumes flatness.
 */

import { Document, type DocumentInit } from "./document.ts";
import type { VfsPath } from "./vfs-path.ts";

export type SplitDirection = "vertical" | "horizontal";

export type Pane = {
  id: string;
  /** Document ids, in tab order. */
  tabs: string[];
  activeDocId: string | null;
};

export type WorkspaceState = {
  panes: Pane[];
  activePaneId: string;
  direction: SplitDirection;
  documents: Map<string, Document>;
};

export type Listener = (state: WorkspaceState) => void;

let nextPaneId = 0;

export class Workspace {
  #documents = new Map<string, Document>();
  #panes: Pane[] = [];
  #activePaneId: string;
  #direction: SplitDirection = "vertical";
  #listeners = new Set<Listener>();
  #closedListeners = new Set<(documentId: string) => void>();

  constructor() {
    const first = this.#makePane();
    this.#panes.push(first);
    this.#activePaneId = first.id;
  }

  #makePane(): Pane {
    return { id: `pane-${++nextPaneId}`, tabs: [], activeDocId: null };
  }

  // ----------------------------------------------------------- accessors --

  get state(): WorkspaceState {
    return {
      panes: this.#panes.map((p) => ({ ...p, tabs: [...p.tabs] })),
      activePaneId: this.#activePaneId,
      direction: this.#direction,
      documents: this.#documents,
    };
  }

  get activePane(): Pane {
    return this.#panes.find((p) => p.id === this.#activePaneId) ?? this.#panes[0]!;
  }

  get activeDocument(): Document | null {
    const id = this.activePane.activeDocId;
    return id ? (this.#documents.get(id) ?? null) : null;
  }

  get direction(): SplitDirection {
    return this.#direction;
  }

  get paneCount(): number {
    return this.#panes.length;
  }

  document(id: string): Document | null {
    return this.#documents.get(id) ?? null;
  }

  /** Find an already-open document for a path, so files open once. */
  documentForPath(path: VfsPath): Document | null {
    for (const doc of this.#documents.values()) {
      if (doc.path === path) return doc;
    }
    return null;
  }

  /**
   * Notified when a document stops being shown by any pane and is dropped.
   *
   * The document cache subscribes to this so its bookkeeping does not outlive
   * the documents it tracks — a cache that keeps entries for closed files is a
   * memory leak in the component whose job is to prevent one.
   */
  onDocumentClosed(listener: (documentId: string) => void): () => void {
    this.#closedListeners.add(listener);
    return () => this.#closedListeners.delete(listener);
  }

  #noteClosed(documentId: string): void {
    for (const listener of this.#closedListeners) listener(documentId);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  /** Force a re-render — used after buffer edits, which the workspace can't see. */
  touch(): void {
    this.#emit();
  }

  #emit(): void {
    const snapshot = this.state;
    for (const listener of this.#listeners) listener(snapshot);
  }

  // ---------------------------------------------------------- documents ---

  open(init: DocumentInit, paneId = this.#activePaneId): Document {
    const doc = new Document(init);
    this.#documents.set(doc.id, doc);
    this.#showInPane(doc.id, paneId);
    this.#emit();
    return doc;
  }

  /** Open a file, focusing the existing tab if it is already open. */
  openExisting(doc: Document, paneId = this.#activePaneId): void {
    if (!this.#documents.has(doc.id)) this.#documents.set(doc.id, doc);
    this.#showInPane(doc.id, paneId);
    this.#emit();
  }

  #showInPane(docId: string, paneId: string): void {
    const pane = this.#panes.find((p) => p.id === paneId) ?? this.activePane;
    if (!pane.tabs.includes(docId)) pane.tabs.push(docId);
    pane.activeDocId = docId;
    this.#activePaneId = pane.id;
  }

  activateTab(paneId: string, docId: string): void {
    const pane = this.#panes.find((p) => p.id === paneId);
    if (!pane || !pane.tabs.includes(docId)) return;
    pane.activeDocId = docId;
    this.#activePaneId = paneId;
    this.#emit();
  }

  activatePane(paneId: string): void {
    if (!this.#panes.some((p) => p.id === paneId) || this.#activePaneId === paneId) return;
    this.#activePaneId = paneId;
    this.#emit();
  }

  closeTab(paneId: string, docId: string): void {
    const pane = this.#panes.find((p) => p.id === paneId);
    if (!pane) return;

    const index = pane.tabs.indexOf(docId);
    if (index === -1) return;
    pane.tabs.splice(index, 1);

    if (pane.activeDocId === docId) {
      // Prefer the neighbour to the left, matching Atom.
      pane.activeDocId = pane.tabs[index - 1] ?? pane.tabs[index] ?? null;
    }

    // Drop the document once no pane shows it.
    const stillOpen = this.#panes.some((p) => p.tabs.includes(docId));
    if (!stillOpen) {
      this.#documents.delete(docId);
      this.#noteClosed(docId);
    } else {
      const doc = this.#documents.get(docId);
      doc?.carets.delete(paneId);
      doc?.scrollTops.delete(paneId);
    }

    // An empty pane collapses, unless it is the last one.
    if (pane.tabs.length === 0 && this.#panes.length > 1) {
      this.#panes = this.#panes.filter((p) => p.id !== pane.id);
      if (this.#activePaneId === pane.id) this.#activePaneId = this.#panes[0]!.id;
    }

    this.#emit();
  }

  // -------------------------------------------------------------- panes ---

  setDirection(direction: SplitDirection): void {
    if (this.#direction === direction) return;
    this.#direction = direction;
    this.#emit();
  }

  /**
   * Split the active pane, carrying the active document into the new one so
   * the split shows something rather than an empty box.
   */
  split(): Pane {
    const source = this.activePane;
    const pane = this.#makePane();

    if (source.activeDocId) {
      pane.tabs.push(source.activeDocId);
      pane.activeDocId = source.activeDocId;
    }

    const at = this.#panes.findIndex((p) => p.id === source.id);
    this.#panes.splice(at + 1, 0, pane);
    this.#activePaneId = pane.id;
    this.#emit();
    return pane;
  }

  closePane(paneId: string): void {
    if (this.#panes.length <= 1) return;
    const pane = this.#panes.find((p) => p.id === paneId);
    if (!pane) return;

    this.#panes = this.#panes.filter((p) => p.id !== paneId);
    if (this.#activePaneId === paneId) this.#activePaneId = this.#panes[0]!.id;

    // Forget documents no pane shows any more.
    for (const docId of pane.tabs) {
      if (this.#panes.some((p) => p.tabs.includes(docId))) continue;
      this.#documents.delete(docId);
      this.#noteClosed(docId);
    }

    this.#emit();
  }

  /** Cycle focus to the next pane. */
  focusNextPane(): void {
    if (this.#panes.length <= 1) return;
    const at = this.#panes.findIndex((p) => p.id === this.#activePaneId);
    this.#activePaneId = this.#panes[(at + 1) % this.#panes.length]!.id;
    this.#emit();
  }

  /** Every document with unsaved changes. */
  get dirtyDocuments(): Document[] {
    return [...this.#documents.values()].filter((d) => d.isDirty);
  }
}

export { Document };
