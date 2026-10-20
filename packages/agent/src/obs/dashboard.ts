// The cost dashboard (M15.3), in two views and one rollup, each composed from reads whose owning
// store decides:
//
// * a company admin's view: the tenant's cost per person and job, the online signals and every
//   member's delivery counts. The `Company` decides who is an admin; each `Person` gives counts only.
// * a person's own view: their cost, their delivery items' dispositions and attempts (no item text),
//   and the compaction records of their chats with tokens before and after. The `Person` lists chats
//   to its owner alone, each `Chat` gives its records to its owner alone, and the Ledger is asked for
//   the session's own person.
// * the sweeper's daily rollup, through the platform route: the Ledger keeps the day's numbers and
//   returns the part with no person named.
//
// A part that could not be read is said with its code, never shown as empty (KICKOFF).
import type { CompactionRecord } from "../chat/store.ts";
import type { ChatEntry } from "../person/chats.ts";
import { MAX_STEPS_PER_TURN } from "../chat/turn.ts";
import { dayBounds, type DeliveryCounts, type PlatformRollup, type Rollup } from "../ledger/rollup.ts";

type Refusal = { ok: false; code: string; reason?: string };
export type Range = { from: number; to: number; days: number };

export const DASHBOARD_DAYS = 7;
const DAY_MS = 86_400_000;

/** The range a dashboard shows: the last `days` days to now, one to thirty-one, a week by default. */
export function rangeOf(days: unknown, now: number): Range | Refusal {
  const n = days === undefined || days === null || days === "" ? DASHBOARD_DAYS : Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 31) return { ok: false, code: "DASHBOARD_RANGE_INVALID", reason: "days is a whole number from 1 to 31" };
  return { from: now - n * DAY_MS, to: now + 1, days: n };
}

export interface DashboardLedger {
  dashboard(range: { from: number; to: number; person?: string }, deliveries: DeliveryCounts[]): Promise<Rollup>;
}

export interface AdminDashboardDeps {
  isAdmin(by: string): Promise<boolean>;
  members(): Promise<string[]>;
  counts(person: string, from: number, to: number): Promise<DeliveryCounts>;
  ledger: DashboardLedger;
}

/** Each member's delivery counts, or the members whose `Person` could not be read, by code. */
async function allCounts(d: Pick<AdminDashboardDeps, "members" | "counts">, from: number, to: number) {
  const counts: DeliveryCounts[] = [];
  const unread: Array<{ person: string; code: string }> = [];
  for (const person of await d.members()) {
    try {
      counts.push(await d.counts(person, from, to));
    } catch {
      unread.push({ person, code: "DELIVERY_COUNTS_UNAVAILABLE" });
    }
  }
  return { counts, unread };
}

export async function adminDashboard(d: AdminDashboardDeps, by: string, range: Range) {
  if (!(await d.isAdmin(by))) return { ok: false as const, code: "NOT_AN_ADMIN", reason: "only an admin sees the company's cost dashboard" };
  const { counts, unread } = await allCounts(d, range.from, range.to);
  return { ok: true as const, view: "admin" as const, days: range.days, rollup: await d.ledger.dashboard(range, counts), unread };
}

export interface PersonDashboardDeps {
  chats(by: string): Promise<{ ok: true; chats?: ChatEntry[] } | Refusal>;
  compactions(chatId: string, by: string): Promise<CompactionRecord[] | null>;
  items(by: string): Promise<{ ok: true; items: Array<Record<string, unknown>> } | Refusal>;
  counts(from: number, to: number): Promise<DeliveryCounts>;
  ledger: DashboardLedger;
}

/** The item fields the person's dashboard shows: how it went, never what it said. */
const ITEM_FIELDS = ["id", "kind", "category", "state", "disposition", "attempts", "nextAttempt", "retried", "channels", "feedback", "code", "createdAt", "deliveredAt"] as const;

export async function personDashboard(d: PersonDashboardDeps, by: string, range: Range) {
  const listed = await d.chats(by);
  if (!listed.ok) return listed;
  const compactions: Array<CompactionRecord & { chatId: string; chatKind: string }> = [];
  const unread: Array<{ chatId: string; code: string }> = [];
  // Read together and folded in the list's order: a person's chats add up, and one after another took
  // twenty seconds on staging (M23.1: the agent sheet reads this).
  const read = await Promise.all(
    (listed.chats ?? []).map(async (c) => {
      try {
        return { c, records: await d.compactions(c.id, by), failed: false };
      } catch {
        return { c, records: null, failed: true };
      }
    }),
  );
  for (const { c, records, failed } of read) {
    if (failed) unread.push({ chatId: c.id, code: "COMPACTIONS_UNAVAILABLE" });
    else if (records === null) unread.push({ chatId: c.id, code: "COMPACTIONS_NOT_OWNER" });
    else for (const r of records) if (r.at >= range.from && r.at < range.to) compactions.push({ ...r, chatId: c.id, chatKind: c.kind });
  }
  const viewed = await d.items(by);
  const items = viewed.ok
    ? viewed.items.filter((i) => Number(i.createdAt) >= range.from && Number(i.createdAt) < range.to).map((i) => Object.fromEntries(ITEM_FIELDS.map((k) => [k, i[k] ?? null])))
    : viewed;
  const counts = await d.counts(range.from, range.to);
  return { ok: true as const, view: "person" as const, person: by, days: range.days, rollup: await d.ledger.dashboard({ ...range, person: by }, [counts]), items, compactions: compactions.sort((a, b) => b.at - a.at), unread };
}

export interface RollupDeps {
  members(): Promise<string[]>;
  counts(person: string, from: number, to: number): Promise<DeliveryCounts>;
  ledger: { rollup(day: string, deliveries: DeliveryCounts[]): Promise<{ ok: true; rollup: PlatformRollup } | Refusal> };
}

/** The sweeper's call for one day; a member whose counts could not be read fails the day rather than shrinking it. */
export async function dayRollup(d: RollupDeps, day: unknown): Promise<{ ok: true; rollup: PlatformRollup } | Refusal> {
  const bounds = typeof day === "string" ? dayBounds(day) : null;
  if (!bounds) return { ok: false, code: "ROLLUP_DAY_INVALID", reason: "day must be YYYY-MM-DD" };
  const { counts, unread } = await allCounts(d, bounds.from, bounds.to);
  if (unread.length) return { ok: false, code: "DELIVERY_COUNTS_UNAVAILABLE", reason: `${unread.length} members' counts could not be read` };
  return d.ledger.rollup(day as string, counts);
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);
const table = (head: string[], rows: unknown[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}">none in range</td></tr>`}</tbody></table>`;

type AdminView = Extract<Awaited<ReturnType<typeof adminDashboard>>, { ok: true }>;
type PersonView = Extract<Awaited<ReturnType<typeof personDashboard>>, { ok: true }>;

/** The dashboard as a page: numbers, codes and ids only, every value escaped. */
export function renderDashboard(v: AdminView | PersonView): string {
  const r = v.rollup;
  const s = r.signals;
  const parts = [
    `<h1>${v.view === "admin" ? "Company cost" : "Your agent's cost"}, last ${v.days} days</h1>`,
    `<p id="totals">${r.totals.calls} model calls, ${r.totals.tokens} tokens, ${usd(r.totals.costMicros)}</p>`,
    "<h2>By person</h2>", table(["Person", "Calls", "Tokens", "Cost"], r.people.map((l) => [l.name, l.calls, l.tokens, usd(l.costMicros)])),
    "<h2>By job</h2>", table(["Job", "Calls", "Tokens", "Cost"], r.jobs.map((l) => [l.name, l.calls, l.tokens, usd(l.costMicros)])),
    "<h2>Signals</h2>",
    `<p id="signals">override rate ${pct(s.overrideRate)}; runs ${s.runs.succeeded} of ${s.runs.total} succeeded, ${s.runs.failed} failed, ${s.runs.blocked} blocked; cost per successful task ${s.costPerSuccessfulTaskMicros === null ? "n/a" : usd(s.costPerSuccessfulTaskMicros)}; feedback ${s.feedback.accept} accept, ${s.feedback.edit} edit, ${s.feedback.reject} reject, ${s.feedback.stop} stop</p>`,
    `<p id="turns">${r.turns.stepLimit} chat turns ended at the ${MAX_STEPS_PER_TURN}-step cap; ${r.turns.stopped} stopped by the person</p>`,
    table(["Action kind", "Approved", "Declined", "Under a grant"], s.approvals.map((a) => [a.actionKind, a.approved, a.declined, a.underGrant])),
    "<h2>Delivery versus acceptance</h2>",
    `<p id="delivery">${s.delivery.delivered} of ${s.delivery.items} delivered, ${s.delivery.failed} failed, ${s.delivery.open} open, ${s.delivery.retried} retried; ${s.delivery.accepted} accepted (${pct(s.delivery.acceptanceRate)})</p>`,
    table(["Person", "Items", "Delivered", "Failed", "Open", "Retried", "Accepted", "Edited", "Rejected", "Stopped"], r.deliveries.map((c) => [c.person, c.items, c.delivered, c.failed, c.open, c.retried, c.accepted, c.edited, c.rejected, c.stopped])),
  ];
  if (v.view === "person") {
    parts.push(
      "<h2>Delivery items</h2>",
      Array.isArray(v.items) ? table(["Item", "Kind", "Disposition", "Attempts", "Next attempt", "Retried", "Feedback"], v.items.map((i) => [i.id, i.kind, i.disposition ?? "open", i.attempts, i.nextAttempt ?? "", (i.retried as string[] | null)?.join(",") ?? "", i.feedback ?? ""])) : `<p class="unread">items unavailable: ${esc((v.items as Refusal).code)}</p>`,
      "<h2>Compactions</h2>",
      table(["Chat", "Kind", "Checkpoint", "First kept", "Tokens before", "Tokens after", "Trigger"], v.compactions.map((c) => [c.chatId, c.chatKind, c.checkpointSeq, c.firstKeptSeq, c.tokensBefore, c.tokensAfter ?? "not measured", c.trigger])),
    );
  }
  for (const u of v.unread) parts.push(`<p class="unread">${esc("chatId" in u ? u.chatId : u.person)}: ${esc(u.code)}</p>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cost dashboard</title><style>body{font:15px/1.45 system-ui,sans-serif;margin:16px;color:#1d1d1f;background:#fafafa}table{border-collapse:collapse;margin:8px 0 16px;display:block;overflow-x:auto}th,td{padding:4px 10px;border-bottom:1px solid #ddd;text-align:left}.unread{color:#a33}</style></head><body>${parts.join("\n")}</body></html>`;
}
