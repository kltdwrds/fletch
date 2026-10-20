// Grant constraints, evaluated in code against one descriptor. A constraint that fails turns an
// automatic grant into ask (authority-model.md step 3); it never widens anything.
import { zoned } from "../jobs/schedule.ts";
import type { Constraints, Descriptor, WindowConstraint } from "./types.ts";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOf(hhmm: string): number | null {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function inGrantWindow(at: number, w: WindowConstraint): boolean {
  const from = minutesOf(w.from);
  const to = minutesOf(w.to);
  if (from === null || to === null) return false;
  const t = zoned(at, w.timeZone);
  if (!w.days.includes(t.weekday)) return false;
  const now = t.hour * 60 + t.minute;
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

/**
 * The names of the constraints that fail for this descriptor; empty when all hold. `uses` are the
 * instants this grant applied automatically before, for the rate.
 */
export function failingConstraints(c: Constraints, d: Descriptor, uses: number[]): string[] {
  const failed: string[] = [];
  if (c.window && !inGrantWindow(d.at, c.window)) failed.push("window");
  if (c.max_amount) {
    const a = d.amount;
    if (!a || a.currency !== c.max_amount.currency || a.value > c.max_amount.value) failed.push("max_amount");
  }
  if (c.recipients) {
    const allowed = new Set(c.recipients);
    if (!d.recipients?.length || d.recipients.some((r) => !allowed.has(r))) failed.push("recipients");
  }
  if (c.resources) {
    if (!d.subject.resource || !c.resources.includes(d.subject.resource)) failed.push("resources");
  }
  if (c.rate) {
    const since = d.at - c.rate.perSeconds * 1000;
    if (uses.filter((u) => u > since).length >= c.rate.count) failed.push("rate");
  }
  return failed;
}
