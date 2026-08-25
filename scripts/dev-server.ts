/**
 * Nishi dev host.
 *
 * Serves the editor UI and exposes the filesystem + settings API that
 * src/core/platform.ts talks to, while the Electrobun desktop shell is still
 * being wired (see PLAN.MD, Stage 0). Bun's HTML import bundles index.ts and
 * (via scripts/sass-plugin.ts) the SCSS on demand, with hot reload.
 *
 * Bound to 127.0.0.1: this exposes read/write access to the workspace folder,
 * so it must not be reachable from the network.
 */

import index from "../src/mainview/index.html";
import { BRAND } from "../src/core/branding.ts";
import { FsService, loadSettingsFile, saveSettingsFile } from "../src/host/fs-service.ts";
import { file } from "bun";

const PORT = Number(Bun.env["NISHI_DEV_PORT"] ?? 4373);

const fs = new FsService(Bun.env["NISHI_ROOT"] ?? process.cwd());

/** Turn a thrown error into a JSON error body instead of a 500 page. */
async function guard<T>(work: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /escapes the workspace root|Refusing/.test(message)
      ? 403
      : /ENOENT|no such file/i.test(message)
        ? 404
        : 400;
    return Response.json({ error: message }, { status });
  }
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
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
      }),

    "/api/fs/root": {
      GET: () => Response.json({ root: fs.root }),
      POST: async (req) => {
        const { path } = await body<{ path: string }>(req);
        return guard(async () => ({ root: await fs.setRoot(path) }));
      },
    },

    "/api/fs/list": (req) => {
      const path = new URL(req.url).searchParams.get("path") ?? undefined;
      return guard(() => fs.list(path));
    },

    "/api/fs/read": (req) => {
      const path = new URL(req.url).searchParams.get("path");
      return guard(async () => {
        if (!path) throw new Error("path is required");
        return fs.read(path);
      });
    },

    "/api/fs/write": {
      POST: async (req) => {
        const { path, content } = await body<{ path: string; content: string }>(req);
        return guard(() => fs.write(path, content));
      },
    },

    "/api/fs/create": {
      POST: async (req) => {
        const { path, kind } = await body<{ path: string; kind: "file" | "directory" }>(req);
        return guard(() => fs.create(path, kind));
      },
    },

    "/api/fs/rename": {
      POST: async (req) => {
        const { from, to } = await body<{ from: string; to: string }>(req);
        return guard(() => fs.rename(from, to));
      },
    },

    "/api/fs/remove": {
      POST: async (req) => {
        const { path } = await body<{ path: string }>(req);
        return guard(async () => {
          await fs.remove(path);
          return { ok: true };
        });
      },
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

console.log(`\n  ${BRAND.name} ${BRAND.version} "${BRAND.codename}" — dev host`);
console.log(`  ${BRAND.tagline}\n`);
console.log(`  → ${server.url}`);
console.log(`  Bun ${Bun.version} · ${process.platform}-${process.arch}`);
console.log(`  workspace: ${fs.root}\n`);
console.log("  Filesystem access is bound to 127.0.0.1 and confined to the");
console.log("  workspace folder above. Ctrl+C to stop.\n");
