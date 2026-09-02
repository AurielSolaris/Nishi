/**
 * NishiApp — the application object every view talks to.
 *
 * Holds the host, settings and workspace, and exposes the verbs the UI needs
 * (open, save, split, undo…). Alpine components and the imperative editor
 * renderer both drive the editor through this one surface, so there is a single
 * place where an action's full consequences live.
 *
 * Two Stage 2 responsibilities landed here because both cut across the whole
 * app rather than belonging to any one view:
 *
 *   - **Warming.** Documents go cold after 30 idle minutes (document-cache.ts).
 *     Every path that focuses a tab goes through `warm()` first, so the rest of
 *     the UI can keep assuming a visible document has a buffer.
 *   - **External changes.** The host now pushes filesystem events. A clean
 *     document reloads itself; a dirty one is flagged rather than overwritten,
 *     because the copy in memory is the one with the user's work in it.
 */

import { BRAND } from "../core/branding.ts";
import { Document } from "../core/document.ts";
import { createDocumentCache, type DocumentCache } from "../core/document-cache.ts";
import {
  HostError,
  createHost,
  type FsChange,
  type NishiHost,
  type WorkspaceInfo,
} from "../core/platform.ts";
import { Settings } from "../core/settings.ts";
import { Workspace } from "../core/workspace.ts";
import {
  WORKSPACE_MOUNT,
  mountRoot,
  splitRelative,
  vfsDirname,
  vfsJoin,
  type VfsPath,
} from "../core/vfs-path.ts";

export type StatusTone = "info" | "error";

type StatusListener = (message: string, tone: StatusTone) => void;

export class NishiApp {
  /** Set by init(); the host is chosen asynchronously (Electrobun vs browser). */
  #host: NishiHost | null = null;

  get host(): NishiHost {
    if (!this.#host) throw new Error("app.init() has not completed");
    return this.#host;
  }

  readonly settings = new Settings();
  readonly workspace = new Workspace();

  /**
   * The open folder, as the view is allowed to know it: a mount URI, a label,
   * and a home-elided display path. Never an absolute path — see
   * src/host/vfs.ts for why that is the whole point.
   */
  workspaceInfo: WorkspaceInfo = {
    uri: mountRoot(WORKSPACE_MOUNT),
    label: "",
    displayPath: "",
  };

  /** True when the host is watching for external changes. */
  watching = false;

  #cache: DocumentCache | null = null;

  get cache(): DocumentCache {
    if (!this.#cache) throw new Error("app.init() has not completed");
    return this.#cache;
  }

  #journalTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Journal keys carried over from a recovered session.
   *
   * A recovered document is a new Document with a fresh key, but its journal
   * record is filed under the old one. Rather than rewrite the record, the old
   * key is remembered and used for it.
   */
  #recoveredKeys = new Map<string, string>();

  #statusListeners = new Set<StatusListener>();
  #statusTimer: ReturnType<typeof setTimeout> | undefined;
  #autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  #settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;

  // ------------------------------------------------------------- status --

  onStatus(listener: StatusListener): void {
    this.#statusListeners.add(listener);
  }

  status(message: string, tone: StatusTone = "info"): void {
    for (const listener of this.#statusListeners) listener(message, tone);
    clearTimeout(this.#statusTimer);
    if (message !== "Ready") {
      this.#statusTimer = setTimeout(() => {
        for (const listener of this.#statusListeners) listener("Ready", "info");
      }, 5000);
    }
  }

  /** Report a failed action without letting it take the UI down. */
  fail(error: unknown, context: string): void {
    const message = error instanceof HostError || error instanceof Error ? error.message : String(error);
    this.status(`${context}: ${message}`, "error");
    console.error(`[nishi] ${context}`, error);
  }

  // --------------------------------------------------------------- boot --

  async init(): Promise<void> {
    this.#host = await createHost();

    try {
      this.settings.merge(await this.host.loadSettings());
    } catch (error) {
      this.fail(error, "Could not load settings");
    }

    try {
      this.workspaceInfo = await this.host.fs.workspace();
    } catch (error) {
      this.fail(error, "Could not resolve the workspace folder");
    }

    try {
      this.watching = (await this.host.info()).watching;
    } catch {
      this.watching = false;
    }

    this.#cache = createDocumentCache(
      {
        load: (doc) => this.#loadColdDocument(doc),
        // A document showing in any pane is being viewed, so it never goes cold
        // out from under the person looking at it.
        isVisible: (documentId) =>
          this.workspace.state.panes.some((pane) => pane.activeDocId === documentId),
        onChange: () => this.workspace.touch(),
      },
      this.#cacheOptions(),
    );
    this.#cache.start();

    // A closed tab's cache entry has nothing left to describe.
    this.workspace.onDocumentClosed((documentId) => this.#cache?.forget(documentId));

    this.host.onFsChange((changes) => void this.#onFsChanges(changes));

    // Persist settings changes, coalesced so dragging a number doesn't spam
    // the disk.
    this.settings.subscribe(() => {
      this.#cache?.configure(this.#cacheOptions());
      clearTimeout(this.#settingsSaveTimer);
      this.#settingsSaveTimer = setTimeout(() => {
        void this.host.saveSettings(this.settings.toJSON()).catch((error) => {
          this.fail(error, "Could not save settings");
        });
      }, 300);
    });

    this.workspace.setDirection(this.settings.get("workbench.splitDirection"));

    // Last, so a recovered document lands in a fully wired app: the cache can
    // track it, the watcher can flag it, and settings are already applied.
    await this.#recoverJournal();
  }

  #cacheOptions(): { idleTimeoutMs: number; maxActive: number } {
    return {
      idleTimeoutMs: this.settings.get<number>("memory.unloadAfterMinutes") * 60_000,
      maxActive: this.settings.get<number>("memory.maxLoadedFiles"),
    };
  }

  /**
   * Put a cold document's text back, from wherever that document's text lives.
   *
   * A document that went cold *dirty* has its edits in the journal and nowhere
   * else — reading the file instead would silently throw the edits away and
   * present the result as if nothing had happened, which is the worst kind of
   * data loss because it looks like success.
   */
  async #loadColdDocument(doc: Document): Promise<boolean> {
    if (doc.revivesFromJournal) {
      const entry = await this.host.journal.get(this.#journalKey(doc));
      if (entry) {
        doc.restoreDirty(entry.content, entry.baseModifiedMs);
        return true;
      }
      // The journal record is gone. Refuse rather than fall through to the file:
      // returning the saved version of a document the user believes still holds
      // their edits is worse than an error saying it could not be reloaded.
      console.error(`[nishi] journal entry missing for ${doc.name} (${this.#journalKey(doc)})`);
      return false;
    }

    if (!doc.path) return false;
    try {
      const file = await this.host.fs.read(doc.path);
      doc.restore(file.content, file.modifiedMs);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ journal --

  /**
   * Write the active document's unsaved content to the journal.
   *
   * Debounced, so typing does not mean a file write per keystroke. Until this
   * lands, `doc.journalled` is false and the cache will not evict the document
   * — the buffer is briefly the only copy again, and the cache is told so.
   */
  #scheduleJournal(doc: Document): void {
    clearTimeout(this.#journalTimers.get(doc.id));
    this.#journalTimers.set(
      doc.id,
      setTimeout(() => {
        this.#journalTimers.delete(doc.id);
        void this.#journalNow(doc);
      }, 600),
    );
  }

  /** The key this document's journal record is filed under. */
  #journalKey(doc: Document): string {
    return this.#recoveredKeys.get(doc.id) ?? doc.key;
  }

  async #journalNow(doc: Document): Promise<void> {
    if (!doc.isDirty || doc.isCold) return;
    try {
      await this.host.journal.put({
        key: this.#journalKey(doc),
        path: doc.path,
        name: doc.name,
        content: doc.buffer.getText(),
        journalledAt: Date.now(),
        baseModifiedMs: doc.editBaseModifiedMs || doc.modifiedMs,
      });
      doc.journalled = true;
    } catch (error) {
      // Never surface this as a modal failure: journalling is a safety net, and
      // a net that cannot be hung is not a reason to stop the user typing. The
      // document simply stays pinned in memory, which is the old behaviour.
      console.error("[nishi] could not journal unsaved changes", error);
    }
  }

  /** Forget a document's journal record — it was saved, or knowingly discarded. */
  #dropJournal(doc: Document): void {
    clearTimeout(this.#journalTimers.get(doc.id));
    this.#journalTimers.delete(doc.id);
    doc.journalled = false;
    const key = this.#journalKey(doc);
    this.#recoveredKeys.delete(doc.id);
    void this.host.journal.drop(key).catch((error) => {
      console.error("[nishi] could not drop journal entry", error);
    });
  }

  /**
   * Offer back anything a previous run left unsaved.
   *
   * Entries are reopened as dirty documents rather than written to disk: the
   * previous session did not decide to save these, so neither does this one.
   * The user sees their tabs back with the edits intact and chooses.
   */
  async #recoverJournal(): Promise<void> {
    let entries;
    try {
      entries = await this.host.journal.recover();
    } catch (error) {
      this.fail(error, "Could not check for unsaved work");
      return;
    }
    if (entries.length === 0) return;

    let restored = 0;
    let conflicted = 0;

    for (const entry of entries) {
      const doc = this.workspace.open({
        path: entry.path,
        name: entry.name,
        content: entry.content,
      });
      doc.restoreDirty(entry.content, entry.baseModifiedMs);
      // Carry the identity forward so the existing journal record keeps being
      // this document's record instead of a second one being created.
      this.#recoveredKeys.set(doc.id, entry.key);
      this.cache.touch(doc);
      restored++;

      if (entry.fileChangedSince || entry.fileMissing) {
        doc.staleOnDisk = true;
        conflicted++;
      }
    }

    this.workspace.touch();
    this.status(
      conflicted > 0
        ? `Recovered ${restored} unsaved file${restored === 1 ? "" : "s"}; ${conflicted} changed on disk since`
        : `Recovered ${restored} unsaved file${restored === 1 ? "" : "s"}`,
      conflicted > 0 ? "error" : "info",
    );
  }

  // -------------------------------------------------------- cold/active --

  /**
   * Make sure a document's text is in memory, reading it back if it went cold.
   *
   * Returns false when the document could not be revived — the usual cause is
   * the file having been deleted while it was cold, which the user needs told
   * rather than being shown an empty editor.
   */
  async warm(doc: Document | null): Promise<boolean> {
    if (!doc) return false;
    if (!doc.isCold) {
      this.cache.touch(doc);
      return true;
    }

    try {
      await this.cache.revive(doc);
      this.workspace.touch();
      return true;
    } catch (error) {
      this.fail(error, `Could not reload ${doc.name}`);
      return false;
    }
  }

  /** Focus a tab, warming it first so the renderer always has a buffer. */
  async activateTab(paneId: string, docId: string): Promise<void> {
    const doc = this.workspace.document(docId);
    this.workspace.activateTab(paneId, docId);
    await this.warm(doc);
  }

  // ---------------------------------------------------------- documents --

  /** Open a file by VFS path, focusing it if it is already open. */
  async openPath(path: VfsPath): Promise<Document | null> {
    const existing = this.workspace.documentForPath(path);
    if (existing) {
      this.workspace.openExisting(existing);
      await this.warm(existing);
      return existing;
    }

    try {
      const fileContent = await this.host.fs.read(path);
      if (fileContent.binary) {
        this.status(`${fileContent.name} looks like a binary file`, "error");
        return null;
      }
      const doc = this.workspace.open({
        path: fileContent.path,
        name: fileContent.name,
        content: fileContent.content,
      });
      doc.modifiedMs = fileContent.modifiedMs;
      this.cache.touch(doc);
      this.status(`Opened ${fileContent.name}`);
      return doc;
    } catch (error) {
      this.fail(error, "Could not open file");
      return null;
    }
  }

  #untitledCount = 0;

  newBuffer(): Document {
    const doc = this.workspace.open({ name: `untitled-${++this.#untitledCount}`, content: "" });
    this.cache.touch(doc);
    this.status("New buffer");
    return doc;
  }

  /** Text as it should hit disk, applying the on-save settings. */
  #textForSave(doc: Document): string {
    let text = doc.buffer.getText();

    if (this.settings.get<boolean>("editor.trimTrailingWhitespace")) {
      text = text.replace(/[ \t]+$/gm, "");
    }
    if (this.settings.get<boolean>("editor.insertFinalNewline") && text !== "" && !text.endsWith("\n")) {
      text += "\n";
    }

    return doc.buffer.eol === "\r\n" ? text.replaceAll("\n", "\r\n") : text;
  }

  async save(doc: Document | null = this.workspace.activeDocument): Promise<boolean> {
    if (!doc) return false;
    if (doc.isCold) return true; // cold implies saved; nothing to write

    if (doc.isUntitled) {
      // No native save dialog yet. Ask for a path relative to the workspace —
      // which is now the only kind of path the editor can express anyway, so
      // the prompt got simpler rather than more restrictive.
      const answer = window.prompt("Save as (path inside the workspace folder):", `${doc.name}.txt`);
      if (!answer) return false;

      let target: VfsPath;
      try {
        target = vfsJoin(this.workspaceInfo.uri, ...splitRelative(answer));
      } catch (error) {
        this.fail(error, "Could not save");
        return false;
      }
      return this.#writeTo(doc, target);
    }

    return this.#writeTo(doc, doc.path!);
  }

  async #writeTo(doc: Document, path: VfsPath): Promise<boolean> {
    const text = this.#textForSave(doc);

    // Apply the on-save rewrite to the buffer too, so what is on screen matches
    // what is on disk.
    const normalized = doc.buffer.eol === "\r\n" ? text.replaceAll("\r\n", "\n") : text;
    if (normalized !== doc.buffer.getText()) doc.buffer.setText(normalized);

    try {
      const written = await this.host.fs.write(path, text);
      doc.markSaved(written.path, written.modifiedMs);
      doc.editBaseModifiedMs = written.modifiedMs;
      this.#dropJournal(doc);
      this.cache.touch(doc);
      this.workspace.touch();
      this.status(`Saved ${doc.name}`);
      return true;
    } catch (error) {
      this.fail(error, "Could not save");
      return false;
    }
  }

  /** Called after every buffer edit; drives auto save and journalling. */
  noteEdit(): void {
    const active = this.workspace.activeDocument;
    if (active) {
      this.cache.touch(active);

      if (active.isDirty) {
        // The buffer is the only copy again until the journal write lands, so
        // the document must not be evictable in the meantime.
        if (active.journalled) active.journalled = false;
        else if (active.editBaseModifiedMs === 0) active.editBaseModifiedMs = active.modifiedMs;
        this.#scheduleJournal(active);
      }
    }

    if (!this.settings.get<boolean>("files.autoSave")) return;
    clearTimeout(this.#autoSaveTimer);
    this.#autoSaveTimer = setTimeout(() => {
      const doc = this.workspace.activeDocument;
      if (doc && doc.isDirty && !doc.isUntitled) void this.save(doc);
    }, 800);
  }

  /**
   * Close a tab, asking first if that would discard unsaved work.
   *
   * Async because the desktop host's confirmation is a real native dialog and
   * a native dialog cannot be answered synchronously. Callers fire and forget;
   * nothing downstream needs the result.
   */
  async closeTab(paneId: string, docId: string): Promise<void> {
    const doc = this.workspace.document(docId);

    if (doc?.isDirty) {
      const stillElsewhere = this.workspace.state.panes.some(
        (p) => p.id !== paneId && p.tabs.includes(docId),
      );
      if (!stillElsewhere) {
        const discard = await this.host.dialogs.confirm({
          title: "Unsaved changes",
          message: `${doc.name} has unsaved changes.`,
          detail: "Closing this tab discards them.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
          danger: true,
        });
        if (!discard) return;
      }
    }

    // Deliberately discarded, so the journal record goes too — leaving it would
    // offer the work back on next launch after the user said to drop it.
    if (doc) this.#dropJournal(doc);

    this.workspace.closeTab(paneId, docId);
  }

  // ---------------------------------------------------- external changes --

  /**
   * React to a change somebody else made.
   *
   * The rule is that in-memory work wins. A clean document has nothing to lose,
   * so it silently takes the new contents — that is what makes a `git checkout`
   * in another terminal show up in the editor. A dirty one is only flagged: the
   * user's unsaved edits are the more valuable copy, and quietly replacing them
   * to stay in sync with disk would be the worst possible trade.
   */
  async #onFsChanges(changes: readonly FsChange[]): Promise<void> {
    let reloaded = 0;
    let flagged = 0;

    for (const change of changes) {
      const doc = this.workspace.documentForPath(change.uri);
      if (!doc) continue;

      if (change.type === "removed") {
        doc.staleOnDisk = true;
        flagged++;
        continue;
      }

      // Cold documents need nothing: they re-read on the next warm anyway.
      if (doc.isCold) continue;

      if (doc.isDirty) {
        doc.staleOnDisk = true;
        flagged++;
        continue;
      }

      try {
        const file = await this.host.fs.read(change.uri);
        if (file.binary || file.modifiedMs === doc.modifiedMs) continue;
        doc.buffer.setText(file.content);
        doc.markSaved(undefined, file.modifiedMs);
        reloaded++;
      } catch {
        doc.staleOnDisk = true;
        flagged++;
      }
    }

    if (reloaded > 0 || flagged > 0) this.workspace.touch();
    if (flagged > 0) {
      this.status(
        flagged === 1 ? "A file changed on disk under unsaved edits" : `${flagged} files changed on disk`,
        "error",
      );
    } else if (reloaded > 0) {
      this.status(reloaded === 1 ? "Reloaded a file changed on disk" : `Reloaded ${reloaded} files`);
    }

    // The explorer redraws the folders a change touched. It listens rather than
    // being called directly so the tree stays a self-contained component.
    //
    // A changed directory needs redrawing itself (it may have gained children)
    // *and* so does its parent (the directory may itself be new). Sending only
    // the parent misses new files one level down, which is the common case.
    const directories = new Set<VfsPath>();
    for (const change of changes) {
      if (change.type === "changed" && change.kind === "directory") directories.add(change.uri);
      directories.add(vfsDirname(change.uri));
    }

    window.dispatchEvent(
      new CustomEvent<{ directories: VfsPath[] }>("nishi:fs-changed", {
        detail: { directories: [...directories] },
      }),
    );
  }

  // -------------------------------------------------------------- panes --

  split(): void {
    if (!this.workspace.activeDocument) {
      this.status("Open a file before splitting", "error");
      return;
    }
    this.workspace.split();
  }

  toggleSplitDirection(): void {
    const next = this.workspace.direction === "vertical" ? "horizontal" : "vertical";
    this.settings.set("workbench.splitDirection", next);
    this.workspace.setDirection(next);
  }

  // ------------------------------------------------------------ folders --

  /**
   * Mount a different folder as the workspace.
   *
   * The one place the view hands the host a real operating-system path. It is
   * the user's explicit gesture — the same authority a native folder picker
   * carries — and the host, not the view, records it for next launch.
   */
  /**
   * Ask the host for a folder and mount it.
   *
   * The picker is native on the desktop and a prompt in the browser; either
   * way it is the user naming a real path, which is the single gesture the VFS
   * accepts one through.
   */
  async pickFolder(): Promise<void> {
    const chosen = await this.host.dialogs.openFolder(this.workspaceInfo.displayPath);
    if (chosen === null || chosen === "") return;
    await this.openFolder(chosen);
  }

  async openFolder(realPath: string): Promise<void> {
    try {
      this.workspaceInfo = await this.host.fs.openFolder(realPath);
      this.status(`Workspace: ${this.workspaceInfo.label}`);
      window.dispatchEvent(new CustomEvent("nishi:root-changed"));
    } catch (error) {
      this.fail(error, "Could not open folder");
    }
  }

  title(): string {
    const doc = this.workspace.activeDocument;
    if (!doc) return BRAND.name;
    return `${doc.isDirty ? "● " : ""}${doc.name} — ${BRAND.name}`;
  }
}

/** One app per window. */
export const app = new NishiApp();
