// Two things the model must not decide for a job (M21.1, QYVR-178 and step 6): whether a proposal is
// the same request as a job that already exists, and what time the person is told. Both are pure code
// over what the person said and what the schedule resolved to.
import { describeCadence, nextSlotAfter, type Timing, zoned } from "./schedule.ts";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * What a job does, as the key two proposals are compared on: the kind and the normalized prompt. Case,
 * punctuation and spacing do not count, and neither do the title or the resolved time, which are the
 * parts a model varies between two sends of one request.
 */
export function actionKey(kind: string, instructions: string): string {
  const words = instructions.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${kind}:${words}`;
}

// Words that ask for a second job of the same request. A short, closed list: a person who wants
// another one says so, and a phrase this misses is answered with the existing job (the safe side).
const ANOTHER = /\b(another|a second|second one|one more|an additional|additional (one|job|reminder)|a separate|separate (one|job|reminder|copy)|a new one|a duplicate|twice|two of (them|these|those))\b/i;
// A refusal of a second one nearby ("don't make another") is not a request for one.
const REFUSED = /\b(don'?t|do not|dont|no|not|never|without|instead of)\b(\s+\w+){0,3}\s+(another|a second|second one|one more|an additional|additional|a separate|separate|a new one|a duplicate)\b/i;

/** Whether the person's own message asks for a second, identical job. Decided from their words alone. */
export function asksForAnother(text: string | undefined): boolean {
  if (!text) return false;
  return ANOTHER.test(text) && !REFUSED.test(text);
}

/**
 * The sentence the person reads for a job just registered, built from the resolved first run: the
 * weekday, date, local time and zone. It is the same whether they named the time or the agent picked it.
 */
export function timeLine(timing: Timing, now: number): string {
  const slot = nextSlotAfter(timing, now);
  if (slot === null) return `Set for ${describeCadence(timing)}. Say so to change it.`;
  const p = zoned(slot, timing.zone);
  return `Set for ${DAYS[p.weekday]} ${p.year}-${pad(p.month)}-${pad(p.day)} at ${pad(p.hour)}:${pad(p.minute)} ${timing.zone}. Say so to change it.`;
}

