// The cost dashboard's numbers (testing-and-evals.md section 8), computed from the Ledger's own rows
// for a time range and from each person's delivery counts: cost per person, per job and for the
// tenant, and the online signals: approval decisions by action kind and grant, feedback verdicts,
// run outcomes and cost per successful task, the override rate, and delivery versus acceptance. Code
// over rows; no model call, and no content: every input row is already identifiers, codes and counts.
//
// The override rate is the share of a person's decisions on what the agent proposed that refused or
// changed it: approvals declined plus outbox items edited or rejected, over every approval decided
// and every verdict given. A stop is a stated preference about a category, not a verdict on the item,
// so it counts neither way. Null when nothing was decided.
import type { JournalRow } from "../grants/journal.ts";
import { type Call, type CostLine, jobOf, rollup as costLines } from "../loops/cost-report.ts";
import type { RunRow, TurnEndRow } from "./types.ts";

/** One person's delivery items created in the range, as their `Person` counts them; no item content. */
export interface DeliveryCounts {
  person: string;
  items: number;
  delivered: number;
  failed: number;
  /** Still pending, held, suppressed or owed a retry (disposition null). */
  open: number;
  /** Items whose one retry on some channel was spent. */
  retried: number;
  accepted: number;
  edited: number;
  rejected: number;
  stopped: number;
}

export interface ApprovalLine {
  actionKind: string;
  approved: number;
  declined: number;
  /** Decisions that ran under a grant (an approval mints one; a refusal names none). */
  underGrant: number;
}

export interface Signals {
  approvals: ApprovalLine[];
  feedback: { accept: number; edit: number; reject: number; stop: number };
  overrideRate: number | null;
  runs: { total: number; succeeded: number; failed: number; blocked: number; open: number };
  costPerSuccessfulTaskMicros: number | null;
  delivery: { items: number; delivered: number; failed: number; open: number; retried: number; accepted: number; acceptanceRate: number | null };
}

export interface Rollup {
  from: number;
  to: number;
  totals: { calls: number; tokens: number; costMicros: number };
  people: CostLine[];
  jobs: CostLine[];
  signals: Signals;
  /**
   * Chat turns that ended at the step cap and that the person stopped (M24.2), so the cap is raised on
   * evidence. The tenant's own view: kept beside the signals, so the platform rollup's checked shape is unchanged.
   */
  turns: { stepLimit: number; stopped: number };
  deliveries: DeliveryCounts[];
}

export interface RollupInput {
  from: number;
  to: number;
  calls: Call[];
  runs: RunRow[];
  journal: JournalRow[];
  /** Absent where the caller has no turn ends to count (counted as none). */
  turnEnds?: TurnEndRow[];
  deliveries: DeliveryCounts[];
}

const within = (at: number, r: { from: number; to: number }) => at >= r.from && at < r.to;
const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);
const SUCCESS = new Set(["nothing_to_report", "notify"]);
const VERDICT = /^FEEDBACK_(ACCEPT|EDIT|REJECT|STOP)$/;

/**
 * A person's decision on an approval card: the `<chat>:<card>:decision` row `chat/approvals.ts` writes
 * once per card. A decline names the person as actor; an allowed action names the agent that ran it,
 * so the id, not the actor, marks the decision. Refused attempts are `:attempt:` rows and never count.
 */
const isApprovalDecision = (r: JournalRow) => r.id.endsWith(":decision");

export function computeRollup(input: RollupInput): Rollup {
  const calls = input.calls.filter((c) => within(c.at, input));
  const runs = input.runs.filter((r) => within(r.scheduledFor, input));
  const journal = input.journal.filter((r) => within(r.at, input));
  const turnEnds = (input.turnEnds ?? []).filter((r) => within(r.at, input));
  const jobs = new Map(input.runs.map((r) => [`${r.person}\u0000${r.runId}`, r.jobId]));
  const people = costLines(calls, (c) => c.person);

  const approvals = new Map<string, ApprovalLine>();
  for (const r of journal.filter(isApprovalDecision)) {
    const line = approvals.get(r.actionKind) ?? { actionKind: r.actionKind, approved: 0, declined: 0, underGrant: 0 };
    if (r.outcome === "DECLINED") line.declined++;
    else line.approved++;
    if (r.grantId) line.underGrant++;
    approvals.set(r.actionKind, line);
  }
  const feedback = { accept: 0, edit: 0, reject: 0, stop: 0 };
  for (const r of journal) {
    const m = r.actionKind === "delivery.feedback" ? VERDICT.exec(r.outcome) : null;
    if (m) feedback[(m[1] as string).toLowerCase() as keyof typeof feedback]++;
  }
  const decided = [...approvals.values()].reduce((n, a) => n + a.approved + a.declined, 0) + feedback.accept + feedback.edit + feedback.reject;
  const overridden = [...approvals.values()].reduce((n, a) => n + a.declined, 0) + feedback.edit + feedback.reject;

  const done = runs.filter((r) => r.phase === "done");
  const succeeded = done.filter((r) => r.signal !== null && SUCCESS.has(r.signal));
  const successCost = succeeded.reduce((n, r) => n + r.costMicros, 0);

  const d = input.deliveries.reduce(
    (t, c) => ({ items: t.items + c.items, delivered: t.delivered + c.delivered, failed: t.failed + c.failed, open: t.open + c.open, retried: t.retried + c.retried, accepted: t.accepted + c.accepted }),
    { items: 0, delivered: 0, failed: 0, open: 0, retried: 0, accepted: 0 },
  );

  return {
    from: input.from,
    to: input.to,
    totals: { calls: calls.length, tokens: people.reduce((n, l) => n + l.tokens, 0), costMicros: people.reduce((n, l) => n + l.costMicros, 0) },
    people,
    jobs: costLines(calls, (c) => jobOf(c, jobs)),
    signals: {
      approvals: [...approvals.values()].sort((a, b) => a.actionKind.localeCompare(b.actionKind)),
      feedback,
      overrideRate: ratio(overridden, decided),
      runs: { total: runs.length, succeeded: succeeded.length, failed: done.filter((r) => r.signal === "failed").length, blocked: done.filter((r) => r.signal === "blocked").length, open: runs.length - done.length },
      costPerSuccessfulTaskMicros: succeeded.length ? Math.round(successCost / succeeded.length) : null,
      delivery: { ...d, acceptanceRate: ratio(d.accepted, d.delivered) },
    },
    turns: { stepLimit: turnEnds.filter((r) => r.outcome === "step_limit").length, stopped: turnEnds.filter((r) => r.outcome === "stopped").length },
    deliveries: [...input.deliveries].sort((a, b) => a.person.localeCompare(b.person)),
  };
}

/**
 * What leaves the tenant for the platform's rollups: the tenant's totals and signals with no person
 * named. Jobs are folded to their kind (a job id is the tenant's), and deliveries to their sum.
 */
export interface PlatformRollup {
  tenant: string;
  day: string;
  totals: Rollup["totals"];
  kinds: CostLine[];
  people: number;
  signals: Signals;
}

export function platformRollup(tenant: string, day: string, r: Rollup): PlatformRollup {
  const kinds = new Map<string, CostLine>();
  for (const j of r.jobs) {
    const name = /^(loop:[a-z-]+|chat|subagent|verifier|referee|import|handover|sample)$/.test(j.name) ? j.name : "job";
    const k = kinds.get(name) ?? { name, calls: 0, tokens: 0, costMicros: 0 };
    k.calls += j.calls;
    k.tokens += j.tokens;
    k.costMicros += j.costMicros;
    kinds.set(name, k);
  }
  return {
    tenant,
    day,
    totals: r.totals,
    kinds: [...kinds.values()].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name)),
    people: r.people.length,
    signals: r.signals,
  };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC bounds of a `YYYY-MM-DD` day; null when it is not one. */
export function dayBounds(day: string): { from: number; to: number } | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const from = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(from).toISOString().slice(0, 10) !== day) return null;
  return { from, to: from + 86_400_000 };
}
