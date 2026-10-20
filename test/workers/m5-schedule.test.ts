// M5.1: schedules (kinds, window tiering, zone, jitter, missed slots) and the four gates, pure, with
// the clock passed in and the network a scripted egress answer.
import { describe, expect, it } from "vitest";
import type { EgressResult } from "../../packages/agent/src/egress/module.ts";
import { evaluateGate, type Gate } from "../../packages/agent/src/jobs/gates.ts";
import { checkTiming, describeCadence, dueSlot, jitterMs, nextSlotAfter, type Timing } from "../../packages/agent/src/jobs/schedule.ts";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const London = (s: Timing["schedule"], jitterSeconds?: number): Timing => ({ schedule: s, zone: "Europe/London", ...(jitterSeconds ? { jitterSeconds } : {}) });

describe("[M5.1] schedules", () => {
  it("computes runonce, interval, daily and weekly occurrences in the job's zone", () => {
    expect(iso(nextSlotAfter(London({ kind: "runonce", at: "2026-10-14T09:30" }), at("2026-10-13T08:00:00Z")))).toBe("2026-10-14T08:30:00.000Z");
    expect(nextSlotAfter(London({ kind: "runonce", at: "2026-10-14T09:30" }), at("2026-10-14T08:30:00Z"))).toBeNull();
    expect(iso(nextSlotAfter(London({ kind: "interval", every: 10 }), at("2026-10-13T08:03:00Z")))).toBe("2026-10-13T08:10:00.000Z");
    expect(iso(nextSlotAfter(London({ kind: "daily", at: "07:00" }), at("2026-10-13T08:00:00Z")))).toBe("2026-10-14T06:00:00.000Z");
    // Across the end of British Summer Time (25 October 2026), 07:00 local moves from 06:00 to 07:00 UTC.
    expect(iso(nextSlotAfter(London({ kind: "daily", at: "07:00" }), at("2026-10-25T05:00:00Z")))).toBe("2026-10-25T07:00:00.000Z");
    expect(iso(nextSlotAfter({ schedule: { kind: "weekly", days: [1], at: "09:00" }, zone: "America/New_York" }, at("2026-10-13T08:00:00Z")))).toBe("2026-10-19T13:00:00.000Z");
  });

  it("tiers the cadence by window: every 10 minutes inside 09:00-17:00 on weekdays, hourly outside, or not at all", () => {
    const window = { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] };
    const tiered = London({ kind: "interval", every: 10, window, outside: 60 });
    expect(iso(nextSlotAfter(tiered, at("2026-10-13T08:05:00Z")))).toBe("2026-10-13T08:10:00.000Z"); // 09:10 local, inside
    expect(iso(nextSlotAfter(tiered, at("2026-10-13T16:05:00Z")))).toBe("2026-10-13T17:00:00.000Z"); // 18:00 local, hourly
    expect(iso(nextSlotAfter(tiered, at("2026-10-17T10:05:00Z")))).toBe("2026-10-17T11:00:00.000Z"); // Saturday, hourly
    const insideOnly = London({ kind: "interval", every: 10, window });
    expect(iso(nextSlotAfter(insideOnly, at("2026-10-16T16:05:00Z")))).toBe("2026-10-19T08:00:00.000Z"); // Friday 17:05 -> Monday 09:00
  });

  it("requires an IANA zone and refuses malformed schedules with a code", () => {
    expect(checkTiming({ schedule: { kind: "daily", at: "07:00" } })).toMatchObject({ ok: false, code: "SCHEDULE_ZONE_REQUIRED" });
    expect(checkTiming({ schedule: { kind: "daily", at: "07:00" }, zone: "Mars/Olympus" })).toMatchObject({ ok: false, code: "SCHEDULE_ZONE_REQUIRED" });
    expect(checkTiming({ schedule: { kind: "interval", every: 1 }, zone: "UTC" })).toMatchObject({ ok: false, code: "SCHEDULE_INVALID" });
    expect(checkTiming({ schedule: { kind: "interval", every: 10, outside: 60 }, zone: "UTC" })).toMatchObject({ ok: false, code: "SCHEDULE_INVALID" });
    expect(checkTiming({ schedule: { kind: "hourly" }, zone: "UTC" })).toMatchObject({ ok: false, code: "SCHEDULE_INVALID" });
    expect(checkTiming({ schedule: { kind: "weekly", days: [1, 3], at: "09:00" }, zone: "Asia/Tokyo", jitterSeconds: 30 })).toMatchObject({ ok: true });
  });

  it("jitters each slot by a stable amount under half the cadence", () => {
    const t = London({ kind: "interval", every: 10 }, 3_600);
    const values = Array.from({ length: 50 }, (_, i) => jitterMs(t, "release-watch", T(i)));
    expect(values.every((v) => v >= 0 && v < 5 * 60_000)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(10);
    expect(jitterMs(t, "release-watch", T(3))).toBe(values[3]);
    expect(jitterMs(London({ kind: "interval", every: 10 }), "release-watch", T(3))).toBe(0);
  });

  it("skips missed occurrences: the due slot is the latest one, once", () => {
    const t = London({ kind: "interval", every: 10 });
    const last = at("2026-10-13T08:00:00Z");
    expect(iso(dueSlot(t, at("2026-10-13T11:04:00Z"), last))).toBe("2026-10-13T11:00:00.000Z");
    expect(dueSlot(t, at("2026-10-13T11:04:00Z"), at("2026-10-13T11:00:00Z"))).toBeNull();
  });

  it("describes cadence honestly, never as instant detection (B18)", () => {
    const phrases = [
      describeCadence(London({ kind: "interval", every: 30 })),
      describeCadence(London({ kind: "interval", every: 10, window: { start: "09:00", end: "17:00" } })),
      describeCadence(London({ kind: "daily", at: "07:00" })),
    ];
    expect(phrases[0]).toBe("every 30 minutes, so a change can take up to 30 minutes to be noticed");
    expect(phrases[1]).toContain("none outside the window until it reopens");
    for (const p of phrases) expect(p).not.toMatch(/instant|immediately|real[- ]time|the moment/i);
  });
});

function T(i: number) {
  return at("2026-10-13T08:00:00Z") + i * 600_000;
}

const answer = (status: number, body = "", headers: Array<[string, string]> = []): EgressResult => ({ ok: true, status, headers, body });
const gateDeps = (r: EgressResult | ((h: Array<[string, string]>) => EgressResult), now = at("2026-10-13T08:00:00Z")) => ({
  now: () => now,
  zone: "Europe/London",
  get: async (_url: string, h: Array<[string, string]>) => (typeof r === "function" ? r(h) : r),
});

describe("[M5.1] gates", () => {
  const url: Gate = { kind: "url", url: "https://hacker-news.firebaseio.com/v0/item/1.json" };

  it("the url gate sets a baseline, stays closed on the same hash or a 304, and opens on a change", async () => {
    const first = await evaluateGate(url, {}, gateDeps(answer(200, "a", [["etag", '"e1"']])));
    expect(first).toMatchObject({ open: false, why: "baseline", state: { etag: '"e1"' } });
    const state = (first as { state: object }).state;
    let sent: Array<[string, string]> = [];
    expect(await evaluateGate(url, state, gateDeps((h) => {
      sent = h;
      return answer(304);
    }))).toMatchObject({ open: false, why: "unchanged" });
    expect(sent).toEqual([["if-none-match", '"e1"']]);
    expect(await evaluateGate(url, state, gateDeps(answer(200, "a")))).toMatchObject({ open: false, why: "unchanged" });
    expect(await evaluateGate(url, state, gateDeps(answer(200, "b")))).toMatchObject({ open: true, observed: { excerpt: "b" } });
  });

  it("a refused or failed read is an error with a code, never an unchanged page; 429 and 403 are blocks", async () => {
    expect(await evaluateGate(url, {}, gateDeps({ ok: false, code: "EGRESS_HOST_DENIED", reason: "no", host: "x" } as EgressResult))).toMatchObject({ open: false, error: { code: "GATE_FETCH_REFUSED", blocked: false } });
    expect(await evaluateGate(url, {}, gateDeps(answer(500)))).toMatchObject({ error: { code: "GATE_HTTP_ERROR", blocked: false } });
    expect(await evaluateGate(url, {}, gateDeps(answer(429)))).toMatchObject({ error: { code: "GATE_RATE_LIMITED", blocked: true } });
    expect(await evaluateGate(url, {}, gateDeps(answer(403)))).toMatchObject({ error: { code: "GATE_BLOCKED_BY_SERVICE", blocked: true } });
  });

  it("the watermark gate opens only when the number rises", async () => {
    const g: Gate = { kind: "watermark", url: "https://hacker-news.firebaseio.com/v0/maxitem.json" };
    expect(await evaluateGate(g, {}, gateDeps(answer(200, "100")))).toMatchObject({ open: false, why: "baseline", state: { watermark: 100 } });
    expect(await evaluateGate(g, { watermark: 100 }, gateDeps(answer(200, "100")))).toMatchObject({ open: false, why: "below_watermark" });
    expect(await evaluateGate(g, { watermark: 100 }, gateDeps(answer(200, "104")))).toMatchObject({ open: true, observed: { before: 100, after: 104 }, state: { watermark: 104 } });
    expect(await evaluateGate(g, { watermark: 100 }, gateDeps(answer(200, '"x"')))).toMatchObject({ error: { code: "GATE_NOT_A_NUMBER" } });
  });

  it("the threshold gate opens on crossing into the condition and stays closed while it holds", async () => {
    const g: Gate = { kind: "threshold", url: "https://hacker-news.firebaseio.com/v0/item/1.json", pointer: "/score", above: 50 };
    expect(await evaluateGate(g, {}, gateDeps(answer(200, '{"score":40}')))).toMatchObject({ open: false, why: "condition_false", state: { inside: false } });
    expect(await evaluateGate(g, { inside: false }, gateDeps(answer(200, '{"score":60}')))).toMatchObject({ open: true, observed: { after: 60 } });
    expect(await evaluateGate(g, { inside: true }, gateDeps(answer(200, '{"score":70}')))).toMatchObject({ open: false, why: "condition_held" });
  });

  it("the window gate reads the injected clock in the job's zone", async () => {
    const g: Gate = { kind: "window", window: { start: "09:00", end: "17:00" } };
    expect(await evaluateGate(g, {}, gateDeps(answer(200), at("2026-10-13T08:30:00Z")))).toMatchObject({ open: true }); // 09:30 BST
    expect(await evaluateGate(g, {}, gateDeps(answer(200), at("2026-10-13T07:30:00Z")))).toMatchObject({ open: false, why: "outside_window" });
  });
});
