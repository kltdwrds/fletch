// `forget` as plan, confirm, execute (muse-reference section 5). The plan names exactly which claims
// and lines go; only the owner confirms it, through their own surface, never through a model tool;
// execution removes the claims, retracts what was derived from them (their chunks, other claims on
// the same source lines, supersession links that point at them) and redacts the source lines in
// place, so every other line number and citation still resolves. From M24.3 a plan may also name sites
// whose saved browser logins go with it: the plan records them, and on execution the person's `Person`
// has the Vault remove those sealed logins (`vault/browser-state.ts`), saying which went. From M25.4 a plan also lists the
// future producers that hold the fact: job bodies and skills that would write it back into memory, so the person sees what
// would re-derive it before confirming (MEM-7). The list is a finding, not an erasure: nothing is changed in a job or a skill.
import { parseHomePath } from "./home.ts";
import { type PersonMemory, type Refusal, refuse } from "./store.ts";

export const FORGOTTEN = "[forgotten]";

type Plan = { id: string; claims: string; lines: string; sites: string | null; status: "planned" | "confirmed" | "executed"; created_at: number };
type Line = { path: string; line: number };

/** The person's job bodies and skills as text, for the plan to read; each is read on the person's own authority. */
export interface ForgetProducers {
  jobs(): Promise<Array<{ id: string; text: string }>>;
  skills(): Promise<Array<{ name: string; text: string }>>;
}

/** A job or skill whose text holds a fact the plan forgets. `how`: the fact word for word, or most of its distinctive words. */
export interface Rederive {
  kind: "job" | "skill";
  id: string;
  how: "exact" | "words";
  /** The claim ids whose fact the text holds. */
  claims: string[];
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const words = (t: string) => [...new Set(norm(t).match(/[\p{L}\p{N}]{4,}/gu) ?? [])];

/** Whether `text` holds `fact`: the same words in a row, or at least three of its distinctive words and three in four of them. */
export function holds(text: string, fact: string): "exact" | "words" | null {
  const f = norm(fact);
  if (f.length < 8) return null;
  const body = norm(text);
  if (body.includes(f)) return "exact";
  const w = words(fact);
  const present = w.filter((x) => new RegExp(`(?<![\\p{L}\\p{N}])${x}`, "u").test(body));
  return present.length >= 3 && present.length * 4 >= w.length * 3 ? "words" : null;
}

export interface PlanView {
  ok: true;
  planId: string;
  claims: Array<{ id: string; quote: string; citation: string }>;
  lines: string[];
  /** Sites whose saved browser logins this plan removes (M24.3). */
  sites: string[];
  /** Jobs and skills that hold the fact and would write it back (M25.4); empty only when `unchecked` is too. */
  rederives: Rederive[];
  /** Producers that could not be read, so the list above is partial for them (M25.4). */
  unchecked: Array<{ source: "jobs" | "skills"; reason: string }>;
}

const SITE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Plans the removal of the named claims, or of the active claims a search phrase finds, and of the named sites' saved logins. */
export async function planForget(mem: PersonMemory, input: { claimIds?: string[]; query?: string; sites?: string[] }, requester: string, producers?: ForgetProducers): Promise<PlanView | Refusal> {
  if (requester !== mem.owner) return refuse("MEMORY_NOT_OWNER", "only the owner forgets their memory");
  const sites = [...new Set((input.sites ?? []).map((x) => String(x).trim().toLowerCase()))];
  if (sites.length > 50 || sites.some((x) => !SITE.test(x))) return refuse("MEMORY_FORGET_SITE_INVALID", "a site is a host name such as login.example.com");
  let ids = input.claimIds ?? [];
  if (!ids.length && input.query) {
    const found = mem.search({ queries: [input.query], maxResults: 25 }, requester);
    if (found.ok) ids = found.hits.flatMap((h) => h.claims.map((c) => c.id));
  }
  const claims = [...new Set(ids)].map((id) => mem.rows<{ id: string; quote: string; source_path: string; source_line: number }>("SELECT id, quote, source_path, source_line FROM claims WHERE id = ?", id)[0]);
  if ((!claims.length && !sites.length) || claims.some((c) => !c)) return refuse("MEMORY_FORGET_NOTHING", "no matching claims or sites to forget");
  const found = claims as Array<NonNullable<(typeof claims)[number]>>;
  const lines: Line[] = [...new Map(found.map((c) => [`${c.source_path}#L${c.source_line}`, { path: c.source_path, line: c.source_line }])).values()];
  const id = `f_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  mem.sql.exec(
    "INSERT INTO forget_plans (id, claims, lines, sites, status, created_at) VALUES (?, ?, ?, ?, 'planned', ?)",
    id,
    JSON.stringify(found.map((c) => c.id)),
    JSON.stringify(lines),
    JSON.stringify(sites),
    mem.now(),
  );
  const facts = found.map((c) => ({ id: c.id, texts: [c.quote, mem.rows<{ text: string }>("SELECT text FROM daily_lines WHERE date = ? AND line = ?", ...dailyKey(c.source_path, c.source_line))[0]?.text ?? ""].filter((t) => t && t !== FORGOTTEN) }));
  return {
    ok: true,
    planId: id,
    claims: found.map((c) => ({ id: c.id, quote: c.quote, citation: `${c.source_path}#L${c.source_line}` })),
    lines: lines.map((l) => `${l.path}#L${l.line}`),
    sites,
    ...(await findProducers(facts, producers)),
  };
}

const dailyKey = (path: string, line: number): [string, number] => {
  const at = parseHomePath(path);
  return [at?.kind === "daily" ? at.date : "", line];
};

/** The jobs and skills whose text holds a forgotten fact; a source that fails to read is named, never counted as clean. */
async function findProducers(facts: Array<{ id: string; texts: string[] }>, producers?: ForgetProducers): Promise<{ rederives: Rederive[]; unchecked: PlanView["unchecked"] }> {
  const rederives: Rederive[] = [];
  const unchecked: PlanView["unchecked"] = [];
  if (!producers) return { rederives, unchecked };
  const scan = (kind: Rederive["kind"], id: string, text: string) => {
    const hit = facts.flatMap((f) => {
      const how = f.texts.map((t) => holds(text, t)).find((h) => h === "exact") ?? f.texts.map((t) => holds(text, t)).find((h) => h === "words");
      return how ? [{ id: f.id, how }] : [];
    });
    if (hit.length) rederives.push({ kind, id, how: hit.some((h) => h.how === "exact") ? "exact" : "words", claims: hit.map((h) => h.id) });
  };
  try {
    for (const j of await producers.jobs()) scan("job", j.id, j.text);
  } catch (err) {
    unchecked.push({ source: "jobs", reason: String(err instanceof Error ? err.message : err).slice(0, 200) });
  }
  try {
    for (const k of await producers.skills()) scan("skill", k.name, k.text);
  } catch (err) {
    unchecked.push({ source: "skills", reason: String(err instanceof Error ? err.message : err).slice(0, 200) });
  }
  return { rederives, unchecked };
}

/** The person's one confirmation of a plan. */
export function confirmForget(mem: PersonMemory, planId: string, requester: string): { ok: true } | Refusal {
  if (requester !== mem.owner) return refuse("MEMORY_NOT_OWNER", "only the owner confirms a forget plan");
  const plan = mem.rows<Plan>("SELECT * FROM forget_plans WHERE id = ?", planId)[0];
  if (!plan) return refuse("MEMORY_FORGET_UNKNOWN", `no plan ${planId}`);
  if (plan.status !== "planned") return refuse("MEMORY_FORGET_STATE", `plan ${planId} is ${plan.status}`);
  mem.sql.exec("UPDATE forget_plans SET status = 'confirmed', confirmed_at = ? WHERE id = ?", mem.now(), planId);
  return { ok: true };
}

/** Executes a confirmed plan and re-renders the days it touched. */
export async function executeForget(mem: PersonMemory, planId: string): Promise<{ ok: true; claims: number; chunks: number; lines: number; sites: string[] } | Refusal> {
  const plan = mem.rows<Plan>("SELECT * FROM forget_plans WHERE id = ?", planId)[0];
  if (!plan) return refuse("MEMORY_FORGET_UNKNOWN", `no plan ${planId}`);
  if (plan.status !== "confirmed") return refuse("MEMORY_FORGET_UNCONFIRMED", `plan ${planId} is ${plan.status}, not confirmed`);
  const lines = JSON.parse(plan.lines) as Line[];
  const named = JSON.parse(plan.claims) as string[];
  const out = mem.transaction(() => {
    let claims = 0;
    let chunks = 0;
    // Claims derived from the same source lines go with the named ones.
    const doomed = new Set(named);
    for (const l of lines) for (const { id } of mem.rows<{ id: string }>("SELECT id FROM claims WHERE source_path = ? AND source_line = ?", l.path, l.line)) doomed.add(id);
    for (const id of doomed) {
      claims += mem.rows<{ id: string }>("DELETE FROM claims WHERE id = ? RETURNING id", id).length;
      mem.sql.exec("UPDATE claims SET supersedes = NULL WHERE supersedes = ?", id);
    }
    for (const l of lines) {
      chunks += mem.rows<{ n: number }>("SELECT COUNT(*) AS n FROM chunks WHERE path = ? AND line_start = ?", l.path, l.line)[0]?.n ?? 0;
      mem.dropIndex(l.path, l.line);
      const at = parseHomePath(l.path);
      if (at?.kind === "daily") mem.sql.exec("UPDATE daily_lines SET text = ?, rendered = 0 WHERE date = ? AND line = ?", FORGOTTEN, at.date, l.line);
    }
    mem.sql.exec("UPDATE forget_plans SET status = 'executed', executed_at = ? WHERE id = ?", mem.now(), planId);
    return { claims, chunks };
  });
  const dates = [...new Set(lines.map((l) => parseHomePath(l.path)).flatMap((p) => (p?.kind === "daily" ? [p.date] : [])))];
  for (const d of dates) await mem.renderDate(d);
  return { ok: true, ...out, lines: lines.length, sites: plan.sites ? (JSON.parse(plan.sites) as string[]) : [] };
}
