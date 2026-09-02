/**
 * Electrobun main process — the Nishi desktop shell.
 *
 * The desktop counterpart of scripts/dev-server.ts. Both expose the same
 * operations to the UI; only the transport differs (RPC here, HTTP there), and
 * both delegate to the same FsService over the same VFS, so behaviour cannot
 * drift between them.
 *
 * This process is the trusted side of the boundary: it is the only place that
 * holds real paths, and the only place that can mount one. The webview receives
 * `nishi://` paths and nothing else.
 *
 * Run with:
 *   hutch electrobun dev --watch
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { BrowserView, BrowserWindow, Utils } from "electrobun/main";
import { BRAND } from "../core/branding.ts";
import type { HostInfo, NishiRPC } from "../core/host-rpc.ts";
import { WORKSPACE_MOUNT } from "../core/vfs-path.ts";
import { FsService, loadSettingsFile, saveSettingsFile } from "../host/fs-service.ts";
import { FsWatcher } from "../host/watcher.ts";
import { Journal, recover } from "../host/journal.ts";

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

const fs = FsService.withWorkspace(await resolveInitialRoot());
const watcher = new FsWatcher(fs.vfs);
watcher.watchMount(WORKSPACE_MOUNT);
const journal = new Journal();

/**
 * Remember the open folder as a real path, host-side.
 *
 * The view used to persist this, which meant the view had to know the real
 * path. It does not any more, so the responsibility moves here — the setting is
 * host state that happens to be stored alongside user preferences.
 */
async function rememberFolder(realRoot: string): Promise<void> {
  const values = await loadSettingsFile();
  values["workbench.lastFolder"] = realRoot;
  await saveSettingsFile(values);
}

const rpc = BrowserView.defineRPC<NishiRPC>({
  maxRequestTime: 15_000,
  handlers: {
    requests: {
      hostInfo: (): HostInfo => ({
        kind: "electrobun",
        runtime: `Electrobun 2.0.1 · Bun ${Bun.version}`,
        platform: `${process.platform}-${process.arch}`,
        version: BRAND.version,
        watching: !watcher.degraded,
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

      fsWorkspace: () => fs.workspace,

      fsOpenFolder: async ({ path }) => {
        const info = await fs.openFolder(path);
        // Follow the mount, and remember it for next launch.
        watcher.watchMount(WORKSPACE_MOUNT);
        await rememberFolder(fs.vfs.workspace.realRoot);
        return info;
      },

      fsList: ({ path }) => fs.list(path),
      fsRead: ({ path }) => fs.read(path),
      fsWrite: ({ path, content }) => {
        // Mute before writing: the event can land before the promise resolves.
        watcher.mute(path);
        return fs.write(path, content);
      },
      fsCreate: ({ path, kind }) => fs.create(path, kind),
      fsRename: ({ from, to }) => fs.rename(from, to),
      fsRemove: ({ path }) => fs.remove(path),

      journalPut: ({ entry }) => journal.put(entry),
      journalDrop: ({ key }) => journal.drop(key),
      journalGet: ({ key }) => journal.get(key),
      journalRecover: () =>
        recover(journal, async (path) => {
          try {
            return (await fs.vfs.toReal(path, "read")).real;
          } catch {
            // Not in any current mount — the folder it belonged to is not open.
            return null;
          }
        }),

      dialogOpenFolder: async ({ startingFolder }) => {
        const chosen = await Utils.openFileDialog({
          startingFolder: startingFolder && startingFolder !== "" ? startingFolder : "~/",
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return chosen[0] ?? null;
      },

      dialogConfirm: async ({ options }) => {
        const confirmLabel = options.confirmLabel ?? "OK";
        const cancelLabel = options.cancelLabel ?? "Cancel";
        const { response } = await Utils.showMessageBox({
          type: options.danger ? "warning" : "question",
          title: options.title,
          message: options.message,
          detail: options.detail ?? "",
          buttons: [confirmLabel, cancelLabel],
          // A destructive prompt defaults to the safe answer, and Escape always
          // cancels — losing work should take a deliberate click, not a stray
          // press of Enter.
          defaultId: options.danger ? 1 : 0,
          cancelId: 1,
        });
        return response === 0;
      },

      loadSettings: () => loadSettingsFile(),
      saveSettings: async ({ values }) => {
        await saveSettingsFile(values);
      },
    },
    messages: {},
  },
});

watcher.onChange((changes) => {
  rpc.send.fsChanges({ changes });
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

const workspace = fs.workspace;

console.log(`${BRAND.name} ${BRAND.version} "${BRAND.codename}" — Electrobun shell up`);
console.log(`workspace: ${workspace.displayPath}  (${workspace.uri})`);
console.log(`watching: ${watcher.degraded ? "unavailable — use Refresh" : "on"}`);
