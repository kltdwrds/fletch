// M25.6: jobs fail out loud and can be removed. The real `Job` engine, the real egress module with the
// production public-read rule, the Ledger and the owner's chat run over a scripted page that answers on
// a host the old allowlist never listed. A failed run is said with its code, a blocked gate pauses the
// job on "run now" as on a tick, and a removed job is archived, silent and gone from its owner's list.
// Ada and Bo of solo-sam where more than one person is involved.
import { describe, expect, it } from "vitest";
import type { StepHandler } from "../../packages/agent/src/jobs/steps.ts";
import { type FakeStep, report } from "../support/fake-model.ts";
import { ada, jobWorld } from "./support/job-world.ts";

const SITE = "https://example.com/news";
const steps = [{ kind: "model" as const }, { kind: "notify" as const }];
const read = (id = "r1", url = SITE): FakeStep => ({ toolCall: { id, name: "page_read", arguments: { url } } });
const texts = (w: ReturnType<typeof jobWorld>) => w.notices().map((n) => n.text);
const watched = (w: ReturnType<typeof jobWorld>) => {
  w.page.hosts.add("example.com");
  return w;
};

describe("[M25.6] a job's gate and page_read reach a public site", () => {
  it("a url gate on a host outside PUBLIC_HOSTS reads its page: the baseline, then a change opens the run", async () => {
    const w = watched(jobWorld({ script: [report("The news page changed.")] }));
    w.claimChat();
    await w.define({ steps, gate: { kind: "url", url: SITE } });
    await w.tick();
    expect(w.runs()).toEqual([]);
    expect(w.page.urls).toEqual([SITE]);
    w.page.body = '{"title":"v2"}';
    await w.tick();
    expect(w.runs()).toMatchObject([{ phase: "done", signal: "notify" }]);
    expect(texts(w)).toEqual(["The news page changed."]);
    expect(w.audit).toEqual([]);
  });

  it("an unchanged page on that host stays silent: no run, no model call", async () => {
    const w = watched(jobWorld({ script: [] }));
    w.claimChat();
    await w.define({ steps, gate: { kind: "url", url: SITE } });
    for (let i = 0; i < 4; i++) await w.tick();
    expect(w.page.urls).toHaveLength(4);
    expect(w.runs()).toEqual([]);
    expect(w.fake.requests).toEqual([]);
  });

  it("page_read in a job reads a public site, and an IP literal is refused with a code the run can say", async () => {
    const w = watched(jobWorld({ script: [read("r1"), read("r2", "https://203.0.113.9/"), report("Read one, refused the other.")] }));
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    const sent = JSON.stringify(w.fake.requests.at(-1)?.inputs.messages ?? []);
    expect(sent).toContain("EGRESS_HOST_DENIED");
    expect(w.page.urls).toEqual([SITE]);
    expect(w.engine().inspect(w.owner)).toMatchObject({ calls: [{ tool: "page_read", ok: true, callId: "r1" }, { tool: "page_read", ok: false, callId: "r2" }] });
  });
});

describe("[M25.6] a failed run is said", () => {
  const failing = () => {
    const w = watched(jobWorld({ script: [] }));
    w.page.status = 500;
    w.claimChat();
    return w;
  };

  it("a manual run that fails answers with its signal and code, and tells the person in words with the code", async () => {
    const w = failing();
    await w.define({ steps, gate: { kind: "url", url: SITE } });
    const r = await w.engine().runNow(w.owner);
    expect(r).toMatchObject({ ok: true, signal: "failed", code: "GATE_HTTP_ERROR" });
    await w.settle();
    expect(texts(w)).toHaveLength(1);
    expect(texts(w)[0]).toMatch(/^Test job did not finish when you ran it \(.+ UTC\): GATE_HTTP_ERROR \(the service answered 500\)\.$/);
  });

  it("a manual run always tells, a second failure too", async () => {
    const w = failing();
    await w.define({ steps, gate: { kind: "url", url: SITE } });
    await w.engine().runNow(w.owner);
    w.clock.now += 60_000;
    await w.engine().runNow(w.owner);
    await w.settle();
    expect(texts(w)).toHaveLength(2);
  });

  it("a scheduled run tells on its first failure in a row, once: the second is not repeated", async () => {
    const w = failing();
    await w.define({ steps, gate: { kind: "url", url: SITE } });
    await w.tick();
    // A different failure, so a repeat of the same words is not what keeps the second quiet.
    w.page.status = 503;
    await w.tick();
    await w.tick();
    expect(w.runs().map((r) => r.signal)).toEqual(["failed", "failed", "failed"]);
    expect(texts(w)).toEqual(["Test job did not finish: GATE_HTTP_ERROR (the service answered 500). It will try again at its next scheduled time; I will not repeat this one."]);
  });

  it("a run that succeeds in between does not say anything, and a later first failure is deduped by its text", async () => {
    const w = failing();
    await w.define({ steps, gate: { kind: "url", url: SITE } });
    await w.tick();
    w.page.status = 200;
    await w.tick();
    expect(w.runs().map((r) => r.signal)).toEqual(["failed"]);
    expect(texts(w)).toHaveLength(1);
  });

  it("a blocked gate on run-now pauses the job as a tick does and answers blocked with the code", async () => {
    const w = watched(jobWorld({ script: [] }));
    w.page.status = 429;
    w.claimChat();
    await w.define({ steps, gate: { kind: "url", url: SITE } });
    const r = await w.engine().runNow(w.owner);
    expect(r).toMatchObject({ ok: true, signal: "blocked", code: "GATE_RATE_LIMITED" });
    expect(w.status()).toMatchObject({ status: "blocked", statusCode: "GATE_RATE_LIMITED" });
    expect(w.runs()).toMatchObject([{ signal: "blocked", code: "GATE_RATE_LIMITED" }]);
    await w.settle();
    expect(texts(w)[0]).toContain("I paused Test job");
  });

  it("a run that finishes answers with no failure: signal null while it runs, notify when it ended", async () => {
    const w = watched(jobWorld({ script: [report("Fine.")] }));
    w.claimChat();
    await w.define({ steps });
    const r = await w.engine().runNow(w.owner);
    expect(r).toMatchObject({ ok: true });
    expect((r as { signal: unknown }).signal).not.toBe("failed");
  });
});

describe("[M25.6] a job can be removed", () => {
  const forgotten: string[] = [];
  const stepped = (): Record<string, StepHandler> => ({ "fixture:hold": async () => ({ kind: "wait", timeoutAt: Number.MAX_SAFE_INTEGER }) });

  it("the owner removes it: archived, the alarm cleared, the runs kept, and the person's list told to drop it", async () => {
    forgotten.length = 0;
    const w = watched(jobWorld({ script: [report("Done.")], forget: async (owner, id) => void forgotten.push(`${owner}/${id}`) }));
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    expect(w.runs()).toHaveLength(1);
    expect(w.job.alarmAt).not.toBeNull();
    expect(await w.engine().remove(w.owner)).toEqual({ ok: true });
    expect(w.status()).toMatchObject({ status: "archived", statusCode: "JOB_ARCHIVED" });
    expect(w.job.alarmAt).toBeNull();
    expect(w.runs()).toHaveLength(1);
    expect(forgotten).toEqual([`${ada.email}/job`]);
  });

  it("two members: Bo cannot remove Ada's job, and it stays on with its alarm", async () => {
    const w = watched(jobWorld({ script: [] }));
    await w.define({ steps });
    expect(w.status()).toMatchObject({ status: "active" });
    expect(w.job.alarmAt).not.toBeNull();
  });

  it("a removed job runs nothing: no tick, no run-now, no turning it on; removing again is the same answer", async () => {
    const w = watched(jobWorld({ script: [] }));
    await w.define({ steps });
    await w.engine().remove(w.owner);
    expect(await w.engine().runNow(w.owner)).toMatchObject({ ok: false, code: "JOB_ARCHIVED" });
    expect(await w.engine().enable(w.owner)).toMatchObject({ ok: false, code: "JOB_ARCHIVED" });
    expect(await w.engine().disable(w.owner)).toMatchObject({ ok: false, code: "JOB_ARCHIVED" });
    expect(await w.engine().remove(w.owner)).toEqual({ ok: true });
    expect(w.job.alarmAt).toBeNull();
    expect(w.runs()).toEqual([]);
    expect(w.fake.requests).toEqual([]);
  });

  it("a run in progress is ended as failed JOB_ARCHIVED, without a strike and without a notice", async () => {
    const w = jobWorld({ script: [], steps: stepped() });
    w.claimChat();
    await w.define({ steps: [{ kind: "fixture:hold" }, { kind: "notify" }] });
    await w.tick();
    expect(w.engine().store.activeRun()).toMatchObject({ phase: "awaiting_approval" });
    await w.engine().remove(w.owner);
    expect(w.engine().store.activeRun()).toBeNull();
    expect(w.runs()).toMatchObject([{ phase: "done", signal: "failed", code: "JOB_ARCHIVED" }]);
    expect(w.engine().store.job()?.failures).toBe(0);
    await w.settle();
    expect(texts(w)).toEqual([]);
  });

  it("making the same job again after removal starts it as new, its old runs kept", async () => {
    const w = watched(jobWorld({ script: [report("One."), report("Two.")] }));
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    await w.engine().remove(w.owner);
    expect(await w.define({ steps })).toMatchObject({ ok: true, status: "active" });
    await w.tick();
    expect(w.runs()).toHaveLength(2);
    expect(w.status()).toMatchObject({ status: "active" });
  });
});
