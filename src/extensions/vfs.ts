/**
 * Virtual filesystem for extensions. STUB — Stage 4.
 *
 * Extensions never receive a real path. They address files through VFS handles
 * scoped to the workspace, so user home paths, OS layout and hidden system data
 * are not merely forbidden — they are not expressible.
 *
 * The host-side implementation will delegate to src/host/fs-service.ts, which
 * already enforces workspace-root confinement for the editor itself.
 */

import type { PermissionSet } from "./permissions.ts";

/** An opaque reference. Deliberately not a path string. */
export type VfsHandle = { readonly __vfs: unique symbol } & string;

export type VfsStat = {
  name: string;
  kind: "file" | "directory";
  size: number;
  /** Whether this entry is backed by a real file or a virtualized response. */
  real: boolean;
};

export interface Vfs {
  /** Resolve a workspace-relative path to a handle, or null if out of scope. */
  resolve(relativePath: string): VfsHandle | null;
  stat(handle: VfsHandle): Promise<VfsStat>;
  read(handle: VfsHandle): Promise<string>;
  write(handle: VfsHandle, content: string): Promise<void>;
  list(handle: VfsHandle): Promise<VfsStat[]>;
}

export function createVfs(_permissions: PermissionSet, _workspaceRoot: string): Vfs {
  throw new Error("Nishi VFS is not implemented yet (Stage 4). See EXTRAS.md.");
}
