// How connector tools reach the network: through the tenant's Vault, whose egress module is the only
// path that resolves a `cred://` reference. A tool holds a reference, never a value.
import { type EgressContext, type EgressResult, HOST_REFUSALS } from "../egress/module.ts";
import type { EgressFailure, OutboundRequest } from "../egress/policy.ts";

export interface VaultEgress {
  egress(req: OutboundRequest, ctx: EgressContext): Promise<EgressResult>;
}

/** Egress for one person; `purpose` names the tool so the audit row says what asked. */
export type Egress = (req: OutboundRequest, purpose: string) => Promise<EgressResult>;

export function egressFor(vault: VaultEgress, person: string): Egress {
  return (req, purpose) => vault.egress(req, { person, purpose });
}

/** A keyed call refused for its host, as the refusal's own facts: the host, the key's reference and its label (F59). */
export interface HostRefusal {
  code: string;
  host: string;
  ref: string;
  label?: string;
}

/** The error a tool throws for an egress refusal: "CODE: reason", carrying a keyed host refusal's facts for the gate (F59). */
export class EgressRefusedError extends Error {
  readonly hostRefusal: HostRefusal | null;
  constructor(r: EgressFailure) {
    super(`${r.code}: ${r.reason}`);
    this.hostRefusal = HOST_REFUSALS.has(r.code) && r.ref && r.host ? { code: r.code, host: r.host, ref: r.ref, ...(r.label ? { label: r.label } : {}) } : null;
  }
}

/**
 * The sentence code says when a keyed call is refused for its host (F59, B-P9-05, Q50): from the refusal's own facts,
 * never the model's words. The key is named by its label, else by its reference's name.
 */
export function hostRefusalWords(r: HostRefusal): string {
  const name = r.label?.trim() || r.ref.replace(/^cred:\/\//, "");
  const key = /\bkey$/i.test(name) ? name : `${name} key`;
  return `Your ${key} is not bound to ${r.host}, so nothing was sent there; only you can bind it.`;
}

/** GETs JSON through egress; a refusal or a non-2xx answer is an error carrying its code. */
export async function getJson(egress: Egress, purpose: string, url: string, headers: Array<[string, string]> = []): Promise<unknown> {
  const r = await egress({ url, method: "GET", headers: [["accept", "application/json"], ...headers] }, purpose);
  if (!r.ok) throw new EgressRefusedError(r);
  if (r.status < 200 || r.status > 299) throw new Error(`CONNECTOR_HTTP_${r.status}: ${r.body.slice(0, 300)}`);
  try {
    return JSON.parse(r.body);
  } catch {
    throw new Error("CONNECTOR_BAD_JSON: the answer was not JSON");
  }
}
