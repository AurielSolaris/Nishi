/**
 * Settings — a small typed store with defaults, validation and subscribers.
 *
 * Deliberately schema-driven rather than a free-form object: the settings pane
 * renders itself from SCHEMA, so adding a setting is one entry here rather than
 * an entry plus a hand-written form control. Stage 4 lets extensions contribute
 * to the same schema.
 */

export type SettingKind = "number" | "boolean" | "string" | "enum";

export type SettingSpec = {
  key: string;
  label: string;
  description: string;
  kind: SettingKind;
  default: unknown;
  group: string;
  /** Bounds for numbers. */
  min?: number;
  max?: number;
  /** Allowed values for enums. */
  options?: string[];
  /** Persisted, but not rendered in the settings pane. */
  hidden?: boolean;
};

export const SCHEMA: SettingSpec[] = [
  {
    key: "editor.fontSize",
    label: "Font size",
    description: "Editor font size in pixels.",
    kind: "number",
    default: 13,
    min: 8,
    max: 32,
    group: "Editor",
  },
  {
    key: "editor.tabSize",
    label: "Tab size",
    description: "Spaces inserted by the Tab key, and the width a tab renders as.",
    kind: "number",
    default: 2,
    min: 1,
    max: 8,
    group: "Editor",
  },
  {
    key: "editor.insertSpaces",
    label: "Insert spaces",
    description: "Insert spaces when pressing Tab instead of a tab character.",
    kind: "boolean",
    default: true,
    group: "Editor",
  },
  {
    key: "editor.wordWrap",
    label: "Word wrap",
    description: "Wrap long lines instead of scrolling horizontally.",
    kind: "boolean",
    default: false,
    group: "Editor",
  },
  {
    key: "editor.lineNumbers",
    label: "Line numbers",
    description: "Show the line-number gutter.",
    kind: "boolean",
    default: true,
    group: "Editor",
  },
  {
    key: "editor.highlightCurrentLine",
    label: "Highlight current line",
    description: "Tint the line the caret is on.",
    kind: "boolean",
    default: true,
    group: "Editor",
  },
  {
    key: "editor.trimTrailingWhitespace",
    label: "Trim trailing whitespace",
    description: "Strip trailing spaces from every line when saving.",
    kind: "boolean",
    default: false,
    group: "Files",
  },
  {
    key: "editor.insertFinalNewline",
    label: "Insert final newline",
    description: "Ensure the file ends with a newline when saving.",
    kind: "boolean",
    default: false,
    group: "Files",
  },
  {
    key: "files.autoSave",
    label: "Auto save",
    description: "Save a modified file automatically after a short pause.",
    kind: "boolean",
    default: false,
    group: "Files",
  },
  {
    key: "workbench.sidebarVisible",
    label: "Show sidebar",
    description: "Show the project sidebar.",
    kind: "boolean",
    default: true,
    group: "Workbench",
  },
  {
    key: "workbench.lastFolder",
    label: "Last folder",
    description: "Workspace folder to reopen on launch.",
    kind: "string",
    default: "",
    group: "Workbench",
    hidden: true,
  },
  {
    key: "workbench.splitDirection",
    label: "Split direction",
    description: "How new editor panes are arranged.",
    kind: "enum",
    default: "vertical",
    options: ["vertical", "horizontal"],
    group: "Workbench",
  },
  {
    key: "memory.unloadAfterMinutes",
    label: "Unload idle files after",
    description:
      "Minutes a file may sit untouched before its contents are released. " +
      "The tab, cursor and scroll position stay; the text is read back from " +
      "disk when you look at the file again. Files with unsaved changes are " +
      "never unloaded. Set to 0 to keep every open file in memory.",
    kind: "number",
    default: 30,
    min: 0,
    max: 600,
    group: "Memory",
  },
  {
    key: "memory.maxLoadedFiles",
    label: "Maximum loaded files",
    description:
      "Upper bound on files held in memory at once. Beyond it, the least " +
      "recently used saved file is unloaded early rather than waiting out the " +
      "idle timer.",
    kind: "number",
    default: 24,
    min: 4,
    max: 512,
    group: "Memory",
  },
];

const SPEC_BY_KEY = new Map(SCHEMA.map((s) => [s.key, s]));

export type SettingsValues = Record<string, unknown>;

function coerce(spec: SettingSpec, value: unknown): unknown {
  switch (spec.kind) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return spec.default;
      const min = spec.min ?? -Infinity;
      const max = spec.max ?? Infinity;
      return Math.min(Math.max(Math.round(n), min), max);
    }
    case "boolean":
      return typeof value === "boolean" ? value : value === "true";
    case "enum":
      return spec.options?.includes(String(value)) ? String(value) : spec.default;
    case "string":
      return typeof value === "string" ? value : String(value ?? spec.default);
  }
}

export class Settings {
  #values: SettingsValues = {};
  #listeners = new Set<(values: SettingsValues) => void>();

  constructor(initial: SettingsValues = {}) {
    for (const spec of SCHEMA) this.#values[spec.key] = spec.default;
    this.merge(initial);
  }

  /** Apply stored values, ignoring unknown keys and coercing bad ones. */
  merge(values: SettingsValues): void {
    for (const [key, value] of Object.entries(values)) {
      const spec = SPEC_BY_KEY.get(key);
      if (spec) this.#values[key] = coerce(spec, value);
    }
    this.#emit();
  }

  get<T>(key: string): T {
    return this.#values[key] as T;
  }

  set(key: string, value: unknown): void {
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) return;
    const next = coerce(spec, value);
    if (this.#values[key] === next) return;
    this.#values[key] = next;
    this.#emit();
  }

  reset(key: string): void {
    const spec = SPEC_BY_KEY.get(key);
    if (spec) this.set(key, spec.default);
  }

  /** Only values that differ from their default, for persistence. */
  toJSON(): SettingsValues {
    const out: SettingsValues = {};
    for (const spec of SCHEMA) {
      if (this.#values[spec.key] !== spec.default) out[spec.key] = this.#values[spec.key];
    }
    return out;
  }

  get all(): SettingsValues {
    return { ...this.#values };
  }

  subscribe(listener: (values: SettingsValues) => void): () => void {
    this.#listeners.add(listener);
    listener(this.all);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    const snapshot = this.all;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
