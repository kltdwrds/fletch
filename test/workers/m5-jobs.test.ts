// M5.1: the Job engine through the object harness, the real Ledger, Chat engine, egress module and
// adapter, with the store's rows backdated by the clock the test owns and every alarm fired
// explicitly. Fixture people are Sam Solo and Pat of solo-sam.
import { describe, expect, it } from "vitest";
import { AUTO_DISABLE_AFTER, BACKOFF_AFTER, PROBE_MS, RUN_MAX_ATTEMPTS } from "../../packages/agent/src/jobs/engine.ts";
import type { StepHandler } from "../../packages/agent/src/jobs/steps.ts";
import { ada, jobWorld, PAGE, watchBody } from "./support/job-world.ts";

/** Fixture steps that count their invocations. */
function counted(names: string[], during?: (name: string, n: number) => void) {
  const calls: Record<string, number> = {};
  const steps: Record<string, StepHandler> = {};
  for (const name of names) {
    steps[`fixture:${name}`] = async (_spec, ctx) => {
      calls[name] = (calls[name] ?? 0) + 1;
      during?.(name, calls[name]);
      return name === names.at(-1) ? { kind: "done", output: `${name} done`, notices: [`all steps done for ${ctx.runId}`] } : { kind: "done", output: `${name} done` };
    };
  }
  return { calls, steps };
}

describe("[M5.1] job gates and runs", () => {
  it("100 unchanged ticks make 0 model calls and 0 run rows, with the fake model's request count at 0", async () => {
    const w = jobWorld();
    w.claimChat();
    // An open gate would reach the model step: only the gate stands between a tick and a call.
    expect(await w.register(watchBody({ steps: [{ kind: "diff" }, { kind: "model" }, { kind: "notify" }] }))).toMatchObject({ ok: true, status: "active" });
    for (let i = 0; i < 100; i++) await w.tick();
    expect(w.page.hits).toBe(100);
    expect(w.status()?.ticks).toBe(100);
    expect(w.fake.requests).toHaveLength(0);
    expect(w.runs()).toHaveLength(0);
    expect(await w.ledger().runs()).toHaveLength(0);
    expect(await w.ledger().modelCalls()).toHaveLength(0);
    expect(w.outbox()).toHaveLength(0);
  });

  it("one change produces exactly one run and one outbox row, delivered once to the owner's chat", async () => {
    const w = jobWorld();
    const socket = w.chats.harness("chat-ada").connect();
    w.claimChat();
    await w.register(watchBody());
    await w.tick(); // baseline
    w.page.body = '{"title":"v2"}';
    await w.tick();
    for (let i = 0; i < 10; i++) await w.tick();
    const runs = w.runs();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ signal: "notify", phase: "done", manual: false });
    expect(w.outbox()).toEqual([expect.objectContaining({ state: "delivered", runId: runs[0]!.runId })]);
    expect(w.notices()).toHaveLength(1);
    expect(w.notices()[0]!.text).toContain(PAGE);
    expect(w.notices()[0]!.text).toContain('[BEGIN EXTERNAL CONTENT source="web:hacker-news.firebaseio.com"]');
    expect(socket.frames.filter((f) => f.type === "notice")).toHaveLength(1);
    expect(await w.ledger().runs()).toEqual([expect.objectContaining({ runId: runs[0]!.runId, signal: "notify", phase: "done", person: ada.email, scheduledFor: runs[0]!.scheduledFor })]);
    expect(w.audit.every((r) => r.purpose === "job:release-watch" && r.person === ada.email)).toBe(true);
  });

  it("run creation is idempotent on (job_id, scheduled_for)", async () => {
    const w = jobWorld();
    w.claimChat();
    await w.register(watchBody());
    await w.tick();
    w.page.body = '{"title":"v2"}';
    await w.tick();
    const slot = w.runs()[0]!.scheduledFor;
    const store = w.engine().store;
    // The run for that slot exists; creating it again is a no-op at the key.
    store.transaction(() => expect(store.createRun({ runId: `release-watch:${slot}`, jobId: "release-watch", scheduledFor: slot, manual: false, observed: {} }, w.clock.now)).toBe(false));
    expect(w.job.rows("SELECT COUNT(*) AS n FROM runs WHERE job_id = 'release-watch' AND scheduled_for = ?", slot)).toEqual([{ n: 1 }]);
    // The same slot's alarm fired again (the clock does not move) creates no second run.
    await w.job.instance.alarm();
    expect(w.runs().filter((r) => r.scheduledFor === slot)).toHaveLength(1);
  });

  it("redelivery is deduped: the same content is queued once and a resend after an unknown outcome shows once", async () => {
    const w = jobWorld();
    w.claimChat();
    await w.register(watchBody());
    await w.tick();
    for (const body of ['{"title":"v2"}', '{"title":"v1"}', '{"title":"v2"}']) {
      w.page.body = body;
      await w.tick();
    }
    // v1 -> v2 and v2 -> v1 are news; v2 again is content already delivered.
    expect(w.runs().map((r) => r.signal)).toEqual(["notify", "notify", "nothing_to_report"]);
    expect(w.outbox()).toHaveLength(2);
    expect(w.notices()).toHaveLength(2);
    // A row left `delivering` (the instance died after the chat took it) is checked, not resent.
    const row = w.outbox()[0]!;
    w.engine().store.transaction(() => w.engine().store.updateOutbox(row.id, { state: "delivering", next_attempt: 0 }));
    const before = w.notifyCalls.length;
    await w.job.instance.alarm();
    expect(w.notifyCalls.length).toBe(before);
    expect(w.outbox()[0]!.state).toBe("delivered");
    expect(w.notices()).toHaveLength(2);
  });

  it("three failures trip backoff and five trip auto-disable with the person told", async () => {
    const w = jobWorld();
    w.claimChat();
    await w.register(watchBody());
    w.page.status = 500;
    for (let i = 0; i < BACKOFF_AFTER; i++) await w.tick();
    expect(w.runs().map((r) => [r.signal, r.code])).toEqual(Array(BACKOFF_AFTER).fill(["failed", "GATE_HTTP_ERROR"]));
    const backoff = w.status()!.backoffUntil!;
    expect(backoff).toBeGreaterThan(w.clock.now);
    // Inside the backoff, occurrences are skipped: no fetch, no run.
    const hits = w.page.hits;
    while (w.clock.now < backoff - 10 * 60_000) await w.tick();
    expect(w.page.hits).toBe(hits);
    expect(w.status()!.skipped).toBeGreaterThan(0);
    while (w.status()!.status === "active") await w.tick();
    expect(w.runs().filter((r) => r.signal === "failed")).toHaveLength(AUTO_DISABLE_AFTER);
    expect(w.status()).toMatchObject({ status: "disabled", statusCode: "JOB_AUTO_DISABLED" });
    // The first failure is said once with its code (M25.6), the later ones are not repeated, and the turn-off is said.
    expect(w.notices().map((n) => n.text)).toEqual([expect.stringContaining("Release notes watch did not finish: GATE_HTTP_ERROR"), expect.stringContaining(`I turned off Release notes watch after ${AUTO_DISABLE_AFTER} failed runs in a row`)]);
    // Off means off: further alarms fetch nothing and run nothing.
    const after = w.page.hits;
    for (let i = 0; i < 5; i++) await w.engine().alarm();
    expect(w.page.hits).toBe(after);
    expect(w.job.alarmAt).toBeNull();
  });

  it("a failing step is retried with backoff up to three attempts, then the run fails", async () => {
    const w = jobWorld({ script: [{ status: 500 }, { status: 500 }, { status: 500 }] });
    w.claimChat();
    await w.define({ steps: [{ kind: "model" }, { kind: "notify" }] });
    await w.tick();
    const retries: number[] = [];
    while (w.engine().store.activeRun()) {
      const run = w.engine().store.activeRun()!;
      if (run.retryAt) retries.push(run.retryAt - w.clock.now);
      await w.tick();
    }
    expect(retries).toEqual([60_000, 120_000]);
    expect(w.fake.requests).toHaveLength(RUN_MAX_ATTEMPTS);
    expect(w.runs()[0]).toMatchObject({ signal: "failed", code: "MODEL_HTTP_500", attempt: RUN_MAX_ATTEMPTS });
    expect((await w.ledger().modelCalls()).map((c) => c.status)).toEqual(["http_error", "http_error", "http_error"]);
  });

  it("blocked sets a probe time and does not run until run now, which only the owner may say", async () => {
    const w = jobWorld();
    w.claimChat();
    await w.register(watchBody());
    await w.tick();
    w.page.status = 429;
    await w.tick();
    expect(w.runs().at(-1)).toMatchObject({ signal: "blocked", code: "GATE_RATE_LIMITED" });
    expect(w.runs().at(-1)!.nextProbe).toBe(w.clock.now + PROBE_MS);
    expect(w.status()).toMatchObject({ status: "blocked", nextProbe: w.clock.now + PROBE_MS });
    expect(w.notices()[0]!.text).toContain("stays paused until you say");
    w.page.status = 200;
    const hits = w.page.hits;
    for (let i = 0; i < 24; i++) await w.tick(); // a day of probes
    expect(w.page.hits).toBe(hits);
    expect(w.runs()).toHaveLength(1);
    expect(await w.engine().runNow(other.email)).toMatchObject({ ok: false, code: "JOB_NOT_OWNER" });
    const now = await w.engine().runNow(ada.email);
    expect(now).toMatchObject({ ok: true });
    await w.settle();
    expect(w.runs()).toHaveLength(2);
    expect(w.runs()[1]).toMatchObject({ manual: true, signal: "notify" });
    expect(w.status()!.status).toBe("active");
    // A run the person asked for always answers, even with no change.
    expect(w.notices().at(-1)!.text).toContain("no change since the last check");
  });

  it("a three-step run forced to evict between steps completes each step exactly once", async () => {
    const { calls, steps } = counted(["a", "b", "c"]);
    const w = jobWorld({ steps });
    w.claimChat();
    await w.define({ steps: [{ kind: "fixture:a" }, { kind: "fixture:b" }, { kind: "fixture:c" }] });
    await w.fire(); // the run is created and step a runs
    for (let i = 0; i < 3; i++) {
      w.job.evict();
      await w.fire();
    }
    await w.settle();
    expect(calls).toEqual({ a: 1, b: 1, c: 1 });
    expect(w.job.rows("SELECT step, state, attempts FROM steps ORDER BY step")).toEqual([
      { step: 0, state: "done", attempts: 1 },
      { step: 1, state: "done", attempts: 1 },
      { step: 2, state: "done", attempts: 1 },
    ]);
    expect(w.runs()[0]).toMatchObject({ signal: "notify", phase: "done" });
    expect(w.outbox()).toHaveLength(1);
    expect(w.notices()).toHaveLength(1);
  });

  it("a run evicted mid-step resumes from its lease and commits that step once", async () => {
    let w!: ReturnType<typeof jobWorld>;
    const { calls, steps } = counted(["a", "b"], (name, n) => {
      if (name === "b" && n === 1) w.job.evict();
    });
    w = jobWorld({ steps });
    w.claimChat();
    await w.define({ steps: [{ kind: "fixture:a" }, { kind: "fixture:b" }] });
    await w.fire();
    await expect(w.fire()).rejects.toMatchObject({ code: "EVICTED" });
    // The step was recorded running with a lease before the handler ran; its alarm resumes it.
    expect(w.job.rows("SELECT step, state FROM steps ORDER BY step")).toEqual([{ step: 0, state: "done" }, { step: 1, state: "running" }]);
    await w.fire();
    await w.settle();
    expect(calls).toEqual({ a: 1, b: 2 });
    expect(w.outbox()).toHaveLength(1);
    expect(w.notices()).toHaveLength(1);
    expect(w.runs()[0]!.signal).toBe("notify");
  });

  it("an approval-wait step completes on the owner's decision, and times out without one", async () => {
    const { steps } = counted(["compose", "unused"]);
    const w = jobWorld({ steps });
    w.claimChat();
    await w.define({ timing: { schedule: { kind: "daily", at: "09:00" }, zone: "Europe/London" }, steps: [{ kind: "fixture:compose" }, { kind: "approval", prompt: "Send it?", timeoutMinutes: 60 }, { kind: "notify" }] });
    await w.tick();
    const run = w.engine().store.activeRun()!;
    expect(run).toMatchObject({ phase: "awaiting_approval", step: 1 });
    expect(await w.engine().resolveApproval({ runId: run.runId, step: 1, approve: true, by: other.email })).toMatchObject({ ok: false, code: "JOB_NOT_OWNER" });
    expect(w.outbox()).toHaveLength(0);
    expect(await w.engine().resolveApproval({ runId: run.runId, step: 1, approve: true, by: ada.email })).toEqual({ ok: true });
    await w.settle();
    expect(w.runs()[0]).toMatchObject({ signal: "notify" });
    expect(w.notices()[0]!.text).toBe("compose done");
    // The next day's run waits, nobody decides, and the timeout ends it as failed.
    await w.tick();
    expect(w.engine().store.activeRun()!.phase).toBe("awaiting_approval");
    await w.tick();
    expect(w.runs()[1]).toMatchObject({ signal: "failed", code: "APPROVAL_TIMEOUT" });
  });

  it("an agent-registered job is disabled until its owner enables it", async () => {
    const w = jobWorld();
    w.claimChat();
    expect(await w.register(watchBody(), "qyvr:agent")).toMatchObject({ ok: true, status: "needs_enable" });
    expect(w.job.alarmAt).toBeNull();
    await w.engine().alarm();
    expect(w.page.hits).toBe(0);
    expect(await w.engine().enable(other.email)).toMatchObject({ ok: false, code: "JOB_NOT_OWNER" });
    expect(await w.engine().enable(ada.email)).toEqual({ ok: true });
    await w.tick();
    expect(w.page.hits).toBe(1);
  });

  it("a body in R2 is reconciled by hash: an edit applies at the next alarm, a broken edit needs attention and the person is told", async () => {
    const w = jobWorld();
    w.claimChat();
    await w.register(watchBody({ every: 10 }));
    const path = w.status()!.sourcePath!;
    await w.tick();
    await w.r2.put(path, watchBody({ every: 30 }), { customMetadata: { writer: ada.email } });
    await w.tick();
    expect(w.status()!.def.timing.schedule).toEqual({ kind: "interval", every: 30 });
    expect(w.status()!.cadence).toBe("every 30 minutes, so a change can take up to 30 minutes to be noticed");
    await w.r2.put(path, watchBody({ zone: null }), { customMetadata: { writer: ada.email } });
    await w.engine().alarm();
    expect(w.status()).toMatchObject({ status: "needs_attention", statusCode: "SCHEDULE_ZONE_REQUIRED" });
    await w.engine().alarm();
    expect(w.notices().map((n) => n.text)).toEqual([expect.stringContaining("needs your attention")]);
    // An edit written by the agent puts the job back to waiting for the owner.
    await w.r2.put(path, watchBody({ every: 15 }), { customMetadata: { writer: "qyvr:agent" } });
    await w.engine().alarm();
    expect(w.status()!.status).toBe("needs_enable");
  });

  it("refuses a body without an IANA zone", async () => {
    const w = jobWorld();
    expect(await w.register(watchBody({ zone: null }))).toMatchObject({ ok: false, code: "SCHEDULE_ZONE_REQUIRED" });
    expect(await w.register(watchBody({ zone: "GMT+1" }))).toMatchObject({ ok: false, code: "SCHEDULE_ZONE_REQUIRED" });
  });

  it("skips missed occurrences: an alarm three hours late runs once, for the latest slot", async () => {
    const { calls, steps } = counted(["a"]);
    const w = jobWorld({ steps });
    w.claimChat();
    await w.define({ steps: [{ kind: "fixture:a" }] });
    w.clock.now = w.job.alarmAt! + 3 * 3_600_000;
    await w.job.fireAlarm();
    await w.settle();
    expect(calls).toEqual({ a: 1 });
    expect(w.runs()).toHaveLength(1);
    expect(w.runs()[0]!.scheduledFor).toBe(Math.floor(w.clock.now / 600_000) * 600_000);
  });

  it("delivers only into the owner's own chat: a chat owned by another member refuses the notice", async () => {
    const w = jobWorld();
    w.claimChat("chat-ada", other.email);
    await w.register(watchBody());
    await w.tick();
    w.page.body = '{"title":"v2"}';
    await w.tick();
    expect(w.notices()).toHaveLength(0);
    expect(w.outbox()[0]).toMatchObject({ state: "pending", lastCode: "CHAT_NOT_OWNER" });
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
