/**
 * Nishi dev host.
 *
 * Serves the editor UI and exposes the filesystem + settings API that
 * src/core/platform.ts talks to. Bun's HTML import bundles index.ts and (via
 * scripts/sass-plugin.ts) the SCSS on demand, with hot reload.
 *
 * The desktop shell (src/bun/index.ts) is the real host; this one exists so the
 * UI can be developed with hot reload. Both drive the same FsService over the
 * same VFS, so an endpoint here is a transport for a shared implementation
 * rather than a second one.
 *
 * Bound to 127.0.0.1: this exposes read/write access to the mounted folder, so
 * it must not be reachable from the network. The VFS confines requests to the
 * mount, which is a much stronger guarantee than the old string-prefix check —
 * but "confined to one folder" is still not "safe to expose".
 */

import index from "../src/mainview/index.html";
import { BRAND } from "../src/core/branding.ts";
import type { VfsPath } from "../src/core/vfs-path.ts";
import { FsService, loadSettingsFile, saveSettingsFile } from "../src/host/fs-service.ts";
import { VfsError } from "../src/host/vfs.ts";
import { FsWatcher, type FsChange } from "../src/host/watcher.ts";
import { Journal, recover } from "../src/host/journal.ts";
import type { JournalEntry } from "../src/core/host-rpc.ts";
import { WORKSPACE_MOUNT } from "../src/core/vfs-path.ts";
import { file } from "bun";

const PORT = Number(Bun.env["NISHI_DEV_PORT"] ?? 4373);

const fs = FsService.withWorkspace(Bun.env["NISHI_ROOT"] ?? process.cwd());
const watcher = new FsWatcher(fs.vfs);
watcher.watchMount(WORKSPACE_MOUNT);
const journal = new Journal();

// ------------------------------------------------------- event streaming ----

/**
 * Open SSE connections. A stream is added on connect and dropped when its
 * controller throws, which is how a closed tab announces itself — there is no
 * reliable close callback for an aborted response body.
 */
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
const encoder = new TextEncoder();

watcher.onChange((changes: FsChange[]) => {
  const frame = encoder.encode(`event: fs\ndata: ${JSON.stringify(changes)}\n\n`);
  for (const controller of [...streams]) {
    try {
      controller.enqueue(frame);
    } catch {
      streams.delete(controller);
    }
  }
});

/**
 * Turn a thrown error into a JSON body with an HTTP status.
 *
 * The status comes from `VfsError.code`, not from matching on the message. The
 * previous version tested the prose with a regex, so rewording a refusal
 * silently reclassified it from 403 to 400.
 */
const STATUS: Record<string, number> = {
  malformed: 400,
  "no-such-mount": 404,
  escape: 403,
  denied: 403,
  "not-found": 404,
  "not-a-directory": 400,
};

async function guard<T>(work: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (error) {
    if (error instanceof VfsError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: STATUS[error.code] ?? 400 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = /ENOENT|no such file/i.test(message) ? 404 : 400;
    return Response.json({ error: message, code: "unknown" }, { status });
  }
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

/** Read a `path` query parameter as a VfsPath. The VFS validates it downstream. */
function pathParam(req: Request): VfsPath | undefined {
  const raw = new URL(req.url).searchParams.get("path");
  return raw === null || raw === "" ? undefined : (raw as VfsPath);
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  development: true,
  // Reading and writing large files should not race a default timeout.
  idleTimeout: 60,

  routes: {
    // The editor UI, bundled by Bun.
    "/*": index,

    "/api/host": () =>
      Response.json({
        kind: "browser",
        runtime: `Bun ${Bun.version}`,
        platform: `${process.platform}-${process.arch}`,
        version: BRAND.version,
        watching: !watcher.degraded,
      }),

    /** Filesystem changes, pushed. One stream per view. */
    "/api/events": () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.add(controller);
            // A first comment frame makes EventSource report `open` immediately
            // rather than waiting for the first real change.
            controller.enqueue(encoder.encode(": nishi\n\n"));
          },
          cancel(this: void) {
            // Bun calls this on disconnect for streams it can observe; the
            // enqueue-failure path above covers the ones it cannot.
          },
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        },
      ),

    "/api/fs/workspace": {
      GET: () => Response.json(fs.workspace),
      POST: async (req) => {
        const { path } = await body<{ path: string }>(req);
        return guard(async () => {
          const info = await fs.openFolder(path);
          // Follow the mount: the old watch points at a folder nobody is looking
          // at any more.
          watcher.watchMount(WORKSPACE_MOUNT);
          return info;
        });
      },
    },

    "/api/fs/list": (req) => guard(() => fs.list(pathParam(req))),

    "/api/fs/read": (req) =>
      guard(async () => {
        const path = pathParam(req);
        if (!path) throw new VfsError("malformed", "path is required");
        return fs.read(path);
      }),

    "/api/fs/write": {
      POST: async (req) => {
        const { path, content } = await body<{ path: VfsPath; content: string }>(req);
        return guard(async () => {
          // Mute before writing: the event can land before the promise resolves.
          watcher.mute(path);
          return fs.write(path, content);
        });
      },
    },

    "/api/fs/create": {
      POST: async (req) => {
        const { path, kind } = await body<{ path: VfsPath; kind: "file" | "directory" }>(req);
        return guard(() => fs.create(path, kind));
      },
    },

    "/api/fs/rename": {
      POST: async (req) => {
        const { from, to } = await body<{ from: VfsPath; to: VfsPath }>(req);
        return guard(() => fs.rename(from, to));
      },
    },

    "/api/fs/remove": {
      POST: async (req) => {
        const { path } = await body<{ path: VfsPath }>(req);
        return guard(async () => {
          await fs.remove(path);
          return { ok: true };
        });
      },
    },

    /**
     * The dirty-buffer journal.
     *
     * `recover` is a distinct route rather than a GET on the collection because
     * it is not a plain listing: it stats each entry's file to work out whether
     * the world moved under those edits.
     */
    "/api/journal/recover": () =>
      guard(() =>
        recover(journal, async (path) => {
          try {
            return (await fs.vfs.toReal(path, "read")).real;
          } catch {
            return null;
          }
        }),
      ),

    "/api/journal": {
      POST: async (req) => {
        const entry = await body<JournalEntry>(req);
        return guard(async () => {
          await journal.put(entry);
          return { ok: true };
        });
      },
    },

    "/api/journal/:key": {
      GET: (req) => guard(() => journal.get(req.params.key)),
      DELETE: (req) =>
        guard(async () => {
          await journal.drop(req.params.key);
          return { ok: true };
        }),
    },

    "/api/settings": {
      GET: () => guard(() => loadSettingsFile()),
      POST: async (req) => {
        const values = await body<Record<string, unknown>>(req);
        return guard(async () => {
          await saveSettingsFile(values);
          return { ok: true };
        });
      },
    },

    /** Brand assets (icon, and whatever Stage 3 theming adds). */
    "/assets/:name": async (req) => {
      const name = req.params.name;
      // Reject traversal: only a bare filename out of assets/ is servable.
      if (name.includes("/") || name.includes("\\") || name.includes("..")) {
        return new Response("Not found", { status: 404 });
      }
      const asset = file(`assets/${name}`);
      return (await asset.exists())
        ? new Response(asset)
        : new Response("Not found", { status: 404 });
    },
  },
});

const workspace = fs.workspace;

console.log(`\n  ${BRAND.name} ${BRAND.version} "${BRAND.codename}" — dev host`);
console.log(`  ${BRAND.tagline}\n`);
console.log(`  → ${server.url}`);
console.log(`  Bun ${Bun.version} · ${process.platform}-${process.arch}`);
console.log(`  workspace: ${workspace.displayPath}  (${workspace.uri})`);
console.log(`  watching: ${watcher.degraded ? "unavailable — use Refresh" : "on"}\n`);
console.log("  Filesystem access is bound to 127.0.0.1 and confined to the");
console.log("  workspace mount above. Ctrl+C to stop.\n");
