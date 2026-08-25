/**
 * Environment virtualization for extensions. STUB — Stage 4.
 *
 * Extensions receive the *Nishi* environment, not the machine's: no real
 * username, hostname, OS layout or process environment variables. Values here
 * are stable and synthetic so extensions can branch on them without those
 * branches leaking anything about the user.
 */

import type { PermissionSet } from "./permissions.ts";

export type NishiEnvironment = {
  /** Always "nishi" — extensions branch on the editor, not the host OS. */
  editor: "nishi";
  editorVersion: string;
  /** Coarse platform class, never a build or kernel string. */
  platform: "windows" | "macos" | "linux";
  /** Synthetic, stable per install; never the real account name. */
  user: string;
  /** Workspace-relative, never absolute. */
  workspaceName: string;
  locale: string;
};

export interface EnvironmentProvider {
  get(): NishiEnvironment;
  /** Env vars an extension explicitly declared and the user allowed. */
  variable(name: string): string | undefined;
}

export function createEnvironment(_permissions: PermissionSet): EnvironmentProvider {
  throw new Error("Nishi environment virtualization is not implemented yet (Stage 4). See EXTRAS.md.");
}
