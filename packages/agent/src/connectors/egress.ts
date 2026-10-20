// How connector tools reach the network: through the tenant's Vault, whose egress module is the only
// path that resolves a `cred://` reference. A tool holds a reference, never a value.
import type { EgressContext, EgressResult } from "../egress/module.ts";
import type { OutboundRequest } from "../egress/policy.ts";

export interface VaultEgress {
  egress(req: OutboundRequest, ctx: EgressContext): Promise<EgressResult>;
}

/** Egress for one person; `purpose` names the tool so the audit row says what asked. */
export type Egress = (req: OutboundRequest, purpose: string) => Promise<EgressResult>;

export function egressFor(vault: VaultEgress, person: string): Egress {
  return (req, purpose) => vault.egress(req, { person, purpose });
}

/** GETs JSON through egress; a refusal or a non-2xx answer is an error carrying its code. */
export async function getJson(egress: Egress, purpose: string, url: string, headers: Array<[string, string]> = []): Promise<unknown> {
  const r = await egress({ url, method: "GET", headers: [["accept", "application/json"], ...headers] }, purpose);
  if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
  if (r.status < 200 || r.status > 299) throw new Error(`CONNECTOR_HTTP_${r.status}: ${r.body.slice(0, 300)}`);
  try {
    return JSON.parse(r.body);
  } catch {
    throw new Error("CONNECTOR_BAD_JSON: the answer was not JSON");
  }
}
