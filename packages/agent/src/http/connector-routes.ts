// The Connectors, Permissions and Search pages' reads (M23.5). Every answer is for the session's person alone:
// the Vault lists a person's own credentials and the company's, the `Company` names the connectors this member's
// agent is entitled to, the `Person` lists its own grants and chats and searches its own memory, and each `Chat`
// searches its own thread for its owner (`search-route.ts`, F2), so nothing in a request names another person and whose rows these are is the owning store's answer. No answer carries a
// credential value or a reference: a connector is a host, a label and a kind in words. The writes are not here:
// Revoke is `/api/grants/<id>/revoke`, which the engine's own route and the `Person` decide. From F36 (P9 deltas 5 to 7)
// a "Yours" row carries its stored status and its last use, a connection's page its audit rows and what a Disconnect
// leaves (the Disconnect itself is `/vault/revoke`), and Permissions every grant once, credential and authority alike.
import type { Grant } from "../grants/types.ts";
import type { LastUse } from "../vault/connections.ts";
import type { CredentialInfo, GrantInfo } from "../vault/core.ts";
import { connectionPage, connectionsOf, grantRows, yoursRows } from "./app/connection-words.ts";
import { AVAILABLE_CONNECTORS, BUILTIN_PAGES, CONNECTORS_TEXT, engineRow, GATE_DEFAULTS, type PermissionRow } from "./app/permission-words.ts";
import { type SearchReads, searchRoute } from "./search-route.ts";

type Refusal = { ok: false; code: string; reason?: string };

/** The reads this module needs, as `AppDirectory` carries them. */
export interface ConnectorReads extends SearchReads {
  /** The person's credentials and the company's: references, labels, hosts; never a value. */
  credentials(person: string): Promise<CredentialInfo[]>;
  /** The company connectors this member's agent may use, and who connected each. */
  companyConnectors(person: string): Promise<{ ok: true; connectors: Array<{ id: string; hosts: string[]; connectedBy: string; at: number }> } | Refusal>;
  /** The newest use of each of the person's credentials (F36): the Vault's audit and the provider's rejections. */
  lastUses(person: string): Promise<Record<string, LastUse>>;
  /** One of the person's credentials' audit rows, newest first (F36). */
  audit(person: string, ref: string): Promise<Array<{ at: number; host: string; method: string; path: string; purpose: string; outcome: string }>>;
  /** The person's credential grants, from the Vault (F36). */
  credentialGrants(person: string): Promise<GrantInfo[]>;
  /** The person's own grants; null for anyone else. */
  grants(person: string): Promise<Grant[] | null>;
  names(): Promise<Array<{ email: string; name?: string }>>;
  now(): number;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const failed = (r: unknown) => (r as { ok?: boolean } | null)?.ok === false;
async function part<T>(read: () => Promise<T>): Promise<T | Refusal> {
  try {
    return await read();
  } catch (e) {
    return { ok: false, code: "APP_READ_FAILED", reason: String(e).slice(0, 200) };
  }
}

interface Item { id: string; kind: "builtin" | "yours" | "company"; name: string; sub: string }

async function connected(person: string, dir: ConnectorReads) {
  const [creds, company, names, uses] = await Promise.all([part(() => dir.credentials(person)), part(() => dir.companyConnectors(person)), part(() => dir.names()), part(() => dir.lastUses(person))]);
  const nameOf = (email: string) => (Array.isArray(names) ? names.find((n) => n.email === email)?.name : undefined) ?? email;
  const builtin: Item[] = Object.entries(BUILTIN_PAGES).map(([id, p]) => ({ id, kind: "builtin", name: p.title, sub: CONNECTORS_TEXT.builtIn }));
  // A row's last use is part of the row: an audit that could not be read leaves the rows unread, never "not used yet".
  const yours = !Array.isArray(creds) ? (creds as Refusal) : failed(uses) ? (uses as Refusal) : yoursRows(creds, uses as Record<string, LastUse>);
  const shared = failed(company) ? (company as Refusal) : (company as { connectors: Array<{ id: string; hosts: string[]; connectedBy: string }> }).connectors.map((c): Item => ({ id: `company:${c.id}`, kind: "company", name: c.id, sub: CONNECTORS_TEXT.companyBy.replace("{name}", nameOf(c.connectedBy)) }));
  return { builtin, yours, company: shared, creds, nameOf, uses };
}

export async function connectorRoutes(request: Request, url: URL, person: string, dir: ConnectorReads | undefined): Promise<Response | null> {
  if (!dir || request.method !== "GET") return null;

  if (url.pathname === "/app/connectors") {
    const c = await connected(person, dir);
    return json({ ok: true, builtin: c.builtin, yours: c.yours, company: c.company, available: AVAILABLE_CONNECTORS });
  }

  const page = /^\/app\/connectors\/(.+)$/.exec(url.pathname);
  if (page) {
    const id = decodeURIComponent(page[1] as string);
    const now = dir.now();
    const builtin = BUILTIN_PAGES[id];
    if (builtin) {
      const grants = await part(() => dir.grants(person));
      const groups = builtin.groups.map((g) => ({
        label: g.label,
        rows: g.rows.map((r): PermissionRow => (r.actionKind && r.connector ? (Array.isArray(grants) ? engineRow(grants, { id: r.id, label: r.label, actionKind: r.actionKind, connector: r.connector }, now) : { id: r.id, label: r.label, words: CONNECTORS_TEXT.notRead }) : { id: r.id, label: r.label, words: r.fixed ?? "" })),
      }));
      return json({ ok: true, connector: { id, name: builtin.title, blurb: builtin.blurb, kind: "builtin" }, groups });
    }
    const c = await connected(person, dir);
    if (id.startsWith("host:") && Array.isArray(c.creds) && !failed(c.uses)) {
      const host = id.slice("host:".length);
      const mine = connectionsOf(c.creds).filter((x) => x.hosts.some((h) => h.host === host));
      if (mine.length) {
        const [grants, ...audits] = await Promise.all([dir.credentialGrants(person), ...mine.map((x) => dir.audit(person, x.ref).then((rows) => rows.map((r) => ({ ...r, ref: x.ref }))))]);
        const audit = audits.flat().sort((a, b) => b.at - a.at);
        const pageOf = connectionPage(host, mine, c.uses as Record<string, LastUse>, grants, audit, now);
        return json({ ok: true, connector: { id, name: host, blurb: `${CONNECTORS_TEXT.yours}. ${CONNECTORS_TEXT.neverShown}`, kind: "yours" }, ...pageOf });
      }
    }
    if (id.startsWith("company:") && Array.isArray(c.company)) {
      const found = c.company.find((x) => x.id === id);
      if (found) return json({ ok: true, connector: { id, name: found.name, blurb: `${found.sub}. ${CONNECTORS_TEXT.neverShown}`, kind: "company" }, groups: [{ label: "Use", rows: [{ id: "use", label: "Your agent's use", words: "Under a company grant" }] }] });
    }
    return json({ ok: false, code: "CONNECTOR_NOT_FOUND" }, 404);
  }

  if (url.pathname === "/app/permissions") {
    const [grants, credential, c] = await Promise.all([part(() => dir.grants(person)), part(() => dir.credentialGrants(person)), connected(person, dir)]);
    const count = c.builtin.length + (Array.isArray(c.yours) ? c.yours.length : 0) + (Array.isArray(c.company) ? c.company.length : 0);
    // Every grant once (F36, P9 delta 7): both stores read, or the list is not drawn; a half list is never shown whole.
    const unread = !Array.isArray(grants) ? ((grants as Refusal | null)?.code ?? "GRANTS_NOT_YOURS") : !Array.isArray(credential) ? (credential as Refusal).code : null;
    const all = unread ? { ok: false, code: unread } : { ok: true, ...grantRows(credential as GrantInfo[], grants as Grant[], c.nameOf, dir.now()) };
    return json({ ok: true, defaults: GATE_DEFAULTS, grants: all, connectors: count });
  }

  if (url.pathname === "/app/search") return searchRoute(url, person, dir);
  return null;
}
