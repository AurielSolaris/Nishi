/**
 * Remove generated build output.
 *
 * `build/` is the packaged desktop app, `.build/` the generated view assets
 * (compiled stylesheet + rewritten HTML). Both are reproducible; neither is
 * committed.
 *
 * Exists mostly for one failure mode: Hutch refuses to rebuild while the app is
 * running (`FileBusy`) and can leave `build/` half-wiped, after which `run`
 * reports `BuiltMainNotFound`. Clearing both directories fixes it — but only
 * once the app is actually closed, which is what the locked-file message says.
 */

import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const TARGETS = ["build", ".build"];

let removed = 0;

for (const dir of TARGETS) {
  if (!existsSync(dir)) continue;

  try {
    await rm(dir, { recursive: true, force: true });
    console.log(`clean: removed ${dir}/`);
    removed++;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY") {
      console.error(
        `clean: ${dir}/ is in use — close the Nishi desktop window and try again.`,
      );
      process.exit(1);
    }
    throw error;
  }
}

if (removed === 0) console.log("clean: nothing to remove");
