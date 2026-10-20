// The app's routes for the authority model (M7.1): a chat's approval cards and their decisions, the
// person's grants, colleagues' labeled requests and the directory, and an admin's company policies and
// grants. The person comes from the verified session; each object decides again where the data lives
// (the `Chat` admits only the card's approver, the `Person` signs only its own grants, the `Company`
// checks the admin), so these routes decide nothing themselves.
import { decideText } from "../chat/decide-words.ts";
import type { CardView, Choice } from "../chat/cards.ts";
import type { DecideResult } from "../chat/approvals.ts";
import type { DirectoryEntry, RequestOutcome } from "../colleagues/tools.ts";
import type { CreateResult } from "../grants/store.ts";
import type { Grant } from "../grants/types.ts";

export interface AuthorityDirectory {
  cards(chatId: string, person: string): Promise<CardView[] | null>;
  decide(chatId: string, ids: string[], by: { person: string; agent: boolean }, choice: Choice): Promise<DecideResult[]>;
  clearLatch(chatId: string, person: string): Promise<{ ok: boolean; code?: string }>;
  /** The person's compaction of one chat (M24.2); the `Chat` decides the owner and whether it can run. */
  compact(chatId: string, person: string): Promise<{ ok: true; record: unknown } | { ok: false; code: string; reason?: string }>;
  grants(person: string): {
    create(by: string, input: unknown): Promise<CreateResult>;
    list(by: string): Promise<Grant[] | null>;
    revoke(by: string, id: string): Promise<{ ok: boolean; code?: string }>;
  };
  request(to: string, r: { from: string; text: string }): Promise<RequestOutcome>;
  directory(): Promise<DirectoryEntry[]>;
  addPolicy(by: string, input: unknown): Promise<{ ok: boolean; code?: string }>;
  companyGrant(by: string, input: unknown): Promise<CreateResult>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHOICES: Choice[] = ["once", "period", "always", "deny"];
const body = async (r: Request) => ((await r.json().catch(() => null)) ?? {}) as Record<string, unknown>;
const statusOf = (code: string) => (/NOT_AN_ADMIN|NOT_PRINCIPAL|NOT_APPROVER|AGENT_REFUSED|NOT_YOURS|NOT_A_MEMBER/.test(code) ? 403 : /UNKNOWN|NOT_FOUND/.test(code) ? 404 : 400);

export async function authorityRoutes(request: Request, url: URL, person: string, dir: AuthorityDirectory | undefined): Promise<Response | null> {
  if (!dir) return null;
  const cards = url.pathname.match(/^\/chats\/([^/]+)\/cards(\/decide)?$/);
  if (cards) {
    const chatId = cards[1] as string;
    if (!CHAT_ID.test(chatId)) return json({ code: "CHAT_NOT_FOUND", text: decideText("CHAT_NOT_FOUND") }, 404);
    if (!cards[2] && request.method === "GET") {
      const list = await dir.cards(chatId, person);
      return list ? json({ cards: list }) : json({ code: "CHAT_NOT_FOUND" }, 404);
    }
    if (cards[2] && request.method === "POST") {
      const b = await body(request);
      const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
      if (!ids.length || !CHOICES.includes(b.choice as Choice)) return json({ code: "DECISION_INVALID", reason: "name card ids and a choice: once, period, always or deny", text: decideText("DECISION_INVALID") }, 400);
      // A human session; the agent has no route to decide, and the chat refuses anyone but the approver.
      const results = await dir.decide(chatId, ids, { person, agent: false }, b.choice as Choice);
      const refused = results.find((r) => !r.ok) as { code: string } | undefined;
      return json({ results }, refused && results.every((r) => !r.ok) ? statusOf(refused.code) : 200);
    }
  }
  const compact = url.pathname.match(/^\/chats\/([^/]+)\/compact$/);
  if (compact && request.method === "POST") {
    const chatId = compact[1] as string;
    if (!CHAT_ID.test(chatId)) return json({ ok: false, code: "CHAT_NOT_FOUND" }, 404);
    const r = await dir.compact(chatId, person);
    return r.ok ? json(r) : json(r, r.code === "CHAT_NOT_OWNER" ? 403 : r.code === "TURN_IN_PROGRESS" ? 409 : 400);
  }
  const latch = url.pathname.match(/^\/chats\/([^/]+)\/latch\/clear$/);
  if (latch && request.method === "POST") {
    const r = await dir.clearLatch(latch[1] as string, person);
    return r.ok ? json({ ok: true }) : json({ code: r.code }, 404);
  }
  if (url.pathname === "/api/grants" && request.method === "GET") return json({ grants: await dir.grants(person).list(person) });
  if (url.pathname === "/api/grants" && request.method === "POST") {
    // The person signs as themselves: the grantor is the session's person, whatever the body says.
    const b = await body(request);
    const created = await dir.grants(person).create(person, { ...b, grantor: { kind: "person", id: person } });
    return created.ok ? json({ grant: created.grant }, 201) : json({ code: created.code, reason: created.reason }, statusOf(created.code));
  }
  const revoke = url.pathname.match(/^\/api\/grants\/(g_[0-9a-f]{32})\/revoke$/);
  if (revoke && request.method === "POST") {
    const r = await dir.grants(person).revoke(person, revoke[1] as string);
    return r.ok ? json({ ok: true }) : json({ code: r.code }, statusOf(r.code ?? "GRANT_UNKNOWN"));
  }
  if (url.pathname === "/api/colleagues" && request.method === "GET") return json({ colleagues: await dir.directory() });
  if (url.pathname === "/api/colleagues/requests" && request.method === "POST") {
    const b = await body(request);
    const to = typeof b.to === "string" ? b.to.trim().toLowerCase() : "";
    const outcome = await dir.request(to, { from: person, text: typeof b.text === "string" ? b.text : "" });
    return outcome.ok ? json(outcome) : json({ code: outcome.code, reason: outcome.reason }, statusOf(outcome.code));
  }
  if (url.pathname === "/admin/policies" && request.method === "POST") {
    const r = await dir.addPolicy(person, await body(request));
    return r.ok ? json(r, 201) : json(r, statusOf(r.code ?? "POLICY_INVALID"));
  }
  if (url.pathname === "/admin/grants" && request.method === "POST") {
    const b = await body(request);
    const r = await dir.companyGrant(person, b);
    return r.ok ? json({ grant: r.grant }, 201) : json({ code: r.code, reason: r.reason }, statusOf(r.code));
  }
  return null;
}
