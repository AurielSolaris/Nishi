/**
 * Host bridge.
 *
 * Nishi's UI never talks to a runtime directly. It talks to a `NishiHost`,
 * which is implemented twice:
 *
 *   - `browserHost`    — the Bun dev server (scripts/dev-server.ts), over HTTP.
 *   - `electrobunHost` — the real desktop shell, over Electrobun RPC. Not wired
 *                        yet; see src/bun/index.ts and PLAN.MD (Stage 0).
 *
 * Both are backed by the same service (src/host/fs-service.ts), so wiring the
 * desktop shell is a transport change, not a behaviour change. Keeping this
 * seam explicit is also what lets Stage 6 swap the renderer without the editor
 * UI noticing.
 */

export type HostKind = "electrobun" | "browser";

export type HostInfo = {
  kind: HostKind;
  /** Human-readable runtime label, e.g. "Bun 1.3.14". */
  runtime: string;
  platform: string;
  version: string;
};

export type WindowAction = "minimize" | "maximize" | "close";

export type EntryKind = "file" | "directory";

export type DirEntry = {
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
};

export type FileContent = {
  path: string;
  name: string;
  content: string;
  binary: boolean;
  size: number;
};

export interface HostFs {
  root(): Promise<string>;
  setRoot(path: string): Promise<string>;
  list(path?: string): Promise<{ path: string; entries: DirEntry[] }>;
  read(path: string): Promise<FileContent>;
  write(path: string, content: string): Promise<{ path: string; size: number }>;
  create(path: string, kind: EntryKind): Promise<{ path: string }>;
  rename(from: string, to: string): Promise<{ path: string }>;
  remove(path: string): Promise<void>;
}

export interface NishiHost {
  readonly kind: HostKind;
  info(): Promise<HostInfo>;
  /** Basic window management. Returns false when the host cannot honor it. */
  windowAction(action: WindowAction): Promise<boolean>;
  setTitle(title: string): Promise<void>;
  fs: HostFs;
  loadSettings(): Promise<Record<string, unknown>>;
  saveSettings(values: Record<string, unknown>): Promise<void>;
}

/** Raised for any non-2xx host reply, carrying the server's message. */
export class HostError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body — the status line is all we have.
    }
    throw new HostError(message);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const browserFs: HostFs = {
  root: () => api<{ root: string }>("/api/fs/root").then((r) => r.root),
  setRoot: (path) => api<{ root: string }>("/api/fs/root", json({ path })).then((r) => r.root),
  list: (path) =>
    api(`/api/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  read: (path) => api(`/api/fs/read?path=${encodeURIComponent(path)}`),
  write: (path, content) => api("/api/fs/write", json({ path, content })),
  create: (path, kind) => api("/api/fs/create", json({ path, kind })),
  rename: (from, to) => api("/api/fs/rename", json({ from, to })),
  remove: (path) => api<{ ok: true }>("/api/fs/remove", json({ path })).then(() => undefined),
};

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
        version: "0.2.0",
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

  loadSettings: () => api<Record<string, unknown>>("/api/settings"),
  saveSettings: (values) =>
    api<{ ok: true }>("/api/settings", json(values)).then(() => undefined),
};

type RpcClient = {
  request: Record<string, (params: unknown) => Promise<unknown>>;
};

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
      root: () => call<string>("fsRoot"),
      setRoot: (path) => call<string>("fsSetRoot", { path }),
      list: (path) => call("fsList", { path }),
      read: (path) => call("fsRead", { path }),
      write: (path, content) => call("fsWrite", { path, content }),
      create: (path, kind) => call("fsCreate", { path, kind }),
      rename: (from, to) => call("fsRename", { from, to }),
      remove: (path) => call<void>("fsRemove", { path }),
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
      rpc: Electroview.defineRPC({
        maxRequestTime: 15_000,
        handlers: { requests: {}, messages: {} },
      }),
    });
    if (!view.rpc) throw new Error("Electroview provided no RPC channel");
    return makeElectrobunHost(view.rpc as unknown as RpcClient);
  } catch (error) {
    console.error("[nishi] Electrobun host unavailable, falling back", error);
    return browserHost;
  }
}
