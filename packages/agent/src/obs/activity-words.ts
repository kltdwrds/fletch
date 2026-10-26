// What the agent did, in words, by a journal row's action kind and outcome (M23.3). A journal row is identifiers and
// codes; these tables say it with none of them: no grant id, no tool or action name, no subject, no counterpart and
// no run id. One table says every kind and outcome; one this table does not know still gets a sentence, never the
// code. The Activity tab lists tasks from the chats' own turns (F12), so the journal-only feed these words drew is
// gone; the tables stay for the journal rows a task's steps join (F13).

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

/** Who decided a success, by the gate's decision. */
export const BY: Record<string, string> = {
  auto: "It went ahead under a permission you gave.",
  ask: "You were asked first.",
  deny: "It was held back.",
};

export function titleOf(actionKind: string): string {
  let best: [string, string] | null = null;
  for (const k of KIND_WORDS) if ((actionKind === k[0] || actionKind.startsWith(`${k[0]}.`)) && (!best || k[0].length > best[0].length)) best = k;
  return best ? best[1] : UNKNOWN_TITLE;
}
