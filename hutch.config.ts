/**
 * Hutch toolchain configuration.
 *
 * Electrobun 2.x builds through Hutch, which resolves the runtime + SDK for the
 * pinned version and projects the SDK into .hutch/devkit. Dependencies are
 * managed by Bun (bun.lock), not Hutch, so no install script is declared here.
 *
 * These mirror the package.json scripts; prefer `bun run desktop*` in day-to-day
 * use, since those resolve the Hutch binary even when PATH has not caught up
 * (see scripts/hutch.ts).
 */

export default {
  scripts: {
    start: ["hutch", "electrobun", "dev"],
    dev: ["hutch", "electrobun", "dev", "--watch"],
    prepare: ["hutch", "electrobun", "prepare"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
    "build:dev": ["hutch", "electrobun", "build", "--env=dev"],
    "build:canary": ["hutch", "electrobun", "build", "--env=canary"],
  },
  electrobun: {
    version: "2.0.1",
  },
};
