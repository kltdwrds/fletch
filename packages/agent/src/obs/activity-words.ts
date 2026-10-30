// The Activity tab's words (F12): a task's status in words, one table, and the journal's words by action family and
// outcome (M23.3), kept for the steps a task's timeline joins from the journal (F13); the failed-step count, the summary
// step's counts and the task's usage (F31). Nothing here is a code shown as words: a failure's code rides in its own
// slot of the one sentence that says it.

/** A task's status in words (F12); `{code}` is the failed turn's code. */
export const ACTIVITY_TEXT = {
  status: { done: "Complete", running: "Running", waiting: "Waiting on you", failed: "Failed: {code}", stopped: "Stopped" },
  /** A task with failed steps (F31, P5 delta 2): its status words, then the count. A failed step never fails the task. */
  failedSteps: ["{status}, 1 step failed", "{status}, {n} steps failed"],
} as const;

/** A task's status said once for every surface (the Activity row, the drawer's pill): the table's words and the failed-step count. */
export function statusWords(t: { status: keyof typeof ACTIVITY_TEXT.status; code: string | null; failed: number }): string {
  const base = ACTIVITY_TEXT.status[t.status].replace("{code}", t.code ?? "");
  if (t.failed <= 0) return base;
  return ACTIVITY_TEXT.failedSteps[t.failed === 1 ? 0 : 1].replace("{status}", base).replace("{n}", String(t.failed));
}

/**
 * A finished task's summary step in code's words (F31, P5 delta 1): what it did by count, from the steps' states and
 * never from a model's words, then the reply quoted under `reply`. Each group says its count and how many of it failed;
 * a done tool load is plumbing, not the person's work, and is not counted.
 */
export const SUMMARY_WORDS = {
  groups: { read: "read {n}", wrote: "wrote {n}", ran: "ran {n}", other: "{n} other" },
  failed: ", {n} failed",
  files: " ({paths})",
  none: "No steps",
  reply: "The agent's reply, in its own words",
  noReply: "The agent wrote no reply.",
} as const;

/** The task's model calls and tokens in the drawer's head (F31, P5 delta 7), from the Ledger's rows of its turns. */
export const USAGE_WORDS = {
  line: "{calls} · {tokens}",
  call: ["1 model call", "{n} model calls"],
  token: ["1 token", "{n} tokens"],
  unread: "Could not read this task's usage just now.",
} as const;

const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** `{calls} · {tokens}` in `USAGE_WORDS`. */
export function usageWords(u: { calls: number; tokens: number }): string {
  const one = (w: readonly [string, string], n: number) => (n === 1 ? w[0] : w[1].replace("{n}", grouped(n)));
  return USAGE_WORDS.line.replace("{calls}", one(USAGE_WORDS.call, u.calls)).replace("{tokens}", one(USAGE_WORDS.token, u.tokens));
}

/** What the agent did, by the action kind's family: the longest matching prefix wins. */
export const KIND_WORDS: Array<[prefix: string, title: string]> = [
  ["mail", "Sent a mail"],
  ["colleagues", "Asked a colleague"],
  ["company.member", "Invited a colleague"],
  ["delivery", "Handled a notification"],
  ["jobs", "Changed a reminder"],
  ["skill", "Changed a skill"],
  ["browse", "Used the web"],
  ["workspace", "Worked in your workspace"],
  ["platform.workspace", "Asked for a workspace"],
  ["memory", "Updated what it remembers"],
  ["connector", "Used a connected app"],
];
export const UNKNOWN_TITLE = "Did something for you";

/** How it went, by outcome code. */
export const OUTCOME_WORDS: Record<string, string> = {
  DONE: "Done.",
  PENDING: "Waiting for your decision.",
  DENIED: "Not allowed, so it did not run.",
  DENIED_BEFORE: "You had already declined this, so it did not run.",
  DECLINED: "You declined it.",
  EGRESS_GRANT_REQUIRED: "Not allowed to reach that site, so it did not run.",
};
export const UNKNOWN_OUTCOME = "It did not finish.";

/** Who let a gated action run, by the decision that let it (M23.3). */
export const DECISION_WORDS: Record<string, string> = {
  auto: "It went ahead under a permission you gave.",
  ask: "You were asked first.",
  deny: "It was held back.",
};

export function titleOf(actionKind: string): string {
  let best: [string, string] | null = null;
  for (const k of KIND_WORDS) if ((actionKind === k[0] || actionKind.startsWith(`${k[0]}.`)) && (!best || k[0].length > best[0].length)) best = k;
  return best ? best[1] : UNKNOWN_TITLE;
}
