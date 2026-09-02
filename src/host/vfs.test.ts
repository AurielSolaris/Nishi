/**
 * VFS boundary tests.
 *
 * These run against a real temporary directory rather than a mocked filesystem,
 * because the escapes that matter — symlinks, canonicalization, a mount root
 * that is itself a link — are precisely the behaviour a mock would define away.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatVfsPath, mountRoot, type VfsPath } from "../core/vfs-path.ts";
import { FsService } from "./fs-service.ts";
import { Vfs, VfsError, displayRealPath } from "./vfs.ts";

let sandbox: string;
let workspace: string;
let outside: string;

beforeEach(async () => {
  // realpath: macOS hands back /var, which is a link to /private/var, and every
  // containment check here would otherwise be comparing two spellings.
  sandbox = await realpath(await mkdtemp(join(tmpdir(), "nishi-vfs-")));
  workspace = join(sandbox, "workspace");
  outside = join(sandbox, "outside");
  await mkdir(join(workspace, "src"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(workspace, "src", "a.ts"), "inside\n", "utf8");
  await writeFile(join(outside, "secrets.txt"), "SECRET\n", "utf8");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const mounted = (capabilities: ("read" | "write" | "watch")[] = ["read", "write", "watch"]): Vfs => {
  const vfs = new Vfs();
  vfs.mount({ id: "workspace", realRoot: workspace, capabilities });
  return vfs;
};

const wsPath = (...segments: string[]): VfsPath => formatVfsPath("workspace", segments);

describe("mapping", () => {
  test("maps a path inside the mount to a real path", async () => {
    const { real } = await mounted().toReal(wsPath("src", "a.ts"), "read");
    expect(real).toBe(join(workspace, "src", "a.ts"));
  });

  test("maps the mount root", async () => {
    const { real } = await mounted().toReal(mountRoot("workspace"), "read");
    expect(real).toBe(workspace);
  });

  test("refuses an unknown mount", async () => {
    const error = await mounted()
      .toReal(formatVfsPath("nowhere", ["a.ts"]), "read")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VfsError);
    expect((error as VfsError).code).toBe("no-such-mount");
  });

  test("refuses a malformed path", async () => {
    const error = await mounted().toReal("/etc/passwd", "read").catch((e: unknown) => e);
    expect((error as VfsError).code).toBe("malformed");
  });

  test("traversal is rejected at parse time, before touching disk", async () => {
    const error = await mounted()
      .toReal("nishi://workspace/../outside/secrets.txt", "read")
      .catch((e: unknown) => e);
    expect((error as VfsError).code).toBe("malformed");
  });
});

describe("capabilities", () => {
  test("a read-only mount refuses a write mapping", async () => {
    const error = await mounted(["read"])
      .toReal(wsPath("src", "a.ts"), "write")
      .catch((e: unknown) => e);
    expect((error as VfsError).code).toBe("denied");
  });

  test("a read-only mount still allows reads", async () => {
    const { real } = await mounted(["read"]).toReal(wsPath("src", "a.ts"), "read");
    expect(real).toBe(join(workspace, "src", "a.ts"));
  });

  test("a mount without watch refuses a watch mapping", async () => {
    const error = await mounted(["read", "write"])
      .toReal(wsPath("src", "a.ts"), "watch")
      .catch((e: unknown) => e);
    expect((error as VfsError).code).toBe("denied");
  });
});

describe("symlink containment", () => {
  /**
   * Symlink creation needs elevation or Developer Mode on Windows. A skipped
   * test says so rather than passing quietly, since this is the check that
   * separates a real boundary from a string-prefix comparison.
   */
  const linked = async (target: string, path: string, type: "dir" | "file"): Promise<boolean> => {
    try {
      await symlink(target, path, type === "dir" ? "junction" : "file");
      return true;
    } catch {
      return false;
    }
  };

  test("a directory link pointing out of the mount does not resolve", async () => {
    const link = join(workspace, "escape");
    if (!(await linked(outside, link, "dir"))) {
      console.warn("[skipped] symlink creation unavailable on this machine");
      return;
    }

    const vfs = mounted();
    const error = await vfs.toReal(wsPath("escape", "secrets.txt"), "read").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VfsError);
    expect((error as VfsError).code).toBe("escape");
  });

  test("a link that stays inside the mount still resolves", async () => {
    const link = join(workspace, "alias");
    if (!(await linked(join(workspace, "src"), link, "dir"))) return;

    const { real } = await mounted().toReal(wsPath("alias", "a.ts"), "read");
    expect(real).toBe(join(workspace, "src", "a.ts"));
  });

  test("the explorer omits an entry that escapes through a link", async () => {
    if (!(await linked(outside, join(workspace, "escape"), "dir"))) return;

    const service = new FsService(mounted());
    const { entries } = await service.list(mountRoot("workspace"));
    expect(entries.map((entry) => entry.name)).not.toContain("escape");
    expect(entries.map((entry) => entry.name)).toContain("src");
  });
});

describe("paths that do not exist yet", () => {
  test("maps a file about to be created", async () => {
    const { real } = await mounted().toReal(wsPath("src", "new.ts"), "write");
    expect(real).toBe(join(workspace, "src", "new.ts"));
  });

  test("maps through directories that do not exist yet", async () => {
    const { real } = await mounted().toReal(wsPath("a", "b", "c.ts"), "write");
    expect(real).toBe(join(workspace, "a", "b", "c.ts"));
  });

  test("a new file under an escaping link is still refused", async () => {
    try {
      await symlink(outside, join(workspace, "escape"), "junction");
    } catch {
      return;
    }
    const error = await mounted().toReal(wsPath("escape", "new.txt"), "write").catch((e: unknown) => e);
    expect((error as VfsError).code).toBe("escape");
  });
});

describe("reverse mapping", () => {
  test("turns a real path back into a VfsPath", () => {
    const vfs = mounted();
    expect(vfs.toVfs("workspace", join(workspace, "src", "a.ts"))).toBe(wsPath("src", "a.ts"));
    expect(vfs.toVfs("workspace", workspace)).toBe(mountRoot("workspace"));
  });

  test("returns null for a path outside the mount", () => {
    expect(mounted().toVfs("workspace", join(outside, "secrets.txt"))).toBeNull();
  });

  test("returns null for a real name that is not expressible", () => {
    // A sibling directory whose name would be a legal prefix but is not inside.
    expect(mounted().toVfs("workspace", `${workspace}-other`)).toBeNull();
  });
});

describe("remount", () => {
  test("points the mount at a different folder", async () => {
    const vfs = mounted();
    await vfs.remount("workspace", outside);
    const { real } = await vfs.toReal(wsPath("secrets.txt"), "read");
    expect(real).toBe(join(outside, "secrets.txt"));
  });

  test("keeps the mount's capabilities", async () => {
    const vfs = mounted(["read"]);
    await vfs.remount("workspace", outside);
    const error = await vfs.toReal(wsPath("secrets.txt"), "write").catch((e: unknown) => e);
    expect((error as VfsError).code).toBe("denied");
  });

  test("refuses a file or a missing folder", async () => {
    const vfs = mounted();
    const missing = await vfs.remount("workspace", join(sandbox, "nope")).catch((e: unknown) => e);
    expect((missing as VfsError).code).toBe("not-found");

    const notDir = await vfs
      .remount("workspace", join(outside, "secrets.txt"))
      .catch((e: unknown) => e);
    expect((notDir as VfsError).code).toBe("not-a-directory");
  });
});

describe("display paths", () => {
  test("elides the home directory", () => {
    const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
    if (home === "") return;
    expect(displayRealPath(join(home, "Code", "nishi"))).toBe("~/Code/nishi");
    expect(displayRealPath(home)).toBe("~");
  });

  test("leaves a path outside home alone but normalizes separators", () => {
    expect(displayRealPath(workspace).includes("\\")).toBe(false);
  });
});

describe("the service refuses to delete a mount root", () => {
  test("remove on the root is denied", async () => {
    const service = new FsService(mounted());
    const error = await service.remove(mountRoot("workspace")).catch((e: unknown) => e);
    expect((error as VfsError).code).toBe("denied");
  });
});
