/**
 * The Nishi Extension API — the only surface an extension ever sees.
 * STUB — Stage 4.
 *
 * Every member here is an abstraction over something the extension cannot
 * reach directly (EXTRAS.md, "Extension security model"). Built-in extensions
 * get this same object: first-class does not mean unrestricted.
 */

import type { EnvironmentProvider } from "./environment.ts";
import type { Network } from "./network.ts";
import type { PermissionSet } from "./permissions.ts";
import type { Vfs } from "./vfs.ts";

export type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  /** Capabilities the extension asks for; the user decides what is granted. */
  capabilities?: string[];
  /** Activation events, VSCode-compatible in shape. */
  activationEvents?: string[];
  main?: string;
};

export type Disposable = { dispose(): void };

export interface CommandsApi {
  register(id: string, handler: (...args: unknown[]) => unknown): Disposable;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
}

export interface WorkspaceApi {
  readonly fs: Vfs;
  /** Text of the active document, if the extension may see it. */
  activeText(): Promise<string | null>;
  onDidChange(listener: () => void): Disposable;
}

export interface WindowApi {
  showMessage(message: string): void;
  showError(message: string): void;
}

export interface NishiApi {
  readonly manifest: ExtensionManifest;
  readonly permissions: PermissionSet;
  readonly env: EnvironmentProvider;
  readonly net: Network;
  readonly commands: CommandsApi;
  readonly workspace: WorkspaceApi;
  readonly window: WindowApi;
}

export function createApi(_manifest: ExtensionManifest, _permissions: PermissionSet): NishiApi {
  throw new Error("Nishi Extension API is not implemented yet (Stage 4). See EXTRAS.md.");
}
