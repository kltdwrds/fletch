// What the person reads of their connections (F36, P9 deltas 1, 5 and 6), over rows the Vault already keeps: a setup's
// state from its `vault_events` (`captured` is entered, `dismissed` is ended, neither is not entered yet: nothing is
// stored before the submit, so pending is the chat item's state, never a vault row); a credential's last use from its
// newest `egress_audit` row, with the provider's rejection of that use (a `rejected` event the egress writes on a 401
// or 403) as its outcome; and the audit rows of one reference, read-only, for its owner alone. No value is read here.
import type { AuditRow, EgressResult } from "../egress/module.ts";
import { PUBLIC_HOSTS } from "../egress/policy.ts";
import type { GrantInfo } from "./core.ts";
import type { CredentialGrant } from "./grants.ts";
import { checkHost } from "./hosts.ts";
import type { Row } from "./sealed.ts";

type Sql = (query: string, ...bindings: unknown[]) => Row[];

/**
 * What a disconnect leaves, as a fixed list (B-P9-09, P9 delta 6): the connection's page draws it under Disconnect and
 * the reply's line in `WORK_WORDS` names the same three things, never an inferred one.
 */
export const WHAT_REMAINS = "What stays: the audit rows of what it sent, the transcripts of the chats that used it, and whatever is at {host}, the provider.";

/** A setup id, as `credential_request` stamps each link: sixteen hex digits. */
export const SETUP = /^[0-9a-f]{16}$/;

export type CaptureState = { state: "pending" | "entered" | "dismissed"; at: number | null };

/**
 * A setup's state for its person: the newest `captured` event for the reference, or `dismissed` event for this setup,
 * decides. Each link `credential_request` gives carries its own setup id, so a dismissal voids that link and an older
 * one, never the new link a later ask gives for the same name; a link with no setup id is voided by any dismissal.
 */
export function captureState(sql: Sql, owner: string, ref: string, setup = ""): CaptureState {
  for (const row of sql("SELECT at, event, detail FROM vault_events WHERE owner = ? AND ref = ? AND event IN ('captured', 'dismissed') ORDER BY id DESC", owner, ref)) {
    if (row.event === "captured") return { state: "entered", at: Number(row.at) };
    if (!setup || row.detail === `setup ${setup}`) return { state: "dismissed", at: Number(row.at) };
  }
  return { state: "pending", at: null };
}

/** One use as the Connected row shows it: when, and what came of it. */
export interface LastUse {
  at: number;
  outcome: string;
}

/** The newest use of each of the person's own references: its audit row, or the provider's rejection of it. */
export function lastUses(sql: Sql, person: string): Record<string, LastUse> {
  const out: Record<string, LastUse> = {};
  for (const r of sql("SELECT ref, MAX(id) AS id FROM egress_audit WHERE person = ? GROUP BY ref", person)) {
    const row = sql("SELECT at, outcome FROM egress_audit WHERE id = ?", r.id)[0] as Row;
    const rejected = sql("SELECT detail FROM vault_events WHERE owner = ? AND ref = ? AND event = 'rejected' AND at >= ? ORDER BY id DESC LIMIT 1", person, r.ref, row.at)[0];
    out[String(r.ref)] = { at: Number(row.at), outcome: rejected ? `rejected by the provider (${String(rejected.detail)})` : String(row.outcome) };
  }
  return out;
}

/** One reference's audit rows for its person, newest first: what it sent and what was refused. */
export function auditOf(sql: Sql, person: string, ref: string, limit = 50) {
  return sql("SELECT at, host, method, path, purpose, outcome FROM egress_audit WHERE person = ? AND ref = ? ORDER BY id DESC LIMIT ?", person, ref, limit).map((r) => ({
    at: Number(r.at), host: String(r.host), method: String(r.method), path: String(r.path), purpose: String(r.purpose), outcome: String(r.outcome),
  }));
}

/** Ends every credential grant on a reference: a revoked credential leaves no grant that could still be used. */
export function revokeGrantsOf(sql: Sql, owner: string, ref: string, at: number) {
  sql("UPDATE credential_grants SET revoked_at = ? WHERE owner = ? AND ref = ? AND revoked_at IS NULL", at, owner, ref);
}

/** The tenant's audit rows, newest first; never a value. */
export function auditRows(sql: Sql, limit: number): AuditRow[] {
  return sql('SELECT at, ref, host, method, path, person, purpose, outcome, grant_nonce AS "grant" FROM egress_audit ORDER BY id DESC LIMIT ?', limit).map((r) => {
    const { grant, ...row } = r;
    return { ...row, ...(grant ? { grant: String(grant) } : {}) } as unknown as AuditRow;
  });
}

/** A `credential_grants` row as the person reads it. */
export function grantInfoOf(r: Row): GrantInfo {
  const g = JSON.parse(String(r.body)) as CredentialGrant;
  return {
    nonce: g.nonce, ref: g.secret_ref, hosts: g.scope.hosts, methods: g.scope.methods, fill: g.scope.fill, oneShot: g.one_shot, expiresAt: g.expires_at,
    issuedAt: Number(r.issued_at), revokedAt: r.revoked_at === null ? null : Number(r.revoked_at), usedAt: r.used_at === null ? null : Number(r.used_at),
  };
}

/** A registry entry the policy cap now refuses is refused by name, not passed over as unknown (the Vault's egress). */
export function policyRefusal(url: string, listed: (host: string) => boolean): EgressResult | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (PUBLIC_HOSTS.some((h) => h.host === host)) return null;
  const capped = checkHost(host);
  return listed(host) && (!capped.ok || capped.value !== host) ? { ok: false, code: "EGRESS_HOST_POLICY", reason: `${host} is refused by the platform policy${capped.ok ? "" : `: ${capped.reason}`}`, host } : null;
}
