/**
 * The shared Alpine store backing the chrome: which sidebar panel is showing,
 * status bar text, cursor readout, host label.
 *
 * Typed in one place because both the Alpine templates and the imperative
 * boot code in index.ts write to it, and Alpine's own store typing is opaque.
 */

import { app } from "./app.ts";

export type SidebarPanel = "explorer" | "settings" | "extensions";

export type UiStore = {
  sidebarPanel: SidebarPanel;
  sidebarVisible: boolean;
  findOpen: boolean;
  status: string;
  statusTone: "info" | "error";
  cursor: string;
  selected: number;
  language: string;
  eol: string;
  hostLabel: string;
  hostReady: boolean;
  root: string;
  dirtyCount: number;
  showPanel(panel: SidebarPanel): void;
};

export function createUiStore(): UiStore {
  return {
    sidebarPanel: "explorer",
    sidebarVisible: true,
    findOpen: false,
    status: "Ready",
    statusTone: "info",
    cursor: "Ln 1, Col 1",
    selected: 0,
    language: "",
    eol: "",
    hostLabel: "connecting…",
    hostReady: false,
    root: "",
    dirtyCount: 0,

    showPanel(panel: SidebarPanel): void {
      // Clicking the active panel's icon collapses the sidebar, as in Atom.
      if (this.sidebarPanel === panel && this.sidebarVisible) {
        this.sidebarVisible = false;
      } else {
        this.sidebarPanel = panel;
        this.sidebarVisible = true;
      }
      app.settings.set("workbench.sidebarVisible", this.sidebarVisible);
    },
  };
}
