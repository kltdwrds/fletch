// The Activity tab's words (F12): a task's status in words, one table, and the journal's words by action family and
// outcome (M23.3), kept for the steps a task's timeline joins from the journal (F13). Nothing here is a code shown as
// words: a failure's code rides in its own slot of the one sentence that says it.

/** A task's status in words (F12); `{code}` is the failed turn's code. */
export const ACTIVITY_TEXT = {
  status: { done: "Complete", running: "Running", waiting: "Waiting on you", failed: "Failed: {code}", stopped: "Stopped" },
} as const;

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
