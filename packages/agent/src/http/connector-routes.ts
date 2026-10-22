// The Connectors, Permissions and Search pages' reads (M23.5). Every answer is for the session's person alone:
// the Vault lists a person's own credentials and the company's, the `Company` names the connectors this member's
// agent is entitled to, the `Person` lists its own grants and chats and searches its own memory, and each `Chat`
// searches its own thread for its owner (`search-route.ts`, F2), so nothing in a request names another person and whose rows these are is the owning store's answer. No answer carries a
// credential value or a reference: a connector is a host, a label and a kind in words. The writes are not here:
// Revoke is `/api/grants/<id>/revoke`, which the engine's own route and the `Person` decide.
import type { Grant } from "../grants/types.ts";
import type { CredentialInfo } from "../vault/core.ts";
import { AVAILABLE_CONNECTORS, BUILTIN_PAGES, CONNECTORS_TEXT, engineRow, GATE_DEFAULTS, type PermissionRow, standingNotes } from "./app/permission-words.ts";
import { type SearchReads, searchRoute } from "./search-route.ts";

type Refusal = { ok: false; code: string; reason?: string };

/** The reads this module needs, as `AppDirectory` carries them. */
export interface ConnectorReads extends SearchReads {
  /** The person's credentials and the company's: references, labels, hosts; never a value. */
  credentials(person: string): Promise<CredentialInfo[]>;
  /** The company connectors this member's agent may use, and who connected each. */
  companyConnectors(person: string): Promise<{ ok: true; connectors: Array<{ id: string; hosts: string[]; connectedBy: string; at: number }> } | Refusal>;
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

const KIND_WORDS: Record<string, string> = { secret: "API key or token", login: "Login password" };
const USE_WORDS = { standing: "Your agent may use it at this host", grant: "Only under a grant you give each time" };

interface Item { id: string; kind: "builtin" | "yours" | "company"; name: string; sub: string }

/** The hosts of the person's own credentials, one connector per host. Revoked credentials are not connected. */
function yoursOf(creds: CredentialInfo[]): Item[] {
  const byHost = new Map<string, string[]>();
  for (const c of creds) {
    if (c.company || c.status !== "active") continue;
    for (const h of c.hosts) byHost.set(h.host, [...(byHost.get(h.host) ?? []), c.label || KIND_WORDS[c.kind] || "Credential"]);
  }
  return [...byHost].sort(([a], [b]) => a.localeCompare(b)).map(([host, labels]) => ({ id: `host:${host}`, kind: "yours" as const, name: host, sub: `${CONNECTORS_TEXT.yours} · ${labels.join(", ")}` }));
}

async function connected(person: string, dir: ConnectorReads) {
  const [creds, company, names] = await Promise.all([part(() => dir.credentials(person)), part(() => dir.companyConnectors(person)), part(() => dir.names())]);
  const nameOf = (email: string) => (Array.isArray(names) ? names.find((n) => n.email === email)?.name : undefined) ?? email;
  const builtin: Item[] = Object.entries(BUILTIN_PAGES).map(([id, p]) => ({ id, kind: "builtin", name: p.title, sub: CONNECTORS_TEXT.builtIn }));
  const yours = Array.isArray(creds) ? yoursOf(creds) : (creds as Refusal);
  const shared = failed(company) ? (company as Refusal) : (company as { connectors: Array<{ id: string; hosts: string[]; connectedBy: string }> }).connectors.map((c): Item => ({ id: `company:${c.id}`, kind: "company", name: c.id, sub: CONNECTORS_TEXT.companyBy.replace("{name}", nameOf(c.connectedBy)) }));
  return { builtin, yours, company: shared, creds, nameOf };
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
    if (id.startsWith("host:") && Array.isArray(c.creds)) {
      const host = id.slice("host:".length);
      const mine = c.creds.filter((x) => !x.company && x.status === "active" && x.hosts.some((h) => h.host === host));
      if (mine.length) {
        const rows = mine.map((x): PermissionRow => ({ id: `${x.kind}:${x.label}`, label: x.label || KIND_WORDS[x.kind] || "Credential", words: USE_WORDS[x.permission] }));
        return json({ ok: true, connector: { id, name: host, blurb: `${CONNECTORS_TEXT.yours}. ${CONNECTORS_TEXT.neverShown}`, kind: "yours" }, groups: [{ label: "Use", rows }] });
      }
    }
    if (id.startsWith("company:") && Array.isArray(c.company)) {
      const found = c.company.find((x) => x.id === id);
      if (found) return json({ ok: true, connector: { id, name: found.name, blurb: `${found.sub}. ${CONNECTORS_TEXT.neverShown}`, kind: "company" }, groups: [{ label: "Use", rows: [{ id: "use", label: "Your agent's use", words: "Under a company grant" }] }] });
    }
    return json({ ok: false, code: "CONNECTOR_NOT_FOUND" }, 404);
  }

  if (url.pathname === "/app/permissions") {
    const [grants, c] = await Promise.all([part(() => dir.grants(person)), connected(person, dir)]);
    const count = c.builtin.length + (Array.isArray(c.yours) ? c.yours.length : 0) + (Array.isArray(c.company) ? c.company.length : 0);
    const standing = Array.isArray(grants) ? { ok: true, notes: standingNotes(grants, c.nameOf, dir.now()) } : { ok: false, code: (grants as Refusal | null)?.code ?? "GRANTS_NOT_YOURS" };
    return json({ ok: true, defaults: GATE_DEFAULTS, standing, connectors: count });
  }

  if (url.pathname === "/app/search") return searchRoute(url, person, dir);
  return null;
}
