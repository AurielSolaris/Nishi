/**
 * Nishi view entrypoint — Stage 1.
 *
 * Boots the app object, mounts the imperative editor renderer, registers the
 * Alpine components, and owns the global keymap.
 */

import Alpine from "alpinejs";
import { BRAND } from "../core/branding.ts";
import { app } from "./app.ts";
import { EditorView } from "./editor-view.ts";
import { registerComponents } from "./components.ts";
import { createUiStore, type SidebarPanel, type UiStore } from "./ui-store.ts";

// Registered first: subscriptions below write to it during their initial
// callback, which fires synchronously on subscribe.
Alpine.store("ui", createUiStore());

const ui = (): UiStore => Alpine.store("ui") as UiStore;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

$<HTMLSpanElement>("version-badge").textContent = BRAND.version;

// ------------------------------------------------------------ status wiring --
// Registered before init() so a failure during startup still reaches the UI.

app.onStatus((message, tone) => {
  const store = ui();
  store.status = message;
  store.statusTone = tone;
});

// The host is resolved asynchronously, and EditorView renders on construction,
// so nothing may touch app.host before this point.
await app.init();

const editor = new EditorView(
  $<HTMLDivElement>("panes"),
  $<HTMLTemplateElement>("welcome-template"),
);

window.addEventListener("nishi:cursor", (event) => {
  const detail = (event as CustomEvent<{
    line: number;
    column: number;
    selected: number;
    language: string;
    eol: string;
  }>).detail;

  const store = ui();
  store.cursor = `Ln ${detail.line}, Col ${detail.column}`;
  store.selected = detail.selected;
  store.language = detail.language;
  store.eol = detail.eol;
});

app.workspace.subscribe((state) => {
  const store = ui();
  store.dirtyCount = app.workspace.dirtyDocuments.length;
  if (state.panes.every((p) => p.activeDocId === null)) {
    // Nothing open: the status bar should say nothing, not "Ln 1, Col 1".
    store.cursor = "";
    store.language = "";
    store.eol = "";
    store.selected = 0;
  }
  $<HTMLDivElement>("window-title").textContent = app.title();
});

// ------------------------------------------------------------------- keymap --

document.addEventListener("keydown", (e) => {
  // Escape closes the find bar from anywhere.
  if (e.key === "Escape" && ui().findOpen) {
    ui().findOpen = false;
    editor.focusActive();
    return;
  }

  if (!e.ctrlKey && !e.metaKey) return;
  const key = e.key.toLowerCase();

  switch (key) {
    case "n":
      e.preventDefault();
      app.newBuffer();
      queueMicrotask(() => editor.focusActive());
      break;

    case "s":
      e.preventDefault();
      void app.save();
      break;

    case "w": {
      e.preventDefault();
      const state = app.workspace.state;
      const pane = state.panes.find((p) => p.id === state.activePaneId);
      if (pane?.activeDocId) void app.closeTab(pane.id, pane.activeDocId);
      break;
    }

    case "f":
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("nishi:find", { detail: { replace: false } }));
      break;

    case "h":
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("nishi:find", { detail: { replace: true } }));
      break;

    case "b": {
      e.preventDefault();
      const store = Alpine.store("ui") as UiStore;
      store.showPanel(store.sidebarPanel);
      break;
    }

    case ",": {
      e.preventDefault();
      const store = Alpine.store("ui") as UiStore;
      store.sidebarPanel = "settings" satisfies SidebarPanel;
      store.sidebarVisible = true;
      break;
    }

    case "\\":
      e.preventDefault();
      app.split();
      queueMicrotask(() => editor.focusActive());
      break;

    case "k":
      // Ctrl+K then arrow-free: cycle panes. Kept simple for Stage 1.
      e.preventDefault();
      app.workspace.focusNextPane();
      editor.focusActive();
      break;
  }
});

// Warn before discarding unsaved work.
window.addEventListener("beforeunload", (e) => {
  if (app.workspace.dirtyDocuments.length > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-window-action]")) {
  button.addEventListener("click", async () => {
    const action = button.dataset["windowAction"] as "minimize" | "maximize" | "close";
    if (action === "close") {
      const dirty = app.workspace.dirtyDocuments;
      if (dirty.length > 0) {
        const names = dirty.map((d) => d.name).join(", ");
        if (!window.confirm(`Unsaved changes in ${names}. Close anyway?`)) return;
      }
    }
    const handled = await app.host.windowAction(action);
    if (!handled) app.status(`${action} needs the Electrobun host`, "error");
  });
}

// --------------------------------------------------------------------- boot --

registerComponents(Alpine, editor);

// Settings that the shell (rather than the editor) reacts to.
app.settings.subscribe((values) => {
  const store = ui();
  store.sidebarVisible = values["workbench.sidebarVisible"] as boolean;
});

Alpine.start();

const info = await app.host.info();
const store = ui();
store.hostLabel = `${info.runtime} · ${info.platform}`;
store.hostReady = true;
store.root = app.workspaceInfo.label;

app.status("Ready");
console.info(`[nishi] ${BRAND.name} ${BRAND.version} "${BRAND.codename}" on ${info.runtime}`);
