/**
 * Editor renderer — panes, tab strips, and the text surface.
 *
 * Kept imperative on purpose. Alpine drives the explorer, settings and find
 * panels, but the editor needs exact control over caret offsets, scroll sync
 * and when a value is written back into the DOM; a reactive layer here would
 * fight the caret on every keystroke.
 *
 * The buffer is the source of truth. The textarea is a view onto it: edits are
 * diffed back into the buffer, and every other pane showing the same document
 * is re-synced from the buffer afterwards.
 */

import type { Document } from "../core/document.ts";
import type { Pane, WorkspaceState } from "../core/workspace.ts";
import { app } from "./app.ts";
import { vfsDisplay } from "../core/vfs-path.ts";
import { iconForEntry } from "./icons.ts";

type PaneView = {
  root: HTMLElement;
  tabs: HTMLElement;
  body: HTMLElement;
  editor: HTMLElement;
  gutter: HTMLElement;
  activeLine: HTMLElement;
  input: HTMLTextAreaElement;
  welcome: HTMLElement;
  /** Document currently loaded into `input`. */
  loadedDocId: string | null;
  /** Buffer version last written into `input`, to skip needless writes. */
  loadedVersion: number;
};

/** Build an <svg><use> pointing at a symbol id from the inlined sprite. */
function useIconRef(ref: string, className = "icon"): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", ref);
  svg.append(use);
  return svg;
}

/** Same, for a bare Lucide name. */
function useIcon(id: string, className = "icon"): SVGSVGElement {
  return useIconRef(`#i-${id}`, className);
}

/**
 * Minimal diff between two strings: the single replaced span between their
 * common prefix and common suffix. One textarea edit — typing, paste, or a
 * multi-line delete — becomes one buffer edit.
 */
function diff(prev: string, next: string): { start: number; removed: number; inserted: string } {
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++;

  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--;
    endNext--;
  }

  return { start, removed: endPrev - start, inserted: next.slice(start, endNext) };
}

export class EditorView {
  #container: HTMLElement;
  #panes = new Map<string, PaneView>();
  #welcomeTemplate: HTMLTemplateElement;

  /** Pixel height of one editor line; recomputed when font settings change. */
  #lineHeight = 20;

  constructor(container: HTMLElement, welcomeTemplate: HTMLTemplateElement) {
    this.#container = container;
    this.#welcomeTemplate = welcomeTemplate;

    app.workspace.subscribe((state) => this.render(state));
    app.settings.subscribe(() => this.#applySettings());
  }

  // ------------------------------------------------------------ settings --

  #applySettings(): void {
    const fontSize = app.settings.get<number>("editor.fontSize");
    this.#lineHeight = Math.round(fontSize * 1.55);

    const root = document.documentElement;
    root.style.setProperty("--editor-font-size", `${fontSize}px`);
    root.style.setProperty("--editor-line-height", `${this.#lineHeight}px`);
    root.style.setProperty("--editor-tab-size", String(app.settings.get<number>("editor.tabSize")));

    const wrap = app.settings.get<boolean>("editor.wordWrap");
    const showGutter = app.settings.get<boolean>("editor.lineNumbers");
    const highlight = app.settings.get<boolean>("editor.highlightCurrentLine");

    for (const view of this.#panes.values()) {
      view.input.wrap = wrap ? "soft" : "off";
      view.editor.classList.toggle("editor--wrap", wrap);
      view.gutter.hidden = !showGutter;
      view.activeLine.hidden = !highlight;
      this.#refreshGutter(view);
    }
  }

  // -------------------------------------------------------------- render --

  render(state: WorkspaceState): void {
    this.#container.classList.toggle("panes--horizontal", state.direction === "horizontal");

    // Drop panes that no longer exist.
    for (const [id, view] of this.#panes) {
      if (!state.panes.some((p) => p.id === id)) {
        view.root.remove();
        this.#panes.delete(id);
      }
    }

    state.panes.forEach((pane, index) => {
      const view = this.#panes.get(pane.id) ?? this.#createPane(pane.id);
      // Keep DOM order in step with pane order.
      const expected = this.#container.children[index];
      if (expected !== view.root) this.#container.insertBefore(view.root, expected ?? null);

      view.root.classList.toggle("pane--active", pane.id === state.activePaneId);
      view.root.classList.toggle("pane--only", state.panes.length === 1);

      this.#renderTabs(view, pane, state);
      this.#renderBody(view, pane, state);
    });

    void app.host.setTitle(app.title());
  }

  #createPane(paneId: string): PaneView {
    const root = document.createElement("section");
    root.className = "pane";
    root.dataset["paneId"] = paneId;

    root.innerHTML = `
      <div class="pane__tabs" role="tablist"></div>
      <div class="pane__body">
        <div class="editor" hidden>
          <div class="editor__gutter" aria-hidden="true"></div>
          <div class="editor__surface">
            <div class="editor__active-line" aria-hidden="true"></div>
            <textarea class="editor__input" spellcheck="false" autocomplete="off"
              autocapitalize="off" wrap="off" aria-label="Editor"></textarea>
          </div>
        </div>
        <div class="pane__welcome" hidden></div>
      </div>`;

    const view: PaneView = {
      root,
      tabs: root.querySelector(".pane__tabs")!,
      body: root.querySelector(".pane__body")!,
      editor: root.querySelector(".editor")!,
      gutter: root.querySelector(".editor__gutter")!,
      activeLine: root.querySelector(".editor__active-line")!,
      input: root.querySelector(".editor__input")!,
      welcome: root.querySelector(".pane__welcome")!,
      loadedDocId: null,
      loadedVersion: -1,
    };

    view.welcome.append(this.#welcomeTemplate.content.cloneNode(true));
    this.#wirePane(view, paneId);
    this.#container.append(root);
    this.#panes.set(paneId, view);
    this.#applySettings();
    return view;
  }

  // --------------------------------------------------------------- tabs --

  #renderTabs(view: PaneView, pane: Pane, state: WorkspaceState): void {
    view.tabs.replaceChildren(
      ...pane.tabs.map((docId) => {
        const doc = state.documents.get(docId)!;
        const tab = document.createElement("button");
        tab.className = `tab${docId === pane.activeDocId ? " is-active" : ""}`;
        tab.role = "tab";
        // The full VfsPath, not an OS path — the tooltip is workspace-relative
        // and says nothing about where the folder lives on disk.
        tab.title = doc.staleOnDisk
          ? `${doc.path ? vfsDisplay(doc.path) : doc.name} — changed on disk`
          : doc.path
            ? vfsDisplay(doc.path)
            : doc.name;
        tab.addEventListener("mousedown", (e) => {
          // Middle-click closes, as in Atom.
          if (e.button === 1) {
            e.preventDefault();
            void app.closeTab(pane.id, docId);
          }
        });
        // Through the app, not the workspace: focusing a tab may need to read a
        // cold document back from disk before the renderer can draw it.
        tab.addEventListener("click", () => void app.activateTab(pane.id, docId));

        // Same file-type icon the explorer uses, so a tab reads as the file.
        tab.append(useIconRef(iconForEntry("file", doc.name), "icon tab__icon"));

        const label = document.createElement("span");
        label.className = "tab__label";
        label.textContent = doc.name;
        tab.append(label);

        if (doc.isDirty) {
          const dot = document.createElement("span");
          dot.className = "tab__dirty";
          dot.title = "Unsaved changes";
          tab.append(dot);
        }

        const close = document.createElement("span");
        close.className = "tab__close";
        close.append(useIcon("x"));
        close.title = `Close ${doc.name}`;
        close.addEventListener("click", (e) => {
          e.stopPropagation();
          void app.closeTab(pane.id, docId);
        });
        tab.append(close);

        return tab;
      }),
      this.#paneActions(pane, state),
    );
  }

  #paneActions(pane: Pane, state: WorkspaceState): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "pane__actions";

    const split = document.createElement("button");
    split.className = "pane__action";
    split.title = "Split editor (Ctrl+\\)";
    split.append(useIcon("columns-2"));
    split.addEventListener("click", () => {
      app.workspace.activatePane(pane.id);
      app.split();
    });
    actions.append(split);

    if (state.panes.length > 1) {
      const close = document.createElement("button");
      close.className = "pane__action";
      close.title = "Close this pane";
      close.append(useIcon("x"));
      close.addEventListener("click", () => app.workspace.closePane(pane.id));
      actions.append(close);
    }

    return actions;
  }

  // --------------------------------------------------------------- body --

  #renderBody(view: PaneView, pane: Pane, state: WorkspaceState): void {
    const doc = pane.activeDocId ? (state.documents.get(pane.activeDocId) ?? null) : null;

    view.editor.hidden = doc === null;
    view.welcome.hidden = doc !== null;

    if (!doc) {
      view.loadedDocId = null;
      view.loadedVersion = -1;
      return;
    }

    const switched = view.loadedDocId !== doc.id;
    if (switched) {
      // Remember where the caret and scroll were in the outgoing document, so a
      // document that later goes cold has something to be restored to.
      if (view.loadedDocId) {
        const previous = state.documents.get(view.loadedDocId);
        previous?.carets.set(pane.id, view.input.selectionStart);
        previous?.scrollTops.set(pane.id, view.input.scrollTop);
      }
      view.loadedDocId = doc.id;
      view.loadedVersion = -1;
    }

    // Unloaded after sitting idle (see document-cache.ts). Show an empty,
    // read-only surface and read it back; `warm` touches the workspace, which
    // re-enters this method with a buffer. Read-only matters: without it a
    // keystroke landing in this instant would be diffed against the placeholder
    // and treated as deleting the file's entire contents.
    if (doc.isCold) {
      view.input.readOnly = true;
      view.input.value = "";
      view.loadedVersion = -1;
      void app.warm(doc);
      return;
    }
    view.input.readOnly = false;

    if (view.loadedVersion !== doc.buffer.version) {
      const text = doc.buffer.getText();
      if (view.input.value !== text) {
        const caret = switched
          ? (doc.carets.get(pane.id) ?? 0)
          : view.input.selectionStart;
        view.input.value = text;
        const at = Math.min(caret, text.length);
        view.input.setSelectionRange(at, at);
      } else if (switched) {
        const at = Math.min(doc.carets.get(pane.id) ?? 0, text.length);
        view.input.setSelectionRange(at, at);
      }
      view.loadedVersion = doc.buffer.version;
      if (switched) view.input.scrollTop = doc.scrollTops.get(pane.id) ?? 0;
    }

    this.#refreshGutter(view);
    if (pane.id === state.activePaneId) this.#reportCursor(view, doc);
  }

  // ---------------------------------------------------------- gutter/UI --

  #refreshGutter(view: PaneView): void {
    if (view.gutter.hidden) return;

    const lines = view.input.value.split("\n").length;
    const active = view.input.value.slice(0, view.input.selectionStart).split("\n").length;

    // Rebuilding a few thousand <div>s per keystroke is wasteful; only redo it
    // when the line count changed, and move the highlight class otherwise.
    if (view.gutter.childElementCount !== lines) {
      const frag = document.createDocumentFragment();
      for (let i = 1; i <= lines; i++) {
        const el = document.createElement("div");
        el.className = "editor__line-number";
        el.textContent = String(i);
        frag.append(el);
      }
      view.gutter.replaceChildren(frag);
    }

    const previous = view.gutter.querySelector(".is-active");
    if (previous) previous.classList.remove("is-active");
    view.gutter.children[active - 1]?.classList.add("is-active");

    view.gutter.scrollTop = view.input.scrollTop;
    this.#positionActiveLine(view, active);
  }

  #positionActiveLine(view: PaneView, line: number): void {
    if (view.activeLine.hidden) return;
    // Wrapped lines make a flat line*height mapping wrong; hide it rather than
    // draw the highlight in the wrong place.
    if (view.editor.classList.contains("editor--wrap")) {
      view.activeLine.style.display = "none";
      return;
    }
    view.activeLine.style.display = "";
    view.activeLine.style.transform = `translateY(${(line - 1) * this.#lineHeight - view.input.scrollTop}px)`;
  }

  #reportCursor(view: PaneView, doc: Document): void {
    const offset = view.input.selectionStart;
    const position = doc.buffer.positionAt(offset);
    const selected = view.input.selectionEnd - view.input.selectionStart;

    window.dispatchEvent(
      new CustomEvent("nishi:cursor", {
        detail: {
          line: position.line + 1,
          column: position.column + 1,
          selected,
          language: doc.languageId,
          eol: doc.buffer.eol === "\r\n" ? "CRLF" : "LF",
        },
      }),
    );
  }

  // -------------------------------------------------------------- input --

  #wirePane(view: PaneView, paneId: string): void {
    const activeDoc = (): Document | null => {
      const pane = app.workspace.state.panes.find((p) => p.id === paneId);
      return pane?.activeDocId ? app.workspace.document(pane.activeDocId) : null;
    };

    view.input.addEventListener("focus", () => app.workspace.activatePane(paneId));

    view.input.addEventListener("input", () => {
      const doc = activeDoc();
      if (!doc) return;

      const { start, removed, inserted } = diff(doc.buffer.getText(), view.input.value);
      if (removed === 0 && inserted === "") return;

      doc.buffer.replace(start, removed, inserted);
      view.loadedVersion = doc.buffer.version;

      this.#refreshGutter(view);
      this.#reportCursor(view, doc);
      app.noteEdit();
      // Other panes showing this document need the new text.
      app.workspace.touch();
    });

    view.input.addEventListener("scroll", () => {
      view.gutter.scrollTop = view.input.scrollTop;
      const line = view.input.value.slice(0, view.input.selectionStart).split("\n").length;
      this.#positionActiveLine(view, line);
    });

    for (const evt of ["keyup", "click", "select"] as const) {
      view.input.addEventListener(evt, () => {
        const doc = activeDoc();
        if (!doc) return;
        this.#refreshGutter(view);
        this.#reportCursor(view, doc);
      });
    }

    view.input.addEventListener("keydown", (e) => {
      const doc = activeDoc();
      if (!doc) return;

      // Undo/redo must go through the buffer, not the textarea's own stack —
      // otherwise the two disagree the moment a split view edits the document.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          this.#applyHistory(view, doc, doc.buffer.undo());
          return;
        }
        if (key === "y" || (key === "z" && e.shiftKey)) {
          e.preventDefault();
          this.#applyHistory(view, doc, doc.buffer.redo());
          return;
        }
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const size = app.settings.get<number>("editor.tabSize");
        const text = app.settings.get<boolean>("editor.insertSpaces") ? " ".repeat(size) : "\t";
        const { selectionStart: from, selectionEnd: to } = view.input;

        doc.buffer.replace(from, to - from, text);
        view.input.value = doc.buffer.getText();
        view.loadedVersion = doc.buffer.version;
        view.input.setSelectionRange(from + text.length, from + text.length);

        this.#refreshGutter(view);
        this.#reportCursor(view, doc);
        app.noteEdit();
        app.workspace.touch();
      }
    });
  }

  #applyHistory(view: PaneView, doc: Document, caret: number | null): void {
    if (caret === null) return;
    view.input.value = doc.buffer.getText();
    view.loadedVersion = doc.buffer.version;
    const at = Math.min(caret, view.input.value.length);
    view.input.setSelectionRange(at, at);
    this.#refreshGutter(view);
    this.#reportCursor(view, doc);
    app.workspace.touch();
  }

  // ------------------------------------------------------------ helpers --

  /** The textarea of the active pane, if it has a document open. */
  activeInput(): HTMLTextAreaElement | null {
    const state = app.workspace.state;
    const view = this.#panes.get(state.activePaneId);
    return view && !view.editor.hidden ? view.input : null;
  }

  focusActive(): void {
    this.activeInput()?.focus();
  }

  /** Select a buffer range in the active pane and scroll it into view. */
  reveal(start: number, end: number): void {
    const input = this.activeInput();
    if (!input) return;

    input.focus();
    input.setSelectionRange(start, end);

    // Centre the match vertically; textarea has no scrollIntoView of its own.
    const line = input.value.slice(0, start).split("\n").length;
    const target = (line - 1) * this.#lineHeight - input.clientHeight / 2;
    input.scrollTop = Math.max(0, target);

    const view = this.#panes.get(app.workspace.state.activePaneId);
    if (view) this.#refreshGutter(view);
  }

  /** Re-sync the active pane's textarea after an external buffer change. */
  syncActive(): void {
    const state = app.workspace.state;
    const view = this.#panes.get(state.activePaneId);
    const doc = app.workspace.activeDocument;
    if (!view || !doc) return;

    view.input.value = doc.buffer.getText();
    view.loadedVersion = doc.buffer.version;
    this.#refreshGutter(view);
  }
}
