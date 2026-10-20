// Job schedules (M5.1): runonce, interval, daily, weekly and (M25.2) monthly and yearly, in a required IANA zone, with window
// tiering (one cadence inside a window, another or none outside it) and a deterministic jitter.
// Pure: every function takes the time it reasons about. Semantics adopted from cloudflare-os's
// scheduler: an occurrence is the first strictly after a time, and missed occurrences are skipped,
// so a job that slept through ten slots runs once, for the latest, and then keeps its cadence.

export type Hhmm = `${number}:${number}` | string;

/** Days are 0 (Sunday) to 6, in the job's zone; `start` inclusive, `end` exclusive, may wrap midnight. */
export interface Window {
  days?: number[];
  start: Hhmm;
  end: Hhmm;
}

export type Schedule =
  | { kind: "runonce"; at: string }
  | { kind: "interval"; every: number; window?: Window; outside?: number | null }
  | { kind: "daily"; at: Hhmm }
  | { kind: "weekly"; days: number[]; at: Hhmm }
  /** A day of the month; a month shorter than `day` runs on its last day. */
  | { kind: "monthly"; day: number; at: Hhmm }
  /** A date each year (`month` 1-12); 29 February runs on the 28th in a year without it. */
  | { kind: "yearly"; month: number; day: number; at: Hhmm };

export interface Timing {
  schedule: Schedule;
  zone: string;
  /** Seconds added to each occurrence, the same for a given job and slot; at most half the cadence. */
  jitterSeconds?: number;
}

export type TimingCheck = { ok: true; timing: Timing } | { ok: false; code: "SCHEDULE_ZONE_REQUIRED" | "SCHEDULE_INVALID"; reason: string };

const MINUTE = 60_000;
const DAY = 86_400_000;
/** The shortest interval a job may take, so a body cannot turn the alarm into a busy loop. */
export const MIN_EVERY_MINUTES = 5;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

const formats = new Map<string, Intl.DateTimeFormat>();
function format(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    formats.set(zone, f);
  }
  return f;
}

export function validZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone.includes("/") && zone !== "UTC") return false;
  try {
    format(zone);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `ms` in `zone`. */
export function zoned(ms: number, zone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const p = Object.fromEntries(format(zone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAYS[p.weekday as string] ?? 0 };
}

/** The instant a wall-clock time names in `zone`; a time a DST gap skips resolves after the gap. */
export function fromZoned(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zoned(guess, zone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (seen === wall) return guess;
    guess += wall - seen;
  }
  return guess;
}

const minutesOf = (hhmm: string) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
};

/** Whether `ms` falls inside `window` in `zone`. */
export function inWindow(ms: number, window: Window, zone: string): boolean {
  const p = zoned(ms, zone);
  const at = p.hour * 60 + p.minute;
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  const wraps = end <= start;
  const inside = wraps ? at >= start || at < end : at >= start && at < end;
  if (!inside) return false;
  if (!window.days?.length) return true;
  // A window that wraps midnight belongs to the day it opened on.
  const day = wraps && at < end ? (p.weekday + 6) % 7 : p.weekday;
  return window.days.includes(day);
}

const dayOk = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max;
/** The most days each month can have (February 29 in a leap year). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const dayList = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
const windowOk = (w: unknown): w is Window => {
  const x = w as Window;
  return !!x && typeof x === "object" && HHMM.test(String(x.start)) && HHMM.test(String(x.end)) && x.start !== x.end && (x.days === undefined || dayList(x.days));
};

/** Checks a timing from a job body; the zone is required and must be an IANA name. */
export function checkTiming(input: { schedule?: unknown; zone?: unknown; jitterSeconds?: unknown }): TimingCheck {
  if (input.zone === undefined || input.zone === null || input.zone === "") return { ok: false, code: "SCHEDULE_ZONE_REQUIRED", reason: "a job names its IANA time zone, e.g. Europe/London" };
  if (!validZone(input.zone)) return { ok: false, code: "SCHEDULE_ZONE_REQUIRED", reason: `${String(input.zone)} is not an IANA time zone` };
  const s = input.schedule as Schedule | undefined;
  const bad = (reason: string): TimingCheck => ({ ok: false, code: "SCHEDULE_INVALID", reason });
  if (!s || typeof s !== "object") return bad("schedule is required");
  switch (s.kind) {
    case "runonce":
      if (!LOCAL_DATETIME.test(String(s.at))) return bad("runonce.at is a local date and time, YYYY-MM-DDTHH:MM");
      break;
    case "interval":
      if (!Number.isInteger(s.every) || s.every < MIN_EVERY_MINUTES || s.every > 7 * 1440) return bad(`interval.every is whole minutes from ${MIN_EVERY_MINUTES} to a week`);
      if (s.window !== undefined && !windowOk(s.window)) return bad("interval.window has start and end as HH:MM and optional days 0-6");
      if (s.outside !== undefined && s.outside !== null && (!Number.isInteger(s.outside) || s.outside < MIN_EVERY_MINUTES || s.outside > 7 * 1440)) return bad("interval.outside is whole minutes, or null for no runs outside the window");
      if (s.outside !== undefined && s.window === undefined) return bad("interval.outside needs a window");
      break;
    case "daily":
      if (!HHMM.test(String(s.at))) return bad("daily.at is HH:MM");
      break;
    case "weekly":
      if (!HHMM.test(String(s.at)) || !dayList(s.days)) return bad("weekly takes days 0-6 and at HH:MM");
      break;
    case "monthly":
      if (!HHMM.test(String(s.at)) || !dayOk(s.day, 31)) return bad("monthly takes day 1-31 and at HH:MM");
      break;
    case "yearly":
      if (!HHMM.test(String(s.at)) || !dayOk(s.month, 12) || !dayOk(s.day, MONTH_DAYS[s.month - 1] ?? 0)) return bad("yearly takes month 1-12, a day that month has, and at HH:MM");
      break;
    default:
      return bad("schedule.kind is runonce, interval, daily, weekly, monthly or yearly");
  }
  const jitter = input.jitterSeconds;
  if (jitter !== undefined && (!Number.isInteger(jitter) || (jitter as number) < 0)) return bad("jitter is whole seconds");
  return { ok: true, timing: { schedule: s, zone: input.zone, ...(jitter !== undefined ? { jitterSeconds: jitter as number } : {}) } };
}

/** The shortest gap between two occurrences, which bounds the jitter. */
function cadenceMs(s: Schedule): number {
  if (s.kind === "interval") return Math.min(s.every, s.outside ?? s.every) * MINUTE;
  if (s.kind === "monthly") return 28 * DAY;
  if (s.kind === "yearly") return 365 * DAY;
  return DAY;
}

const nextMultiple = (t: number, step: number) => (Math.floor(t / step) + 1) * step;

/** The first occurrence strictly after `after`, before jitter; null when there is none. */
export function nextSlotAfter(timing: Timing, after: number): number | null {
  const { schedule: s, zone } = timing;
  if (s.kind === "runonce") {
    const [, y, mo, d, h, mi] = LOCAL_DATETIME.exec(s.at)?.map(Number) ?? [];
    const at = fromZoned(y as number, mo as number, d as number, h as number, mi as number, zone);
    return at > after ? at : null;
  }
  if (s.kind === "interval") {
    const every = s.every * MINUTE;
    const limit = after + 8 * DAY;
    if (!s.window) return nextMultiple(after, every);
    let inside: number | null = null;
    for (let t = nextMultiple(after, every); t <= limit; t += every) {
      if (inWindow(t, s.window, zone)) {
        inside = t;
        break;
      }
    }
    let outside: number | null = null;
    if (s.outside) {
      const step = s.outside * MINUTE;
      for (let t = nextMultiple(after, step); t <= limit; t += step) {
        if (!inWindow(t, s.window, zone)) {
          outside = t;
          break;
        }
      }
    }
    if (inside === null) return outside;
    return outside === null ? inside : Math.min(inside, outside);
  }
  const at = minutesOf(s.at);
  const start = zoned(after, zone);
  if (s.kind === "monthly" || s.kind === "yearly") {
    // Months from the one `after` falls in: a year of months, or nine years for a yearly date.
    for (let i = 0; i <= (s.kind === "monthly" ? 13 : 9 * 12); i++) {
      const year = start.year + Math.floor((start.month - 1 + i) / 12);
      const month = ((start.month - 1 + i) % 12) + 1;
      if (s.kind === "yearly" && month !== s.month) continue;
      const t = fromZoned(year, month, Math.min(s.day, daysIn(year, month)), Math.floor(at / 60), at % 60, zone);
      if (t > after) return t;
    }
    return null;
  }
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const t = fromZoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(at / 60), at % 60, zone);
    if (t <= after) continue;
    if (s.kind === "weekly" && !s.days.includes(zoned(t, zone).weekday)) continue;
    return t;
  }
  return null;
}

/** The latest occurrence at or before `now` and after `last`: the one a late alarm runs; earlier ones are skipped. */
export function dueSlot(timing: Timing, now: number, last: number | null): number | null {
  const floor = Math.max(last ?? Number.NEGATIVE_INFINITY, now - Math.max(cadenceMs(timing.schedule), DAY) * 2);
  let due: number | null = null;
  let t = nextSlotAfter(timing, Number.isFinite(floor) ? floor : now - DAY * 2);
  while (t !== null && t <= now) {
    if (last === null || t > last) due = t;
    t = nextSlotAfter(timing, t);
  }
  return due;
}

/** The job's jitter for a slot: a stable fraction of its jitter seconds, under half the cadence. */
export function jitterMs(timing: Timing, jobId: string, slot: number): number {
  const max = Math.min((timing.jitterSeconds ?? 0) * 1000, cadenceMs(timing.schedule) / 2);
  if (max <= 0) return 0;
  let h = 2166136261;
  for (const ch of `${jobId}:${slot}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % Math.floor(max);
}

/** How the cadence is said to a person (B18): honest about the interval, never "instantly". */
export function describeCadence(timing: Timing): string {
  const s = timing.schedule;
  const mins = (n: number) => (n % 1440 === 0 ? `${n / 1440} day${n === 1440 ? "" : "s"}` : n % 60 === 0 ? `${n / 60} hour${n === 60 ? "" : "s"}` : `${n} minutes`);
  const zone = timing.zone;
  switch (s.kind) {
    case "runonce":
      return `once, at ${s.at.replace("T", " ")} (${zone})`;
    case "daily":
      return `every day at ${s.at} (${zone})`;
    case "monthly":
      return `every month on day ${s.day} at ${s.at} (${zone})${s.day > 28 ? ", or the month's last day when it is shorter" : ""}`;
    case "yearly":
      return `every year on ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][s.month - 1]} ${s.day} at ${s.at} (${zone})${s.month === 2 && s.day === 29 ? ", or February 28 in a year without the 29th" : ""}`;
    case "weekly":
      return `every week on ${s.days.map((d) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]).join(", ")} at ${s.at} (${zone})`;
    case "interval": {
      const base = `every ${mins(s.every)}`;
      if (!s.window) return `${base}, so a change can take up to ${mins(s.every)} to be noticed`;
      const win = `${s.window.start}-${s.window.end}${s.window.days ? ` on days ${s.window.days.join(",")}` : ""} (${zone})`;
      const out = s.outside ? `every ${mins(s.outside)} outside it` : "not at all outside it";
      return `${base} inside ${win} and ${out}, so a change can take up to ${mins(Math.max(s.every, s.outside ?? s.every))} to be noticed${s.outside ? "" : ", and none outside the window until it reopens"}`;
    }
  }
}
