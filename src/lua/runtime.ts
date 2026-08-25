/**
 * Lua configuration runtime. STUB — Stage 7.
 *
 * For users coming from Vim/Neovim, Nishi reads two files from the user's
 * config folder (EXTRAS.md, "Lua support"):
 *
 *   config.lua   themes, preferences, UI, keybindings
 *   main.lua     commands, automation, editor scripting, workflows
 *
 * Lua scripts go through Nishi APIs, not the system. Same rule as extensions:
 * `config.lua` is evaluated against a restricted table with no io/os/package,
 * and `main.lua` gets the scripting surface but still no ambient authority.
 *
 * Engine is undecided — a WASM Lua build keeps the sandbox story simple and
 * avoids a native dependency per platform, which matters given Electrobun
 * already ships per-platform binaries.
 */

import type { SettingsValues } from "../core/settings.ts";

export type LuaConfigResult = {
  /** Settings the config file asked for, already coerced by the schema. */
  settings: SettingsValues;
  /** Keybindings as "ctrl+k ctrl+b" -> command id. */
  keymap: Record<string, string>;
  /** Diagnostics rather than throws: a bad config must not block startup. */
  problems: { file: string; line?: number; message: string }[];
};

export interface LuaRuntime {
  /** Evaluate config.lua in a restricted scope. Never throws; reports problems. */
  loadConfig(source: string): Promise<LuaConfigResult>;
  /** Evaluate main.lua with the scripting surface bound. */
  loadMain(source: string): Promise<{ problems: LuaConfigResult["problems"] }>;
  dispose(): void;
}

export function createLuaRuntime(): LuaRuntime {
  throw new Error("Lua runtime is not implemented yet (Stage 7). See EXTRAS.md.");
}
