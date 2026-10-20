// The app's admin routes for the company layer (M10.1): each agent's journal and ledger, the refused
// reads of a person's memory and chats, teams, roles, company instructions and company memory. The
// person comes from the verified session; the `Company` decides every admin check where roles live,
// and the `Person` refuses (and journals) any admin read of what is theirs, so these routes decide
// nothing themselves. From M10.2: the admin page, the overview it reads, seats, budgets and the
// model tier, disabling an agent, company connectors, company skills and the workspace mirror. From
// M14.2: the workspace's deployment settings, which the Company reads and writes through the adapter.
import type { AdminArea, AgentLedger } from "../company/admin.ts";
import type { InstructionsVersion } from "../company/instructions.ts";
import type { RoleResult } from "../company/members.ts";
import type { Team } from "../company/teams.ts";
import type { CompanyConnector } from "../company/connectors.ts";
import type { MirrorOutcome } from "../company/mirror.ts";
import type { CompanySettingsView } from "../company/settings.ts";
import type { CompanySkill } from "../company/skills.ts";
import type { JournalRow } from "../grants/journal.ts";
import type { SettingsResult } from "../company/workspace-settings.ts";
import { ADMIN_PAGE } from "./admin-page.ts";

type Refusal = { ok: false; code: string; reason?: string };

export interface AdminDirectory {
  journal(by: string, person: string): Promise<{ ok: true; rows: JournalRow[] } | Refusal>;
  ledger(by: string, person: string): Promise<({ ok: true } & AgentLedger) | Refusal>;
  /** Asks the person's own store; it always refuses an admin, and journals the attempt. */
  personalRead(person: string, by: string, area: AdminArea): Promise<Refusal>;
  isMember(person: string): Promise<boolean>;
  teams(): Promise<Team[]>;
  createTeam(by: string, input: unknown): Promise<{ ok: true; team: Team } | Refusal>;
  setTeamMember(by: string, team: string, email: string, inTeam: boolean): Promise<{ ok: true; team: Team } | Refusal>;
  setRole(by: string, email: string, role: unknown): Promise<RoleResult>;
  instructions(): Promise<InstructionsVersion | null>;
  instructionsHistory(by: string): Promise<InstructionsVersion[] | null>;
  writeInstructions(by: string, text: unknown): Promise<{ ok: true; version: InstructionsVersion; mirror?: MirrorOutcome } | Refusal>;
  writeMemory(by: string, input: { scope: string; text: string }): Promise<{ ok: true; citation: string; mirror?: MirrorOutcome } | Refusal>;
  /** M10.2: everything the admin page shows, for an admin only. */
  overview(by: string): Promise<{ ok: true } | Refusal>;
  setSettings(by: string, input: unknown): Promise<{ ok: true; settings: CompanySettingsView } | Refusal>;
  setAgentDisabled(by: string, email: string, disabled: boolean): Promise<{ ok: true; settings: CompanySettingsView } | Refusal>;
  connectConnector(by: string, input: unknown): Promise<{ ok: true; connector: CompanyConnector } | Refusal>;
  removeConnector(by: string, id: string): Promise<{ ok: true } | Refusal>;
  writeSkill(by: string, input: unknown): Promise<{ ok: true; skill: CompanySkill; mirror?: MirrorOutcome } | Refusal>;
  removeSkill(by: string, name: string): Promise<{ ok: true; mirror?: MirrorOutcome } | Refusal>;
  mirror(by: string): Promise<MirrorOutcome>;
  /** M14.2: upstream's deployment settings; with `input`, written and read back. */
  workspaceSettings(by: string, input?: unknown): Promise<SettingsResult>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const body = async (r: Request) => ((await r.json().catch(() => null)) ?? {}) as Record<string, unknown>;
const statusOf = (code: string) =>
  /NOT_AN_ADMIN|NOT_AN_OWNER|NOT_OWNER|ADMIN_ONLY|MEMBERS_ONLY|REFUSED|ADMIN_READ|FORBIDDEN/.test(code) ? 403 : /UNKNOWN|NOT_FOUND|NOT_A_MEMBER/.test(code) ? 404 : /EXISTS|LAST_OWNER|BELOW_MEMBERS/.test(code) ? 409 : /UNAVAILABLE|LOCKED/.test(code) ? 503 : 400;
const answer = (r: { ok: boolean; code?: string }, ok: unknown, status = 200) => (r.ok ? json(ok, status) : json(r, statusOf(r.code ?? "INVALID")));
const EMAIL_PART = "([^/]+)";
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s).trim().toLowerCase();
  } catch {
    return "";
  }
};

export async function adminRoutes(request: Request, url: URL, person: string, dir: AdminDirectory | undefined): Promise<Response | null> {
  if (!dir || !(url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) return null;
  if (url.pathname === "/admin" && request.method === "GET") {
    // The page itself is served only to someone the Company names an admin.
    const o = await dir.overview(person);
    if (!o.ok) return json(o, statusOf(o.code));
    return new Response(ADMIN_PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (url.pathname === "/admin/overview" && request.method === "GET") {
    const o = await dir.overview(person);
    return o.ok ? json(o) : json(o, statusOf(o.code));
  }
  if (url.pathname === "/admin/settings" && request.method === "PUT") {
    const r = await dir.setSettings(person, await body(request));
    return answer(r, r.ok ? { settings: r.settings } : null);
  }
  const switched = new RegExp(`^/admin/people/${EMAIL_PART}/agent$`).exec(url.pathname);
  if (switched && request.method === "POST") {
    const r = await dir.setAgentDisabled(person, safeDecode(switched[1] as string), (await body(request)).disabled === true);
    return answer(r, r.ok ? { settings: r.settings } : null);
  }
  if (url.pathname === "/admin/connectors" && request.method === "POST") {
    const r = await dir.connectConnector(person, await body(request));
    return answer(r, r.ok ? { connector: r.connector } : null, 201);
  }
  const connector = /^\/admin\/connectors\/([a-z][a-z0-9-]{0,39})$/.exec(url.pathname);
  if (connector && request.method === "DELETE") {
    const r = await dir.removeConnector(person, connector[1] as string);
    return answer(r, { ok: true });
  }
  if (url.pathname === "/admin/skills" && request.method === "POST") {
    const r = await dir.writeSkill(person, await body(request));
    return answer(r, r.ok ? { skill: { name: r.skill.name, description: r.skill.description }, mirror: r.mirror ?? null } : null, 201);
  }
  const skill = /^\/admin\/skills\/([a-z0-9][a-z0-9-]{0,63})$/.exec(url.pathname);
  if (skill && request.method === "DELETE") {
    const r = await dir.removeSkill(person, skill[1] as string);
    return answer(r, r.ok ? { ok: true, mirror: r.mirror ?? null } : null);
  }
  if (url.pathname === "/admin/workspace" && (request.method === "GET" || request.method === "PUT")) {
    const r = await dir.workspaceSettings(person, request.method === "PUT" ? await body(request) : undefined);
    return answer(r, r.ok ? { settings: r.settings } : null);
  }
  if (url.pathname === "/admin/mirror" && request.method === "POST") {
    const r = await dir.mirror(person);
    return json(r, r.ok ? 200 : r.code === "NOT_AN_ADMIN" ? 403 : 502);
  }
  const agent = new RegExp(`^/admin/people/${EMAIL_PART}/(journal|ledger|memory|chats)$`).exec(url.pathname);
  if (agent && request.method === "GET") {
    let who: string;
    try {
      who = decodeURIComponent(agent[1] as string).trim().toLowerCase();
    } catch {
      return json({ code: "NOT_A_MEMBER" }, 404);
    }
    const area = agent[2] as "journal" | "ledger" | AdminArea;
    if (area === "journal") {
      const r = await dir.journal(person, who);
      return answer(r, r.ok ? { rows: r.rows } : null);
    }
    if (area === "ledger") {
      const r = await dir.ledger(person, who);
      return answer(r, r.ok ? { modelCalls: r.modelCalls, runs: r.runs } : null);
    }
    // Memory and chats are the person's: an unknown address is told apart from a refusal only for admins.
    const admin = await dir.journal(person, who);
    if (!admin.ok) return json(admin, statusOf(admin.code));
    return json(await dir.personalRead(who, person, area), 403);
  }
  if (url.pathname === "/admin/teams" && request.method === "GET") return json({ teams: await dir.teams() });
  if (url.pathname === "/admin/teams" && request.method === "POST") {
    const r = await dir.createTeam(person, await body(request));
    return answer(r, r.ok ? { team: r.team } : null, 201);
  }
  const team = /^\/admin\/teams\/([a-z][a-z0-9-]{0,39})\/members$/.exec(url.pathname);
  if (team && request.method === "POST") {
    const b = await body(request);
    const r = await dir.setTeamMember(person, team[1] as string, typeof b.email === "string" ? b.email : "", b.member !== false);
    return answer(r, r.ok ? { team: r.team } : null);
  }
  if (url.pathname === "/admin/roles" && request.method === "POST") {
    const b = await body(request);
    const r = await dir.setRole(person, typeof b.email === "string" ? b.email : "", b.role);
    return answer(r, r.ok ? { member: r.member } : null);
  }
  if (url.pathname === "/admin/instructions" && request.method === "GET") {
    const history = await dir.instructionsHistory(person);
    return history ? json({ current: await dir.instructions(), history }) : json({ code: "NOT_AN_ADMIN" }, 403);
  }
  if (url.pathname === "/admin/instructions" && request.method === "PUT") {
    const r = await dir.writeInstructions(person, (await body(request)).text);
    return answer(r, r.ok ? { version: r.version, mirror: r.mirror ?? null } : null);
  }
  if (url.pathname === "/admin/memory" && request.method === "POST") {
    const b = await body(request);
    const r = await dir.writeMemory(person, { scope: typeof b.scope === "string" ? b.scope : "", text: typeof b.text === "string" ? b.text : "" });
    return answer(r, r.ok ? { citation: r.citation, mirror: r.mirror ?? null } : null, 201);
  }
  return null;
}
