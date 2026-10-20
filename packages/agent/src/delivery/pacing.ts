// Pacing (M14.1, B16, B17; muse-reference "Delivery and proactivity rules"), decided in code. A result
// the person asked for (a job they set up, a reply, their mail) is delivered at once into the chat it
// belongs to. An ordinary proactive item (something the agent offers unasked) waits for the person's
// waking hours and a quiet stretch after they last wrote, and at most one proactive delivery goes out a
// day, carrying every item then held. A stated stop on a category suppresses its proactive items; a
// one-time dismissal is recorded and changes nothing here. An urgent item skips the waiting, never a stop.
import { fromZoned, zoned } from "../jobs/schedule.ts";

export type ItemKind = "requested" | "proactive";

export interface PacedItem {
  kind: ItemKind;
  category: string;
  urgent: boolean;
}

export interface PacingState {
  zone: string;
  /** The person's last message in any chat. */
  lastActivityAt: number | null;
  /** The last proactive delivery. */
  lastProactiveAt: number | null;
  stopped: ReadonlySet<string>;
}

export const WAKING_START_HOUR = 8;
export const WAKING_END_HOUR = 21;
export const QUIET_MS = 20 * 60_000;

export type PacingDecision =
  | { action: "deliver" }
  | { action: "hold"; until: number; code: "DELIVERY_WAITING_HOURS" | "DELIVERY_NOT_QUIET" | "DELIVERY_DAILY_CAP" }
  | { action: "suppress"; code: "DELIVERY_STOPPED" };

const DAY_MS = 86_400_000;

/** The next waking-hours start strictly after the local day of `now`, or today's when it is still ahead. */
function nextWakingStart(now: number, zone: string, nextDay: boolean): number {
  const z = zoned(now, zone);
  const base = Date.UTC(z.year, z.month - 1, z.day) + (nextDay || z.hour >= WAKING_START_HOUR ? DAY_MS : 0);
  const d = new Date(base);
  return fromZoned(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), WAKING_START_HOUR, 0, zone);
}

const sameLocalDay = (a: number, b: number, zone: string) => {
  const x = zoned(a, zone);
  const y = zoned(b, zone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

export function decide(item: PacedItem, state: PacingState, now: number): PacingDecision {
  if (item.kind === "requested") return { action: "deliver" };
  if (state.stopped.has(item.category)) return { action: "suppress", code: "DELIVERY_STOPPED" };
  if (item.urgent) return { action: "deliver" };
  const hour = zoned(now, state.zone).hour;
  if (hour < WAKING_START_HOUR || hour >= WAKING_END_HOUR) return { action: "hold", until: nextWakingStart(now, state.zone, false), code: "DELIVERY_WAITING_HOURS" };
  if (state.lastProactiveAt !== null && sameLocalDay(state.lastProactiveAt, now, state.zone)) return { action: "hold", until: nextWakingStart(now, state.zone, true), code: "DELIVERY_DAILY_CAP" };
  if (state.lastActivityAt !== null && now - state.lastActivityAt < QUIET_MS) return { action: "hold", until: state.lastActivityAt + QUIET_MS, code: "DELIVERY_NOT_QUIET" };
  return { action: "deliver" };
}
