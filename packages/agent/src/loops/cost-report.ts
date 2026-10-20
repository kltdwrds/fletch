// The monthly cost report (memory-and-learning.md "Background loops"): a rollup of the Ledger's own
// rows per person and per job for one calendar month (UTC), rendered as Markdown for the company's
// admins. It is code over rows the Ledger already holds and makes no model call.
import type { ModelCallRow, RunRow } from "../ledger/types.ts";

export type Call = Pick<ModelCallRow, "person" | "runId" | "inputTokens" | "outputTokens" | "at"> & { costMicros: number };
export type Run = Pick<RunRow, "runId" | "jobId" | "person">;
/** A call with the route and clock the timing lines need (M18.3). */
export type TimedCall = Call & Pick<ModelCallRow, "route" | "status" | "startedAt" | "firstTokenAt" | "finishedAt">;

/** Median and 90th percentile, in milliseconds, of the calls that have the measurement. */
export interface Spread {
  n: number;
  medianMs: number;
  p90Ms: number;
}

/** One route's answer times over its successful calls: to the first token, and in total. */
export interface RouteTiming {
  route: string;
  calls: number;
  firstToken: Spread | null;
  duration: Spread | null;
}

export interface CostLine {
  name: string;
  calls: number;
  tokens: number;
  costMicros: number;
}

export interface CostReport {
  month: string;
  totals: Omit<CostLine, "name">;
  people: CostLine[];
  jobs: CostLine[];
  routes: RouteTiming[];
  markdown: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The first and the last-plus-one millisecond of a `YYYY-MM` month in UTC; null when it is not one. */
export function monthBounds(month: string): { from: number; to: number } | null {
  const m = MONTH.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: Date.UTC(y, mo, 1), to: Date.UTC(y, mo + 1, 1) };
}

/** The month before the one `at` falls in: what a report due on the first covers. */
export function previousMonth(at: number): string {
  const d = new Date(at);
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The job a call belongs to: the job run that names its run id, else a loop by its id's prefix
 * (`loop:<id>:<slot>`), else the kind its run id names (`referee`, `import`), else the person's chats.
 */
export function jobOf(call: Call, runs: Map<string, string>): string {
  const job = runs.get(`${call.person}\u0000${call.runId}`);
  if (job) return job;
  const loop = /^loop:([a-z-]+):/.exec(call.runId);
  if (loop) return `loop:${loop[1]}`;
  const kind = /^([a-z-]+):/.exec(call.runId);
  return kind?.[1] ?? "chat";
}

export function rollup(calls: Call[], key: (c: Call) => string): CostLine[] {
  const by = new Map<string, CostLine>();
  for (const c of calls) {
    const name = key(c);
    const line = by.get(name) ?? { name, calls: 0, tokens: 0, costMicros: 0 };
    line.calls++;
    line.tokens += c.inputTokens + c.outputTokens;
    line.costMicros += c.costMicros;
    by.set(name, line);
  }
  return [...by.values()].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

/** Nearest-rank percentile of `sorted` (ascending, non-empty). */
const rank = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] as number;

function spread(values: number[]): Spread | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, medianMs: rank(sorted, 0.5), p90Ms: rank(sorted, 0.9) };
}

/**
 * Per route, the median and p90 time to first token and total duration over calls that finished `ok`:
 * a refused call never ran and a failed one's duration says nothing about the model. A call with no
 * timestamps (made before M18.3) is left out of a spread, never counted as zero.
 */
export function routeTimings(calls: TimedCall[]): RouteTiming[] {
  const by = new Map<string, TimedCall[]>();
  for (const c of calls) by.set(c.route, [...(by.get(c.route) ?? []), c]);
  return [...by]
    .map(([route, rows]) => {
      const ok = rows.filter((c) => c.status === "ok" && c.startedAt !== null);
      return {
        route,
        calls: rows.length,
        firstToken: spread(ok.filter((c) => c.firstTokenAt !== null).map((c) => (c.firstTokenAt as number) - (c.startedAt as number))),
        duration: spread(ok.filter((c) => c.finishedAt !== null).map((c) => (c.finishedAt as number) - (c.startedAt as number))),
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
const table = (title: string, head: string, lines: CostLine[]) => [
  `## ${title}`,
  "",
  `| ${head} | Calls | Tokens | Cost |`,
  "|---|---:|---:|---:|",
  ...(lines.length ? lines.map((l) => `| ${l.name} | ${l.calls} | ${l.tokens} | ${usd(l.costMicros)} |`) : ["| (none) | 0 | 0 | $0.0000 |"]),
  "",
];

const secs = (s: Spread | null, f: "medianMs" | "p90Ms") => (s ? `${(s[f] / 1000).toFixed(1)} s` : "n/a");
const timingTable = (lines: RouteTiming[]) => [
  "## Answer time by route",
  "",
  "| Route | Calls | First token median | First token p90 | Duration median | Duration p90 |",
  "|---|---:|---:|---:|---:|---:|",
  ...(lines.length
    ? lines.map((l) => `| ${l.route} | ${l.calls} | ${secs(l.firstToken, "medianMs")} | ${secs(l.firstToken, "p90Ms")} | ${secs(l.duration, "medianMs")} | ${secs(l.duration, "p90Ms")} |`)
    : ["| (none) | 0 | n/a | n/a | n/a | n/a |"]),
  "",
];

/** The report for `month` from every model call and job run the Ledger holds; calls outside the month are left out. */
export function costReport(month: string, allCalls: TimedCall[], runs: Run[]): CostReport | null {
  const bounds = monthBounds(month);
  if (!bounds) return null;
  const calls = allCalls.filter((c) => c.at >= bounds.from && c.at < bounds.to);
  const jobs = new Map(runs.map((r) => [`${r.person}\u0000${r.runId}`, r.jobId]));
  const people = rollup(calls, (c) => c.person);
  const byJob = rollup(calls, (c) => jobOf(c, jobs));
  const routes = routeTimings(calls);
  const totals = { calls: calls.length, tokens: people.reduce((n, l) => n + l.tokens, 0), costMicros: people.reduce((n, l) => n + l.costMicros, 0) };
  const markdown = [
    `# Cost report ${month}`,
    "",
    `${totals.calls} model calls, ${totals.tokens} tokens, ${usd(totals.costMicros)}.`,
    "",
    ...table("By person", "Person", people),
    ...table("By job", "Job", byJob),
    ...timingTable(routes),
  ].join("\n");
  return { month, totals, people, jobs: byJob, routes, markdown };
}
