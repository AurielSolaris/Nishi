/**
 * Capability model for extensions. STUB — Stage 4.
 *
 * The rule this file exists to encode (EXTRAS.md, "Extension security model"):
 * the abstraction layer is present regardless of permission status. A
 * permission decides whether a capability *maps to a real resource*, never
 * whether the extension talks to an abstraction at all. Code that checks a
 * permission in order to hand back a raw resource has broken the model.
 */

/** Everything an extension can ask for. Deny is always representable. */
export type Capability =
  | "fs.read"
  | "fs.write"
  | "fs.watch"
  | "net.fetch"
  | "net.listen"
  | "env.read"
  | "process.spawn"
  | "clipboard.read"
  | "clipboard.write"
  | "workspace.edit"
  | "commands.register";

export type Decision =
  /** Maps to the real resource. */
  | { kind: "allow" }
  /** Maps to a plausible but synthetic resource — the extension still works. */
  | { kind: "virtualize"; reason: string }
  /** Maps to an abstraction that always refuses. */
  | { kind: "deny"; reason: string };

export type Grant = {
  capability: Capability;
  decision: Decision;
  /** Optional scope, e.g. path prefixes for fs.* or hosts for net.*. */
  scope?: string[];
};

/**
 * Nishi's default posture: nothing real unless the user said so. Virtualize
 * rather than deny where a synthetic answer keeps an extension functional —
 * "security should be invisible" means the extension should not crash, it
 * should simply never see the machine.
 */
export const DEFAULT_DECISION: Decision = {
  kind: "virtualize",
  reason: "No grant recorded; default posture is virtualize, never passthrough.",
};

export interface PermissionSet {
  decide(capability: Capability, scope?: string): Decision;
}

/** Placeholder resolver. Stage 4 replaces this with the manifest-driven set. */
export function createPermissionSet(_grants: Grant[] = []): PermissionSet {
  return {
    decide(): Decision {
      // Deliberately ignores grants for now: a permission system that half
      // works would invite code that trusts it.
      return DEFAULT_DECISION;
    },
  };
}
