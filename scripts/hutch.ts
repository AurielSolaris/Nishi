/**
 * Hutch launcher.
 *
 * Electrobun 2.x builds through the Hutch toolchain. Hutch installs itself to
 * ~/.hutch/bin and adds that to the user PATH — but a shell opened *before* the
 * install will not see it, which makes `hutch: command not found` the first
 * thing a new contributor hits. This resolves the binary directly when PATH has
 * not caught up, and says exactly what to do when it is genuinely absent.
 *
 * Usage: bun run scripts/hutch.ts <args...>
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const INSTALL_HINT = `
Hutch is not installed. Nishi's desktop build needs it.

  npx electrobun init --help    # bootstraps Hutch into ~/.hutch/bin
  bun run desktop:prepare       # projects the Electrobun SDK

Then open a new terminal so PATH picks up ~/.hutch/bin.
`;

function resolveHutch(): string | null {
  // A local install beats PATH: it is the one the project pinned against.
  const local = join(homedir(), ".hutch", "bin", process.platform === "win32" ? "hutch.exe" : "hutch");
  if (existsSync(local)) return local;

  // Fall back to PATH — covers system-wide installs.
  return Bun.which("hutch");
}

const hutch = resolveHutch();
if (!hutch) {
  console.error(INSTALL_HINT);
  process.exit(1);
}

const args = Bun.argv.slice(2);
if (args.length === 0) {
  console.error("scripts/hutch.ts: expected arguments, e.g. `electrobun build --env=dev`");
  process.exit(1);
}

const proc = Bun.spawn([hutch, ...args], {
  stdio: ["inherit", "inherit", "inherit"],
  cwd: process.cwd(),
});

process.exit(await proc.exited);
