/**
 * The host contract — every type that crosses the seam, in one place.
 *
 * The view (src/core/platform.ts), the desktop shell (src/bun/index.ts) and the
 * filesystem service (src/host/fs-service.ts) all speak these shapes. Declaring
 * them here rather than three times is not only tidier: Stage 2 added a
 * host-initiated message, and a message declared on one side and not the other
 * fails at runtime rather than at compile time. One definition means the
 * compiler checks both ends against the same thing.
 *
 * No node imports: this file is bundled into the view. The RPCSchema type comes
 * from the view SDK and is erased at build time, so importing it here does not
 * pull desktop code into the browser bundle.
 */

import type { RPCSchema } from "electrobun/view";
import type { VfsPath } from "./vfs-path.ts";

export type HostKind = "electrobun" | "browser";

export type HostInfo = {
  kind: HostKind;
  /** Human-readable runtime label, e.g. "Bun 1.3.14". */
  runtime: string;
  platform: string;
  version: string;
  /** False when the host could not start a file watcher; the UI says so. */
  watching: boolean;
};

export type WindowAction = "minimize" | "maximize" | "close";

export type EntryKind = "file" | "directory";

export type DirEntry = {
  name: string;
  path: VfsPath;
  kind: EntryKind;
  size: number;
  /** Reached through a symbolic link that still resolves inside the mount. */
  link: boolean;
};

export type FileContent = {
  path: VfsPath;
  name: string;
  content: string;
  /** True when the file looked binary and was not decoded. */
  binary: boolean;
  size: number;
  /** Modification time, so a change event can be told from our own echo. */
  modifiedMs: number;
};

export type WriteResult = { path: VfsPath; size: number; modifiedMs: number };

/**
 * What the view knows about the open folder.
 *
 * There is deliberately no absolute path here. `displayPath` has the user's home
 * directory elided and exists for the titlebar and the folder prompt; if you
 * find yourself wanting the real path in the view, the operation belongs on the
 * host instead.
 */
export type WorkspaceInfo = {
  uri: VfsPath;
  label: string;
  displayPath: string;
};

/**
 * A document's unsaved content, as the journal stores it.
 *
 * Mirrors src/host/journal.ts. Declared here because it crosses the seam: the
 * view owns the buffer, the host owns the disk.
 */
export type JournalEntry = {
  key: string;
  path: VfsPath | null;
  name: string;
  content: string;
  journalledAt: number;
  baseModifiedMs: number;
};

export type RecoveredEntry = JournalEntry & {
  fileChangedSince: boolean;
  fileMissing: boolean;
};

/** Options for a native confirmation box. */
export type ConfirmOptions = {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders as a warning; the cancel button is the default. */
  danger?: boolean;
};

export type FsChangeType = "changed" | "removed";

export type FsChange = {
  uri: VfsPath;
  type: FsChangeType;
  kind: "file" | "directory" | "unknown";
};

/**
 * The Electrobun RPC schema, both directions.
 *
 * `bun.requests` are calls the view makes. `webview.messages` are the ones the
 * host makes on its own — which before Stage 2 was an empty set, because the
 * host had nothing to say until it started watching files.
 */
export type NishiRPC = {
  bun: RPCSchema<{
    requests: {
      hostInfo: { params: Record<string, never>; response: HostInfo };
      windowAction: { params: { action: WindowAction }; response: boolean };
      setTitle: { params: { title: string }; response: void };

      fsWorkspace: { params: Record<string, never>; response: WorkspaceInfo };
      /** PRIVILEGED — takes a real path. See FsService.openFolder. */
      fsOpenFolder: { params: { path: string }; response: WorkspaceInfo };
      fsList: { params: { path?: VfsPath }; response: { path: VfsPath; entries: DirEntry[] } };
      fsRead: { params: { path: VfsPath }; response: FileContent };
      fsWrite: { params: { path: VfsPath; content: string }; response: WriteResult };
      fsCreate: { params: { path: VfsPath; kind: EntryKind }; response: { path: VfsPath } };
      fsRename: { params: { from: VfsPath; to: VfsPath }; response: { path: VfsPath } };
      fsRemove: { params: { path: VfsPath }; response: void };

      journalPut: { params: { entry: JournalEntry }; response: void };
      journalDrop: { params: { key: string }; response: void };
      journalGet: { params: { key: string }; response: JournalEntry | null };
      journalRecover: { params: Record<string, never>; response: RecoveredEntry[] };

      /** PRIVILEGED — a native picker returning a real path, or null if cancelled. */
      dialogOpenFolder: { params: { startingFolder?: string }; response: string | null };
      dialogConfirm: { params: { options: ConfirmOptions }; response: boolean };

      loadSettings: { params: Record<string, never>; response: Record<string, unknown> };
      saveSettings: { params: { values: Record<string, unknown> }; response: void };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      fsChanges: { changes: FsChange[] };
    };
  }>;
};
