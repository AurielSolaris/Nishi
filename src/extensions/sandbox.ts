/**
 * Extension sandbox. STUB — Stage 4.
 *
 * Runs extension code in an isolated host with no ambient authority: no
 * require/import of node builtins, no globalThis passthrough, no direct fs or
 * net. The extension's only channel is the NishiApi object handed to it.
 *
 * Isolation mechanism is still open. Candidates, in rough order of preference:
 *   1. A separate process per extension host, talking over the same RPC seam
 *      the editor already uses (src/core/platform.ts). Strongest boundary.
 *   2. A dedicated Worker with a scrubbed global scope. Cheaper, weaker.
 * Whichever wins, the API surface in api.ts does not change — that is the point
 * of defining it first.
 */

import type { ExtensionManifest, NishiApi } from "./api.ts";
import type { Grant } from "./permissions.ts";

export type SandboxOptions = {
  manifest: ExtensionManifest;
  grants: Grant[];
  /** Absolute path to the extension bundle, resolved by the host, not the guest. */
  entrypoint: string;
};

export interface SandboxedExtension {
  readonly id: string;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  /** True once the guest has been torn down and its channel closed. */
  readonly disposed: boolean;
}

export interface Sandbox {
  load(options: SandboxOptions): Promise<SandboxedExtension>;
  /** Tear down every guest; used on window close and on host reload. */
  shutdown(): Promise<void>;
}

export function createSandbox(_api: (options: SandboxOptions) => NishiApi): Sandbox {
  throw new Error("Nishi extension sandbox is not implemented yet (Stage 4). See EXTRAS.md.");
}
