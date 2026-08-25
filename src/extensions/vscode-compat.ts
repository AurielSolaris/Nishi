/**
 * VS Code compatibility layer. STUB — Stage 4.
 *
 * Maps the `vscode` module's shape onto NishiApi so existing extensions load
 * unmodified. Nishi does not reimplement VS Code internally — this is a
 * translation layer, and it translates *into the sandbox*, never around it:
 *
 *     VS Code Extension API -> Nishi Compatibility Layer -> Nishi Sandbox Runtime
 *
 * Where a VS Code API has no safe equivalent (raw `child_process`, absolute
 * `Uri.file` paths outside the workspace), the shim resolves to a virtualized
 * or refusing implementation rather than being omitted — an extension that
 * probes for the API still finds it, and still cannot escape.
 */

import type { NishiApi } from "./api.ts";

/** The subset of the `vscode` namespace targeted first. */
export type VscodeShim = {
  commands: { registerCommand(id: string, fn: (...a: unknown[]) => unknown): { dispose(): void } };
  window: { showInformationMessage(m: string): void; showErrorMessage(m: string): void };
  workspace: { workspaceFolders: { name: string }[] | undefined };
  Uri: { file(path: string): { scheme: string; path: string } };
};

export function createVscodeShim(_api: NishiApi): VscodeShim {
  throw new Error("VS Code compatibility layer is not implemented yet (Stage 4). See EXTRAS.md.");
}
