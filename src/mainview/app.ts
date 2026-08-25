/**
 * NishiApp — the application object every view talks to.
 *
 * Holds the host, settings and workspace, and exposes the verbs the UI needs
 * (open, save, split, undo…). Alpine components and the imperative editor
 * renderer both drive the editor through this one surface, so there is a single
 * place where an action's full consequences live.
 */

import { BRAND } from "../core/branding.ts";
import { Document } from "../core/document.ts";
import { HostError, createHost, type NishiHost } from "../core/platform.ts";
import { Settings } from "../core/settings.ts";
import { Workspace } from "../core/workspace.ts";

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

  /** Workspace root, as reported by the host. */
  root = "";

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
      this.root = await this.host.fs.root();
    } catch (error) {
      this.fail(error, "Could not resolve the workspace folder");
    }

    // Persist settings changes, coalesced so dragging a number doesn't spam
    // the disk.
    this.settings.subscribe(() => {
      clearTimeout(this.#settingsSaveTimer);
      this.#settingsSaveTimer = setTimeout(() => {
        void this.host.saveSettings(this.settings.toJSON()).catch((error) => {
          this.fail(error, "Could not save settings");
        });
      }, 300);
    });

    this.workspace.setDirection(this.settings.get("workbench.splitDirection"));
  }

  // ---------------------------------------------------------- documents --

  /** Open a file by path, focusing it if it is already open. */
  async openPath(path: string): Promise<Document | null> {
    const existing = this.workspace.documentForPath(path);
    if (existing) {
      this.workspace.openExisting(existing);
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

    if (doc.isUntitled) {
      // No native save dialog on the browser host; ask for a path inline.
      const suggested = `${this.root}${this.root.includes("\\") ? "\\" : "/"}${doc.name}.txt`;
      const path = window.prompt("Save as (path inside the workspace folder):", suggested);
      if (!path) return false;
      return this.#writeTo(doc, path);
    }

    return this.#writeTo(doc, doc.path!);
  }

  async #writeTo(doc: Document, path: string): Promise<boolean> {
    const text = this.#textForSave(doc);

    // Apply the on-save rewrite to the buffer too, so what is on screen matches
    // what is on disk.
    const normalized = doc.buffer.eol === "\r\n" ? text.replaceAll("\r\n", "\n") : text;
    if (normalized !== doc.buffer.getText()) doc.buffer.setText(normalized);

    try {
      const written = await this.host.fs.write(path, text);
      doc.markSaved(written.path);
      this.workspace.touch();
      this.status(`Saved ${doc.name}`);
      return true;
    } catch (error) {
      this.fail(error, "Could not save");
      return false;
    }
  }

  /** Called after every buffer edit; drives auto save. */
  noteEdit(): void {
    if (!this.settings.get<boolean>("files.autoSave")) return;
    clearTimeout(this.#autoSaveTimer);
    this.#autoSaveTimer = setTimeout(() => {
      const doc = this.workspace.activeDocument;
      if (doc && doc.isDirty && !doc.isUntitled) void this.save(doc);
    }, 800);
  }

  closeTab(paneId: string, docId: string): void {
    const doc = this.workspace.document(docId);
    if (doc?.isDirty) {
      const stillElsewhere = this.workspace.state.panes.some(
        (p) => p.id !== paneId && p.tabs.includes(docId),
      );
      if (!stillElsewhere && !window.confirm(`${doc.name} has unsaved changes. Close anyway?`)) {
        return;
      }
    }
    this.workspace.closeTab(paneId, docId);
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

  async setRoot(path: string): Promise<void> {
    try {
      this.root = await this.host.fs.setRoot(path);
      // Persisted so the desktop shell reopens here next launch.
      this.settings.set("workbench.lastFolder", this.root);
      this.status(`Workspace: ${this.root}`);
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
