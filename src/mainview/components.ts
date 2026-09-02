/**
 * Alpine components.
 *
 * The explorer, settings pane, find bar and status bar are declarative,
 * list-and-form shaped UI — exactly what Alpine is for, and the point at which
 * the Stage 0 shell's hand-rolled DOM stopped paying off. The editor surface
 * stays imperative (see editor-view.ts).
 */

import type { Alpine as AlpineType } from "alpinejs";
import { SCHEMA, type SettingSpec } from "../core/settings.ts";
import {
  EMPTY_OPTIONS,
  findMatches,
  nextMatchIndex,
  previousMatchIndex,
  expandReplacement,
  replaceAll,
  type Match,
  type SearchOptions,
} from "../core/search.ts";
import { app } from "./app.ts";
import { vfsDirname, vfsJoin, type VfsPath } from "../core/vfs-path.ts";
import { iconForEntry } from "./icons.ts";
import type { UiStore } from "./ui-store.ts";
import type { EditorView } from "./editor-view.ts";

type Row = {
  name: string;
  path: VfsPath;
  kind: "file" | "directory";
  depth: number;
  expanded: boolean;
  loading: boolean;
  /** Reached through a symbolic link that still resolves inside the mount. */
  link: boolean;
};

/**
 * Rows are addressed by VfsPath, so building a child path is `vfsJoin` and not
 * a guess about which separator this platform uses. The helper this replaces
 * sniffed the parent for a backslash, which picks wrong for any workspace path
 * that happens to contain neither separator.
 */
const toRow = (
  entry: { name: string; path: VfsPath; kind: "file" | "directory"; link: boolean },
  depth: number,
): Row => ({
  name: entry.name,
  path: entry.path,
  kind: entry.kind,
  depth,
  expanded: false,
  loading: false,
  link: entry.link,
});

export function registerComponents(Alpine: AlpineType, editor: EditorView): void {
  // ----------------------------------------------------------- explorer --

  Alpine.data("explorer", () => ({
    rows: [] as Row[],
    loading: false,
    error: "",

    init() {
      void this.refresh();
      window.addEventListener("nishi:root-changed", () => void this.refresh());
      // The host watches the workspace and says which folders moved; redraw only
      // those rather than collapsing the whole tree on every save.
      window.addEventListener("nishi:fs-changed", (event) => {
        const detail = (event as CustomEvent<{ directories: VfsPath[] }>).detail;
        void this.refreshDirectories(detail?.directories ?? []);
      });
    },

    get rootName(): string {
      return app.workspaceInfo.label;
    },

    /** Sprite symbol id for a row, by kind and file type. */
    iconFor(row: Row): string {
      return iconForEntry(row.kind, row.name, row.expanded);
    },

    async refresh() {
      this.loading = true;
      this.error = "";
      try {
        const { entries } = await app.host.fs.list();
        this.rows = entries.map((entry) => toRow(entry, 0));
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },

    async toggle(index: number) {
      const row = this.rows[index];
      if (!row) return;

      if (row.kind === "file") {
        await app.openPath(row.path);
        return;
      }

      if (row.expanded) {
        // Collapse: drop every following row nested under this one.
        let end = index + 1;
        while (end < this.rows.length && this.rows[end]!.depth > row.depth) end++;
        this.rows.splice(index + 1, end - index - 1);
        row.expanded = false;
        return;
      }

      row.loading = true;
      try {
        const { entries } = await app.host.fs.list(row.path);
        this.rows.splice(index + 1, 0, ...entries.map((entry) => toRow(entry, row.depth + 1)));
        row.expanded = true;
      } catch (error) {
        app.fail(error, "Could not read folder");
      } finally {
        row.loading = false;
      }
    },

    /** Index range of the rows nested under `index`, excluding the row itself. */
    childRange(index: number): { start: number; end: number } {
      const row = this.rows[index]!;
      let end = index + 1;
      while (end < this.rows.length && this.rows[end]!.depth > row.depth) end++;
      return { start: index + 1, end };
    },

    /**
     * Redraw the folders a watcher batch touched.
     *
     * Only expanded folders are re-listed: a collapsed one has no rows on screen
     * to be wrong, and reads fresh whenever it is opened. If the root itself
     * moved, the whole tree is rebuilt and the rest of the batch is redundant.
     */
    async refreshDirectories(directories: VfsPath[]) {
      if (directories.includes(app.workspaceInfo.uri)) {
        await this.refresh();
        return;
      }

      for (const directory of directories) {
        const index = this.rows.findIndex((row) => row.path === directory && row.expanded);
        if (index === -1) continue;

        const row = this.rows[index]!;
        const { start, end } = this.childRange(index);
        try {
          const { entries } = await app.host.fs.list(directory);
          this.rows.splice(start, end - start, ...entries.map((entry) => toRow(entry, row.depth + 1)));
        } catch {
          // The folder is gone. Drop its children and collapse it; the change
          // event on its parent removes the row itself.
          this.rows.splice(start, end - start);
          row.expanded = false;
        }
      }
    },

    /** Directory to create new entries in: the selected folder, else the root. */
    targetDir(index: number | null): VfsPath {
      const root = app.workspaceInfo.uri;
      if (index === null) return root;
      const row = this.rows[index];
      if (!row) return root;
      return row.kind === "directory" ? row.path : vfsDirname(row.path);
    },

    async create(kind: "file" | "directory", index: number | null = null) {
      const dir = this.targetDir(index);
      const name = window.prompt(`New ${kind === "file" ? "file" : "folder"} name:`);
      if (!name) return;
      try {
        await app.host.fs.create(vfsJoin(dir, name), kind);
        await this.refresh();
        app.status(`Created ${name}`);
      } catch (error) {
        app.fail(error, "Could not create");
      }
    },

    async rename(index: number) {
      const row = this.rows[index];
      if (!row) return;
      const name = window.prompt("Rename to:", row.name);
      if (!name || name === row.name) return;

      try {
        await app.host.fs.rename(row.path, vfsJoin(vfsDirname(row.path), name));
        await this.refresh();
        app.status(`Renamed to ${name}`);
      } catch (error) {
        app.fail(error, "Could not rename");
      }
    },

    async remove(index: number) {
      const row = this.rows[index];
      if (!row) return;
      const confirmed = await app.host.dialogs.confirm({
        title: `Delete ${row.name}?`,
        message: `Delete ${row.name}?`,
        detail: "This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!confirmed) return;
      try {
        await app.host.fs.remove(row.path);
        await this.refresh();
        app.status(`Deleted ${row.name}`);
      } catch (error) {
        app.fail(error, "Could not delete");
      }
    },

    async openFolder() {
      // The host decides how to ask — a native picker on the desktop, a prompt
      // in the browser. Either way this is the one input in the whole UI that is
      // a real operating-system path rather than a VfsPath: mounting a folder is
      // how the VFS gets something to publish.
      await app.pickFolder();
      (Alpine.store("ui") as UiStore).root = app.workspaceInfo.label;
    },
  }));

  // ----------------------------------------------------------- settings --

  Alpine.data("settingsPane", () => ({
    groups: [] as { name: string; specs: SettingSpec[] }[],
    values: {} as Record<string, unknown>,

    init() {
      const byGroup = new Map<string, SettingSpec[]>();
      for (const spec of SCHEMA) {
        if (spec.hidden) continue;
        const list = byGroup.get(spec.group) ?? [];
        list.push(spec);
        byGroup.set(spec.group, list);
      }
      this.groups = [...byGroup].map(([name, specs]) => ({ name, specs }));

      app.settings.subscribe((values) => {
        this.values = values;
      });
    },

    update(spec: SettingSpec, event: Event) {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      const raw = spec.kind === "boolean" ? (target as HTMLInputElement).checked : target.value;
      app.settings.set(spec.key, raw);
    },

    reset(spec: SettingSpec) {
      app.settings.reset(spec.key);
    },

    isDefault(spec: SettingSpec): boolean {
      return this.values[spec.key] === spec.default;
    },
  }));

  // --------------------------------------------------------------- find --

  Alpine.data("findBar", () => ({
    options: { ...EMPTY_OPTIONS } as SearchOptions,
    replacement: "",
    showReplace: false,
    matches: [] as Match[],
    current: -1,

    init() {
      window.addEventListener("nishi:find", (e) => {
        const detail = (e as CustomEvent<{ replace?: boolean }>).detail;
        this.showReplace = detail?.replace ?? this.showReplace;
        this.open();
      });
    },

    open() {
      (Alpine.store("ui") as UiStore).findOpen = true;
      queueMicrotask(() => {
        const input = document.getElementById("find-input") as HTMLInputElement | null;
        input?.focus();
        input?.select();
      });
      this.run();
    },

    close() {
      (Alpine.store("ui") as UiStore).findOpen = false;
      editor.focusActive();
    },

    get summary(): string {
      if (this.options.query === "") return "";
      if (this.matches.length === 0) return "No results";
      return `${this.current + 1} of ${this.matches.length}`;
    },

    /** Recompute matches against the active document. */
    run() {
      const doc = app.workspace.activeDocument;
      if (!doc) {
        this.matches = [];
        this.current = -1;
        return;
      }
      this.matches = findMatches(doc.buffer, this.options);
      if (this.matches.length === 0) {
        this.current = -1;
      } else if (this.current >= this.matches.length) {
        this.current = 0;
      }
    },

    next() {
      this.run();
      if (this.matches.length === 0) return;
      const input = editor.activeInput();
      const from = input ? input.selectionEnd : 0;
      this.current = nextMatchIndex(this.matches, from);
      this.revealCurrent();
    },

    previous() {
      this.run();
      if (this.matches.length === 0) return;
      const input = editor.activeInput();
      const from = input ? input.selectionStart : 0;
      this.current = previousMatchIndex(this.matches, from);
      this.revealCurrent();
    },

    revealCurrent() {
      const match = this.matches[this.current];
      if (match) editor.reveal(match.start, match.end);
    },

    replaceCurrent() {
      const doc = app.workspace.activeDocument;
      if (!doc) return;
      this.run();

      const input = editor.activeInput();
      // Replace the match the caret is sitting on, else advance to one.
      const at = input ? input.selectionStart : 0;
      const index = this.matches.findIndex((m) => m.start === at && m.end === (input?.selectionEnd ?? -1));
      if (index === -1) {
        this.next();
        return;
      }

      const match = this.matches[index]!;
      doc.buffer.replace(
        match.start,
        match.end - match.start,
        expandReplacement(this.replacement, this.options, doc.buffer, match),
      );
      doc.buffer.breakUndoGroup();
      editor.syncActive();
      app.workspace.touch();
      app.noteEdit();
      this.run();
      this.next();
    },

    replaceEvery() {
      const doc = app.workspace.activeDocument;
      if (!doc) return;
      const count = replaceAll(doc.buffer, this.options, this.replacement);
      editor.syncActive();
      app.workspace.touch();
      app.noteEdit();
      this.run();
      app.status(count === 0 ? "No results" : `Replaced ${count} occurrence${count === 1 ? "" : "s"}`);
    },
  }));
}
