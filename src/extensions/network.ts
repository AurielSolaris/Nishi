/**
 * Network abstraction for extensions. STUB — Stage 4.
 *
 * Extensions do not get raw sockets, DNS identity, or local network
 * information. They get a request function that Nishi may proxy, filter, or
 * answer synthetically. Identity protection is the default, not an option.
 */

import type { PermissionSet } from "./permissions.ts";

export type NetRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type NetResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** False when Nishi answered without touching the network. */
  real: boolean;
};

export interface Network {
  request(input: NetRequest): Promise<NetResponse>;
}

export function createNetwork(_permissions: PermissionSet): Network {
  throw new Error("Nishi network abstraction is not implemented yet (Stage 4). See EXTRAS.md.");
}
