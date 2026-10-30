// The words and rows of a person's connections and grants (F36, P9 deltas 5, 6 and 7), as pure functions over the
// owning stores' answers: a Connected "Yours" row carries its credential's stored status (`CredentialInfo.status`) and
// the newest audit row's time as its last use, with what came of that use; a connection's page carries its audit
// rows read-only and what a Disconnect leaves; the Permissions pane lists every grant once, the Vault's credential
// grants beside the `Person`'s grants, each with what it covers, its lifetime and when it was made, and every count
// it draws is the length of the rows it draws. Nothing here decides or reads a value.
import { inForce } from "../../grants/engine.ts";
import type { Grant } from "../../grants/types.ts";
import { type LastUse, WHAT_REMAINS } from "../../vault/connections.ts";
import type { CredentialInfo, GrantInfo } from "../../vault/core.ts";
import { CONNECTORS_TEXT, standingTitle } from "./permission-words.ts";

export const CONNECTION_TEXT = {
  status: { active: "Active", expired: "Expired", revoked: "Revoked", spent: "Spent" } as Record<string, string>,
  lastUsed: "last used",
  notUsed: "not used yet",
  thisConnection: "This connection",
  statusLabel: "Status",
  hosts: "Hosts",
  hostsSub: "Bound by you on the form; only you can change them",
  sentAs: "Sent as",
  openGrants: "Grants",
  lastUse: "Last used",
  sent: "What it sent",
  sentNone: "Nothing has been sent with it yet",
  disconnect: "Disconnect",
  disconnectWhat: "Removes the key and every grant that names it, at once.",
  disconnected: "Disconnected. The key and its grants are gone; what it sent is still listed on its page until you leave it.",
  notDisconnected: "Not disconnected: that did not go through. Try again; if it keeps happening, tell an admin.",
  grants: "Grants",
  grantsEmpty: "You have given no grants.",
  oneUse: "one use",
  spent: "spent",
  standing: "until you revoke it",
  ends: "ends",
  made: "made",
  credential: "Credential",
  action: "Action",
};

/** What a use came to, in words: sent, the provider's rejection, or why it was refused before anything left. */
export function outcomeWords(outcome: string): string {
  if (outcome === "resolved") return "sent";
  if (outcome.startsWith("rejected by the provider")) return outcome;
  if (outcome === "EGRESS_CRED_EXPIRED") return "refused: the key has expired";
  if (outcome === "EGRESS_CRED_REVOKED") return "refused: the key was revoked";
  if (outcome === "EGRESS_CRED_HOST_DENIED" || outcome === "EGRESS_HOST_DENIED") return "refused before anything left: the host is not bound";
  return "refused before anything left";
}

/** A pill's tone for a row: done while it works, wait when it lapsed, fail when the provider refused it. */
const toneOf = (status: string, outcome: string | null) => (outcome?.startsWith("rejected") ? "fail" : status === "active" ? "done" : "wait");

/** The kinds a person connects (a key, a login); a held code, a typed secret and a saved browser login are not connections. */
export const CONNECTION_KINDS = new Set(["secret", "login"]);

/** The person's own credentials that are connections now: not the company's, not revoked, a key or a login. */
export const connectionsOf = (creds: readonly CredentialInfo[]) => creds.filter((c) => !c.company && c.status !== "revoked" && CONNECTION_KINDS.has(c.kind));

export interface YoursItem {
  id: string;
  kind: "yours";
  name: string;
  sub: string;
  /** `CredentialInfo.status` as stored (active, expired, spent), and the word the pill draws. */
  status: string;
  statusWord: string;
  tone: string;
  /** The newest audit row's time for the host's credentials, ISO; null before any use. */
  lastUse: string | null;
  /** What came of that use, in words; null before any use. */
  outcome: string | null;
}

const KIND_WORDS: Record<string, string> = { secret: "API key or token", login: "Login password" };

/** One "Yours" row per host the person's connections are bound to, each with its status word and its last use. */
export function yoursRows(creds: readonly CredentialInfo[], uses: Record<string, LastUse>): YoursItem[] {
  const byHost = new Map<string, CredentialInfo[]>();
  for (const c of connectionsOf(creds)) for (const h of c.hosts) byHost.set(h.host, [...(byHost.get(h.host) ?? []), c]);
  return [...byHost]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, cs]) => {
      const status = (cs.find((c) => c.status === "active") ?? (cs[0] as CredentialInfo)).status;
      const last = cs.map((c) => uses[c.ref]).filter((u): u is LastUse => !!u).sort((a, b) => b.at - a.at)[0];
      const outcome = last ? outcomeWords(last.outcome) : null;
      const labels = cs.map((c) => c.label || KIND_WORDS[c.kind] || "Credential").join(", ");
      return { id: `host:${host}`, kind: "yours" as const, name: host, sub: `${CONNECTORS_TEXT.yours} · ${labels}`, status, statusWord: CONNECTION_TEXT.status[status] ?? status, tone: toneOf(status, outcome), lastUse: last ? new Date(last.at).toISOString() : null, outcome };
    });
}

/** One row of a connection's page: a label and its words, with a sub line, a time and a tone where it has them. */
export interface ConnectionRow {
  id: string;
  label: string;
  words: string;
  sub?: string;
  at?: number;
  tone?: string;
}

/** A connection's page (`host:<host>`): its status, hosts, how it is sent, open grants and last use; what it sent; Disconnect. */
export function connectionPage(host: string, mine: readonly CredentialInfo[], uses: Record<string, LastUse>, grants: readonly GrantInfo[], audit: ReadonlyArray<{ at: number; host: string; method: string; path: string; outcome: string; ref: string }>, now: number) {
  const row = yoursRows(mine, uses).find((r) => r.name === host) as YoursItem;
  const refs = new Set(mine.map((c) => c.ref));
  const open = grants.filter((g) => refs.has(g.ref) && g.revokedAt === null && g.usedAt === null && g.expiresAt > now);
  const placement = mine.flatMap((c) => c.hosts.filter((h) => h.host === host).map((h) => (h.fills ? "typed into the sign-in page" : `${h.header}: ${h.prefix.trim()}`.trim())));
  const used = audit[0];
  const it: ConnectionRow[] = [
    { id: "status", label: CONNECTION_TEXT.statusLabel, words: row.statusWord, tone: row.tone },
    { id: "hosts", label: CONNECTION_TEXT.hosts, sub: CONNECTION_TEXT.hostsSub, words: [...new Set(mine.flatMap((c) => c.hosts.map((h) => h.host)))].join(", ") },
    { id: "sent-as", label: CONNECTION_TEXT.sentAs, words: [...new Set(placement)].join(", ") },
    { id: "grants", label: CONNECTION_TEXT.openGrants, words: `${open.length} open` },
    { id: "last-use", label: CONNECTION_TEXT.lastUse, words: row.outcome ?? CONNECTION_TEXT.notUsed, ...(used ? { at: used.at } : {}) },
  ];
  const sent: ConnectionRow[] = audit.map((a, i) => ({ id: `audit-${i}`, label: `${a.method} ${a.host === host ? "" : a.host}${a.path}`, words: a.outcome === "resolved" ? "Sent" : outcomeWords(a.outcome), at: a.at, tone: a.outcome === "resolved" ? "done" : "fail" }));
  return {
    groups: [
      { label: CONNECTION_TEXT.thisConnection, rows: it },
      { label: CONNECTION_TEXT.sent, rows: sent.length ? sent : [{ id: "audit-none", label: CONNECTION_TEXT.sentNone, words: "" }] },
    ],
    disconnect: { label: CONNECTION_TEXT.disconnect, words: CONNECTION_TEXT.disconnectWhat, stays: WHAT_REMAINS.replace("{host}", host) },
  };
}

export interface GrantRow {
  /** What Revoke acts on: a credential grant's nonce in the Vault, or a grant's id in the `Person`; never drawn. */
  id: string;
  kind: "credential" | "authority";
  covers: string;
  /** "one use", "one use · spent" or "until you revoke it": how it ends, always said. */
  lifetime: string;
  /** When it was made, ISO. */
  made: string;
  /** When it ends at the latest, if it has an end. */
  ends: number | null;
  spent: boolean;
}

const MODE_WORDS: Record<string, string> = { auto: "allowed", ask: "asks you first", deny: "never" };

/** What a credential grant covers: the credential (a code by its kind), its hosts and what it may do there. */
export const credentialCovers = (g: GrantInfo) => `${g.ref.startsWith("cred://otp-") ? "a one-time code" : g.ref} at ${g.hosts.join(", ")}: ${g.fill ? "fill" : g.methods.join(", ")}`;

/** What an authority grant covers: for the person's own agent, the subject and its mode; for someone else, the sentence. */
export const authorityCovers = (g: Grant, nameOf: (email: string) => string) => (g.grantee.kind === "own-agent" ? `${g.subject.ref}: ${MODE_WORDS[g.mode] ?? g.mode}` : standingTitle(g, nameOf));

/**
 * Every grant the person gave, once: the Vault's credential grants and the `Person`'s grants, neither revoked nor past
 * its end (a spent one-shot stays, said spent), newest first; and the counts, each the number of rows of its kind.
 */
export function grantRows(credential: readonly GrantInfo[], authority: readonly Grant[], nameOf: (email: string) => string, now: number) {
  const life = (oneShot: boolean, spent: boolean) => (oneShot ? (spent ? `${CONNECTION_TEXT.oneUse} · ${CONNECTION_TEXT.spent}` : CONNECTION_TEXT.oneUse) : CONNECTION_TEXT.standing);
  const creds: GrantRow[] = credential
    .filter((g) => g.revokedAt === null && g.expiresAt > now)
    .map((g) => ({ id: g.nonce, kind: "credential", covers: credentialCovers(g), lifetime: life(g.oneShot, g.usedAt !== null), made: new Date(g.issuedAt).toISOString(), ends: g.expiresAt, spent: g.usedAt !== null }));
  const auth: GrantRow[] = authority
    .filter((g) => g.grantor.kind === "person" && (inForce(g, now) || (g.one_shot === true && g.used_at !== undefined && g.revoked_at === undefined)))
    .map((g) => ({ id: g.id, kind: "authority", covers: authorityCovers(g, nameOf), lifetime: life(g.one_shot === true, g.used_at !== undefined), made: new Date(g.created_at).toISOString(), ends: g.expires_at ?? null, spent: g.one_shot === true && g.used_at !== undefined }));
  const rows = [...creds, ...auth].sort((a, b) => b.made.localeCompare(a.made) || a.id.localeCompare(b.id));
  return { rows, counts: { credential: creds.length, authority: auth.length } };
}
