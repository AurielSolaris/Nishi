/**
 * Host bridge.
 *
 * Nishi's UI never talks to a runtime directly. It talks to a `NishiHost`,
 * which is implemented twice:
 *
 *   - `browserHost`    — the Bun dev server (scripts/dev-server.ts), over HTTP,
 *                        with change notifications over Server-Sent Events.
 *   - `electrobunHost` — the desktop shell (src/bun/index.ts), over Electrobun
 *                        RPC, with change notifications as RPC messages.
 *
 * Both are backed by the same service (src/host/fs-service.ts) on top of the
 * same VFS (src/host/vfs.ts), so behaviour cannot drift between them. Keeping
 * this seam explicit is also what lets Stage 6 swap the renderer without the
 * editor UI noticing.
 *
 * ## Paths
 *
 * Everything here is a `VfsPath` — `nishi://workspace/src/core/buffer.ts`. The
 * view has no way to name a file outside a mount, because the type has no
 * syntax for one and the host re-validates anyway. `openFolder` is the single
 * exception: it takes a real path typed by the user, which is the same
 * authority a native folder picker carries.
 */

import type {
  ConfirmOptions,
  DirEntry,
  EntryKind,
  FsChange,
  HostInfo,
  HostKind,
  FileContent,
  JournalEntry,
  NishiRPC,
  RecoveredEntry,
  WindowAction,
  WorkspaceInfo,
  WriteResult,
} from "./host-rpc.ts";
import type { VfsPath } from "./vfs-path.ts";

export type {
  ConfirmOptions,
  DirEntry,
  EntryKind,
  FileContent,
  FsChange,
  FsChangeType,
  HostInfo,
  HostKind,
  JournalEntry,
  RecoveredEntry,
  WindowAction,
  WorkspaceInfo,
} from "./host-rpc.ts";

export interface HostFs {
  workspace(): Promise<WorkspaceInfo>;
  /** PRIVILEGED — user gesture only. Mounts a different real folder. */
  openFolder(realPath: string): Promise<WorkspaceInfo>;
  list(path?: VfsPath): Promise<{ path: VfsPath; entries: DirEntry[] }>;
  read(path: VfsPath): Promise<FileContent>;
  write(path: VfsPath, content: string): Promise<WriteResult>;
  create(path: VfsPath, kind: EntryKind): Promise<{ path: VfsPath }>;
  rename(from: VfsPath, to: VfsPath): Promise<{ path: VfsPath }>;
  remove(path: VfsPath): Promise<void>;
}

/**
 * Unsaved work, held somewhere that is not the buffer.
 *
 * The view decides *when* to journal; the host decides *where*. Keeping the
 * decision split that way means the journal is never addressable through a
 * VfsPath — see src/host/journal.ts.
 */
export interface HostJournal {
  put(entry: JournalEntry): Promise<void>;
  drop(key: string): Promise<void>;
  get(key: string): Promise<JournalEntry | null>;
  /** Entries left over from a previous run, annotated against the disk now. */
  recover(): Promise<RecoveredEntry[]>;
}

/**
 * Native dialogs, where the host has them.
 *
 * The browser host has none, and says so by falling back to the DOM's own
 * prompt and confirm rather than pretending. Both are honest; only one is nice.
 */
export interface HostDialogs {
  /** PRIVILEGED — returns a real path, or null when cancelled. */
  openFolder(startingFolder?: string): Promise<string | null>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** True when these are real native dialogs rather than DOM fallbacks. */
  readonly native: boolean;
}

export interface NishiHost {
  readonly kind: HostKind;
  info(): Promise<HostInfo>;
  /** Basic window management. Returns false when the host cannot honor it. */
  windowAction(action: WindowAction): Promise<boolean>;
  setTitle(title: string): Promise<void>;
  fs: HostFs;
  journal: HostJournal;
  dialogs: HostDialogs;
  /** Subscribe to filesystem changes the editor did not make. */
  onFsChange(listener: (changes: FsChange[]) => void): () => void;
  loadSettings(): Promise<Record<string, unknown>>;
  saveSettings(values: Record<string, unknown>): Promise<void>;
}

/** Raised for any non-2xx host reply, carrying the server's message. */
export class HostError extends Error {
  constructor(
    message: string,
    /** The VfsError code when the host supplied one; "unknown" otherwise. */
    readonly code: string = "unknown",
  ) {
    super(message);
    this.name = "HostError";
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code = "unknown";
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // Non-JSON error body — the status line is all we have.
    }
    throw new HostError(message, code);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const browserFs: HostFs = {
  workspace: () => api<WorkspaceInfo>("/api/fs/workspace"),
  openFolder: (realPath) => api<WorkspaceInfo>("/api/fs/workspace", json({ path: realPath })),
  list: (path) => api(`/api/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  read: (path) => api(`/api/fs/read?path=${encodeURIComponent(path)}`),
  write: (path, content) => api("/api/fs/write", json({ path, content })),
  create: (path, kind) => api("/api/fs/create", json({ path, kind })),
  rename: (from, to) => api("/api/fs/rename", json({ from, to })),
  remove: (path) => api<{ ok: true }>("/api/fs/remove", json({ path })).then(() => undefined),
};

/**
 * Change notifications on the dev host, over Server-Sent Events.
 *
 * SSE rather than a WebSocket because the traffic is one-directional and
 * EventSource reconnects on its own — a dev server restart should not leave the
 * explorer silently stale for the rest of the session.
 */
function browserFsChanges(listener: (changes: FsChange[]) => void): () => void {
  if (typeof EventSource === "undefined") return () => {};

  const source = new EventSource("/api/events");
  source.addEventListener("fs", (event) => {
    try {
      listener(JSON.parse((event as MessageEvent<string>).data) as FsChange[]);
    } catch (error) {
      console.error("[nishi] malformed fs event", error);
    }
  });
  source.addEventListener("error", () => {
    // EventSource retries by itself; log at most that it dropped.
    if (source.readyState === EventSource.CLOSED) {
      console.warn("[nishi] fs event stream closed");
    }
  });

  return () => source.close();
}

const browserHost: NishiHost = {
  kind: "browser",

  async info() {
    try {
      return await api<HostInfo>("/api/host");
    } catch {
      return {
        kind: "browser",
        runtime: "unknown",
        platform: navigator.platform || "web",
        version: "0.3.0",
        watching: false,
      };
    }
  },

  async windowAction(action) {
    // A browser tab cannot minimize or maximize itself, and only a
    // script-opened window may close itself. Report the refusal honestly so
    // the status bar can say so rather than silently doing nothing.
    console.info(`[nishi] window.${action} is unavailable on the browser host`);
    return false;
  },

  async setTitle(title) {
    document.title = title;
  },

  fs: browserFs,

  journal: {
    put: (entry) => api<{ ok: true }>("/api/journal", json(entry)).then(() => undefined),
    drop: (key) =>
      api<{ ok: true }>(`/api/journal/${encodeURIComponent(key)}`, { method: "DELETE" }).then(
        () => undefined,
      ),
    get: (key) => api<JournalEntry | null>(`/api/journal/${encodeURIComponent(key)}`),
    recover: () => api<RecoveredEntry[]>("/api/journal/recover"),
  },

  dialogs: {
    native: false,
    async openFolder(startingFolder) {
      // A browser tab has no native folder picker, and the one input in the app
      // that is a real OS path has to come from somewhere.
      return window.prompt("Open folder (absolute path):", startingFolder ?? "");
    },
    async confirm(options) {
      const detail = options.detail ? `\n\n${options.detail}` : "";
      return window.confirm(`${options.message}${detail}`);
    },
  },

  onFsChange: browserFsChanges,

  loadSettings: () => api<Record<string, unknown>>("/api/settings"),
  saveSettings: (values) =>
    api<{ ok: true }>("/api/settings", json(values)).then(() => undefined),
};

type RpcClient = {
  request: Record<string, (params: unknown) => Promise<unknown>>;
};

/**
 * Fan-out for host-pushed changes on the desktop shell.
 *
 * The RPC message handler is registered once at construction, before any
 * subscriber exists, so an event arriving during startup is delivered to
 * whoever has subscribed by then rather than dropped for want of a handler.
 */
const electrobunListeners = new Set<(changes: FsChange[]) => void>();

function dispatchFsChanges(changes: FsChange[]): void {
  for (const listener of electrobunListeners) {
    try {
      listener(changes);
    } catch (error) {
      console.error("[nishi] fs change listener threw", error);
    }
  }
}

function makeElectrobunHost(rpc: RpcClient): NishiHost {
  const call = <T>(method: string, params: unknown = {}): Promise<T> => {
    const fn = rpc.request[method];
    if (!fn) return Promise.reject(new HostError(`Host does not implement ${method}`));
    return fn(params) as Promise<T>;
  };

  return {
    kind: "electrobun",
    info: () => call<HostInfo>("hostInfo"),
    windowAction: (action) => call<boolean>("windowAction", { action }),
    async setTitle(title) {
      document.title = title;
      await call<void>("setTitle", { title });
    },
    fs: {
      workspace: () => call<WorkspaceInfo>("fsWorkspace"),
      openFolder: (realPath) => call<WorkspaceInfo>("fsOpenFolder", { path: realPath }),
      list: (path) => call("fsList", { path }),
      read: (path) => call("fsRead", { path }),
      write: (path, content) => call("fsWrite", { path, content }),
      create: (path, kind) => call("fsCreate", { path, kind }),
      rename: (from, to) => call("fsRename", { from, to }),
      remove: (path) => call<void>("fsRemove", { path }),
    },
    journal: {
      put: (entry) => call<void>("journalPut", { entry }),
      drop: (key) => call<void>("journalDrop", { key }),
      get: (key) => call<JournalEntry | null>("journalGet", { key }),
      recover: () => call<RecoveredEntry[]>("journalRecover"),
    },

    dialogs: {
      native: true,
      openFolder: (startingFolder) => call<string | null>("dialogOpenFolder", { startingFolder }),
      confirm: (options) => call<boolean>("dialogConfirm", { options }),
    },

    onFsChange(listener) {
      electrobunListeners.add(listener);
      return () => electrobunListeners.delete(listener);
    },
    loadSettings: () => call<Record<string, unknown>>("loadSettings"),
    saveSettings: (values) => call<void>("saveSettings", { values }),
  };
}

/**
 * True when this view is running inside the Electrobun desktop shell.
 *
 * The devkit declares `window.__electrobunWebviewId` as always present, but on
 * the browser dev host the preload never runs and it is genuinely absent — so
 * read it through a partial view of Window rather than trusting the ambient type.
 */
export function isElectrobun(): boolean {
  if (typeof window === "undefined") return false;
  return (window as Partial<Window>).__electrobunWebviewId !== undefined;
}

/**
 * Pick the host implementation for whatever runtime we booted under.
 *
 * The Electrobun view SDK is imported dynamically and only when its preload
 * globals are present, so the browser dev bundle never pulls desktop code into
 * its main chunk. If that import fails we fall back rather than showing a blank
 * window — a degraded editor beats no editor.
 */
export async function createHost(): Promise<NishiHost> {
  if (!isElectrobun()) return browserHost;

  try {
    const { Electroview } = await import("electrobun/view");
    const view = new Electroview({
      rpc: Electroview.defineRPC<NishiRPC>({
        maxRequestTime: 15_000,
        handlers: {
          requests: {},
          messages: {
            fsChanges: ({ changes }) => dispatchFsChanges(changes),
          },
        },
      }),
    });
    if (!view.rpc) throw new Error("Electroview provided no RPC channel");
    return makeElectrobunHost(view.rpc as unknown as RpcClient);
  } catch (error) {
    console.error("[nishi] Electrobun host unavailable, falling back", error);
    return browserHost;
  }
}
