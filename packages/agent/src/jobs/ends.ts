// How a job's run ends and the lines the engine says about it (M25.2, M25.6, F29): the stop conditions, read over the
// job's own runs, and the chat lines for a failure and for a stop in flight. Pure: the engine queues what these return.
import { fromZoned } from "./schedule.ts";
import type { JobRow, JobRun } from "./store.ts";

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether a run that just ended meets the job's stop condition (M25.2); the person's "run now" counts too. */
export function stopsAfter(job: JobRow, signal: "notify" | "nothing_to_report", runs: JobRun[]): boolean {
  const stop = job.def.stop;
  if (!stop) return false;
  if (stop.kind === "first_report") return signal === "notify";
  if (stop.kind === "after_runs") return runs.filter((r) => r.phase === "done" && (r.signal === "notify" || r.signal === "nothing_to_report")).length >= stop.runs;
  return false;
}

/** Whether an `until` stop's local date has ended in the job's zone. */
export function pastUntil(job: JobRow, now: number): boolean {
  const stop = job.def.stop;
  if (stop?.kind !== "until") return false;
  const [y, m, d] = stop.date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return now >= fromZoned(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, job.def.timing.zone);
}

/** A failed run, said (M25.6): when the person ran it, and whether another run follows (a one-shot is spent, B-P7-04). */
export function failedLine(job: JobRow, a: { manual: boolean; code: string; reason: string; now: number }): string {
  const when = a.manual ? ` when you ran it (${new Date(a.now).toISOString().slice(0, 19).replace("T", " ")} UTC)` : "";
  const next = job.def.timing.schedule.kind === "runonce" ? " It was a one-time job, so it will not run again." : a.manual ? "" : " It will try again at its next scheduled time; I will not repeat this one.";
  return `${job.def.title} did not finish${when}: ${a.code} (${a.reason}).${next}`;
}

/** A run ended by its owner's stop or remove while it was in flight (deltas 1 and 5): said as stopped, with the code. */
export function stoppedLine(title: string, code: string): string {
  const what = code === "JOB_ARCHIVED" ? "you removed the job" : "you turned the job off";
  return `${title} was stopped: ${what} while it was running, so this run ended without a result (${code}).`;
}
