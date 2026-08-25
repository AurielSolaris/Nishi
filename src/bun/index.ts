/**
 * Electrobun main process — the Nishi desktop shell.
 *
 * The desktop counterpart of scripts/dev-server.ts. Both expose the same
 * operations to the UI; only the transport differs (RPC here, HTTP there), and
 * both delegate to the same FsService, so behaviour cannot drift between them.
 *
 * Run with:
 *   hutch electrobun dev --watch
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { BrowserView, BrowserWindow, type RPCSchema } from "electrobun/main";
import { BRAND } from "../core/branding.ts";
import {
  FsService,
  loadSettingsFile,
  saveSettingsFile,
  type DirEntry,
  type EntryKind,
  type FileContent,
} from "../host/fs-service.ts";

/**
 * Where the explorer starts.
 *
 * NOT process.cwd(): for a launched app that is the bundle's bin/ folder, which
 * would show the user Nishi's own binaries. Prefer the folder they last opened,
 * then their home directory.
 */
async function resolveInitialRoot(): Promise<string> {
  const override = Bun.env["NISHI_ROOT"];
  if (override) return override;

  const stored = (await loadSettingsFile())["workbench.lastFolder"];
  if (typeof stored === "string" && stored !== "") {
    try {
      if ((await stat(stored)).isDirectory()) return stored;
    } catch {
      // Folder moved or was deleted since last launch — fall through.
    }
  }

  return homedir();
}

const fs = new FsService(await resolveInitialRoot());

type WindowAction = "minimize" | "maximize" | "close";

type HostInfo = {
  kind: "electrobun";
  runtime: string;
  platform: string;
  version: string;
};

type NishiRPC = {
  bun: RPCSchema<{
    requests: {
      hostInfo: { params: Record<string, never>; response: HostInfo };
      windowAction: { params: { action: WindowAction }; response: boolean };
      setTitle: { params: { title: string }; response: void };

      fsRoot: { params: Record<string, never>; response: string };
      fsSetRoot: { params: { path: string }; response: string };
      fsList: { params: { path?: string }; response: { path: string; entries: DirEntry[] } };
      fsRead: { params: { path: string }; response: FileContent };
      fsWrite: { params: { path: string; content: string }; response: { path: string; size: number } };
      fsCreate: { params: { path: string; kind: EntryKind }; response: { path: string } };
      fsRename: { params: { from: string; to: string }; response: { path: string } };
      fsRemove: { params: { path: string }; response: void };

      loadSettings: { params: Record<string, never>; response: Record<string, unknown> };
      saveSettings: { params: { values: Record<string, unknown> }; response: void };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: Record<string, never>;
  }>;
};

const rpc = BrowserView.defineRPC<NishiRPC>({
  maxRequestTime: 15_000,
  handlers: {
    requests: {
      hostInfo: (): HostInfo => ({
        kind: "electrobun",
        runtime: `Electrobun 2.0.1 · Bun ${Bun.version}`,
        platform: `${process.platform}-${process.arch}`,
        version: BRAND.version,
      }),

      windowAction: ({ action }) => {
        switch (action) {
          case "minimize":
            mainWindow.minimize();
            return true;
          case "maximize":
            // One button, two meanings — mirror what the OS chrome would do.
            if (mainWindow.isMaximized()) mainWindow.unmaximize();
            else mainWindow.maximize();
            return true;
          case "close":
            // requestClose, not close: it lets the window's own close handling
            // run rather than tearing the process down underneath it.
            mainWindow.requestClose();
            return true;
          default:
            return false;
        }
      },

      setTitle: ({ title }) => {
        mainWindow.setTitle(title);
      },

      fsRoot: () => fs.root,
      fsSetRoot: ({ path }) => fs.setRoot(path),
      fsList: ({ path }) => fs.list(path),
      fsRead: ({ path }) => fs.read(path),
      fsWrite: ({ path, content }) => fs.write(path, content),
      fsCreate: ({ path, kind }) => fs.create(path, kind),
      fsRename: ({ from, to }) => fs.rename(from, to),
      fsRemove: ({ path }) => fs.remove(path),

      loadSettings: () => loadSettingsFile(),
      saveSettings: async ({ values }) => {
        await saveSettingsFile(values);
      },
    },
    messages: {},
  },
});

const mainWindow = new BrowserWindow({
  title: BRAND.name,
  url: "views://mainview/index.html",
  rpc,
  // Nishi draws its own titlebar (see D5 in PLAN.MD), so suppress the native
  // one and let the chrome's drag region take over.
  titleBarStyle: "hidden",
  frame: {
    width: 1280,
    height: 820,
    x: 120,
    y: 90,
  },
});

console.log(`${BRAND.name} ${BRAND.version} "${BRAND.codename}" — Electrobun shell up`);
console.log(`workspace: ${fs.root}`);
