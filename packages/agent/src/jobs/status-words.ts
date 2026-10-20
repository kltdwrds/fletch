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
