// The person's journal as notes in words (M23.3, the sheet's Activity tab). A journal row is identifiers
// and codes; a note is a title, one line and a time, and carries none of them: no grant id, no tool or
// action name, no subject, no counterpart and no run id. The route that serves it reads only the session
// person's rows from the Ledger, so whose notes these are is the owning store's answer. One table says
// every kind and outcome; one this table does not know still gets a sentence, never the code.
import type { JournalRow } from "../grants/journal.ts";

export interface ActivityNote {
  /** The row's id, so a page can key a note; it is an effect or decision id, never shown. */
  id: string;
  at: number;
  title: string;
  line: string;
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

const BY: Record<string, string> = {
  auto: "It went ahead under a permission you gave.",
  ask: "You were asked first.",
  deny: "It was held back.",
};

export function titleOf(actionKind: string): string {
  let best: [string, string] | null = null;
  for (const k of KIND_WORDS) if ((actionKind === k[0] || actionKind.startsWith(`${k[0]}.`)) && (!best || k[0].length > best[0].length)) best = k;
  return best ? best[1] : UNKNOWN_TITLE;
}

export function noteOf(row: JournalRow): ActivityNote {
  const how = OUTCOME_WORDS[row.outcome];
  // A success after an approval says who decided; a refusal or a failure says only what happened.
  const line = row.outcome === "DONE" ? `${how} ${BY[row.decision] ?? ""}`.trim() : (how ?? UNKNOWN_OUTCOME);
  return { id: row.id, at: row.at, title: titleOf(row.actionKind), line };
}

/** Newest first, a page of them; the row ids are the Ledger's order (`at`, then `id`). */
export const ACTIVITY_SHOWN = 100;
export function notesOf(rows: JournalRow[]): ActivityNote[] {
  return rows.map(noteOf).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)).slice(0, ACTIVITY_SHOWN);
}
