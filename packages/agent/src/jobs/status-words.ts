// The words a job's status is said in, one table for everything that says it: the job tools' answers
// and (through the app's job route) the Jobs page, so the two cannot drift (M19.2, QYVR-171). From
// M20.1 the page draws the words the route sends from here, and the table says them as a person would:
// "on", "ran", "off until you turn it on".
import type { JobStatus } from "./store.ts";

export const JOB_STATUS_WORDS: Record<JobStatus, string> = {
  active: "on",
  needs_enable: "off until you turn it on",
  disabled: "off",
  blocked: "on, but blocked",
  needs_attention: "needs your attention",
  finished: "ran",
  archived: "removed",
};

export const statusWords = (status: JobStatus): string => JOB_STATUS_WORDS[status];

/**
 * A finished run's word in the panel's table (`PANEL_TEXT`), the same on its Activity row and in the job dialog's Run
 * history (F31, P5 delta 5): how it ended, and for a run that reported, whether its notice arrived. A report is
 * `runReported` only when every notice it queued was delivered; one the chat refused for good, or none at all, did not
 * arrive; one still being delivered says so. Null for a run that has not finished.
 */
export type RunWord = "runReported" | "runUndelivered" | "runSending" | "runNothing" | "runFailed" | "runBlocked";
export function runWord(run: { runId: string; phase: string; signal: string | null }, outbox: ReadonlyArray<{ runId: string | null; state: string }>): RunWord | null {
  if (run.phase !== "done") return null;
  if (run.signal === "failed") return "runFailed";
  if (run.signal === "blocked") return "runBlocked";
  if (run.signal === "nothing_to_report") return "runNothing";
  const notices = outbox.filter((o) => o.runId === run.runId);
  if (!notices.length || notices.some((o) => o.state === "failed")) return "runUndelivered";
  return notices.every((o) => o.state === "delivered") ? "runReported" : "runSending";
}
