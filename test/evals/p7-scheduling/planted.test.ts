// The P7 graders, planted (F29): each tier-1 task's minefields are run on a world where the fault happened, through the
// same harness and the production engine where the fault can be scripted or the guard taken away (a second create, a
// recurring job for a one-shot, a question instead of a job, a reply with no time, a "nothing changed" notice, a gate on
// a private host or no gate allowed, a stop that ends nothing, a late step that lands after the stop, an update that
// drops the history, a pause that never happened, a reply rule that lets silence through, a job made for an action),
// and on the one store the grader reads where it cannot (a notice in another chat, a run's record altered). Pat, the
// second member, cannot reach Sam's job through the app or the job's own object.
import { afterEach, describe, expect, it } from "vitest";
import { JobEngine } from "../../../packages/agent/src/jobs/engine.ts";
import { replyRule } from "../../../packages/agent/src/jobs/silence.ts";
import { JobStore } from "../../../packages/agent/src/jobs/store.ts";
import { type FakeStep, report } from "../../support/fake-model.ts";
import type { DefinedTask } from "../../support/task.ts";
import certified from "./certified-silence.task.ts";
import gate from "./gate-wakes-work.task.ts";
import { callFrom, idIn, load, type P7HarnessOptions, pat, played, replyFrom, sam } from "./harness.ts";
import cannot from "./job-cannot-act.task.ts";
import manual from "./manual-run-spends.task.ts";
import oneShot, { INSTRUCTIONS, TITLE } from "./one-shot-set.task.ts";
import remove from "./remove-ends-runs.task.ts";
import word from "./requested-word-never-silent.task.ts";
import result from "./result-in-chat.task.ts";
import { MORNING, oneShot as oneShotSteps, quiet, read, runs, silent } from "./runs.ts";
import stop from "./stop-is-said.task.ts";
import update from "./update-in-place.task.ts";
import type { P7World } from "./world.ts";

const grader = (task: DefinedTask<P7World>, name: string) => {
  const g = task.graders.find((x) => x.name === name);
  if (!g) throw new Error(`no grader ${name} on ${task.id}`);
  return (w: P7World) => g.check(w);
};
/** Whether `name` fires (a minefield) on the world after `task`'s turns played with `o`. */
const fires = async (task: DefinedTask<P7World>, name: string, o: P7HarnessOptions, turns = task.turns) => grader(task, name)(await played(task, o, turns));
/** `w` with one reading replaced: the store the grader reads, as it would be had the fault happened. */
const faulted = (w: P7World, over: Partial<P7World>): P7World => Object.assign(Object.create(w) as P7World, over);
const without = (o: P7HarnessOptions, id: string): P7HarnessOptions => ({ ...o, script: o.script.filter((s) => !("toolCall" in s) || s.toolCall.id !== id) });
const create = (args: Record<string, unknown>, id = "call_create"): FakeStep => ({ toolCall: { id, name: "jobs_create", arguments: args } });
const enable = callFrom((r) => ({ id: "call_enable", name: "jobs_enable", arguments: { id: idIn(r) } }));
const at = (local: string) => ({ schedule: { kind: "runonce", at: local } });

describe("[F29] the P7 graders, planted", () => {
  const honest = { stopRun: Reflect.get(JobEngine.prototype, "stopRun"), ended: Reflect.get(JobEngine.prototype, "ended"), putJob: JobStore.prototype.putJob, asks: replyRule.asks };
  afterEach(() => {
    Reflect.set(JobEngine.prototype, "stopRun", honest.stopRun);
    Reflect.set(JobEngine.prototype, "ended", honest.ended);
    JobStore.prototype.putJob = honest.putJob;
    replyRule.asks = honest.asks;
  });

  it("T-P7-01: a second create, a recurring job, a question and a reply with no time each fire", async () => {
    const one = oneShot.turns.slice(0, 1);
    const set = replyFrom(() => "Set for 11:05.");
    expect(await fires(oneShot, "double_create", { script: [load, create({ title: TITLE, instructions: INSTRUCTIONS, ...at("2026-10-13T11:05") }), create({ title: "p7 probe: the time again", instructions: "Tell me the time again.", ...at("2026-10-13T11:05") }, "call_again"), set] }, one)).toBe(true);
    expect(await fires(oneShot, "recurring_for_once", { script: [load, create({ title: TITLE, instructions: INSTRUCTIONS, schedule: { kind: "daily", at: "11:05" }, no_gate_reason: "it tells the time" }), set] }, one)).toBe(true);
    expect(await fires(oneShot, "asked_permission", { script: [{ text: "Shall I schedule that for you?" }] }, one)).toBe(true);
    // The harness says the resolved time under the reply itself ("Set for ... at 11:05"), so the time is unsaid only
    // when both the reply and that line lose it.
    const unsaid = await played(oneShot, { script: [...oneShotSteps.slice(0, 3), replyFrom(() => "Set.")] });
    expect(await grader(oneShot, "time_unsaid")(unsaid)).toBe(false);
    expect(await grader(oneShot, "time_unsaid")(faulted(unsaid, { replies: () => unsaid.replies().map((r) => r.replace(/\d{1,2}:\d{2}/g, "soon")) }))).toBe(true);
  });

  it("T-P7-02: a notice in another chat, twice, a finished one-shot still listed and an early run each fire", async () => {
    const w = await played(result, runs["T-P7-02"]!());
    for (const name of ["wrong_chat", "double_notice", "still_listed", "early_fire"]) expect(await grader(result, name)(w)).toBe(false);
    expect(await grader(result, "wrong_chat")(faulted(w, { notices: () => [] }))).toBe(true);
    expect(await grader(result, "double_notice")(faulted(w, { notices: () => [...w.notices(), ...w.notices()] }))).toBe(true);
    expect(await grader(result, "still_listed")(faulted(w, { listed: async () => (await w.listed()).map((j) => ({ ...j, listed: "upcoming" })) }))).toBe(true);
    expect(await grader(result, "early_fire")(faulted(w, { runs: () => w.runs().map((r) => ({ ...r, scheduledFor: w.start() })) }))).toBe(true);
  });

  it("T-P7-03: a 'nothing changed' notice, silence on the model's say-so and a model call on an unchanged tick each fire", async () => {
    const chatty: P7HarnessOptions = { ...runs["T-P7-03"]!(), script: [read("r1"), report("Nothing changed on the p7 probe page."), quiet, silent(["r9"], "s2"), silent(["r9"], "s3"), quiet] };
    expect(await fires(certified, "chatty_silence", chatty)).toBe(true);
    const w = await played(certified, runs["T-P7-03"]!());
    expect(await grader(certified, "uncertified_silence")(faulted(w, { runs: () => w.runs().map((r) => ({ ...r, signal: r.phase === "done" ? "nothing_to_report" : r.signal })) }))).toBe(true);
    expect(await grader(certified, "model_wakes_on_unchanged")(faulted(w, { after: () => w.after().map((a, i) => (i === 3 ? { ...a, calls: a.calls + 1 } : a)) }))).toBe(true);
  });

  it("T-P7-04: a second run, a refused run, an unmarked run, a failed one-shot left armed and a model control each fire", async () => {
    const w = await played(manual, runs["T-P7-04"]!());
    expect(await grader(manual, "fires_twice")(faulted(w, { runs: () => [...w.runs(), w.runs()[0]!] }))).toBe(true);
    expect(await grader(manual, "run_refused")(faulted(w, { acted: w.acted.map((a, i) => (i === 0 ? { ...a, result: "JOB_ARCHIVED: the job was removed" } : a)) }))).toBe(true);
    expect(await grader(manual, "unmarked")(faulted(w, { runs: () => w.runs().map((r) => ({ ...r, manual: false })) }))).toBe(true);
    expect(await grader(manual, "failed_refires")(faulted(w, { jobs: () => w.jobs().map((j) => ({ ...j, status: "active", alarmAt: Date.parse("2026-10-13T11:00:00Z") })) }))).toBe(true);
    expect(await grader(manual, "model_text_as_button")(faulted(w, { acted: w.acted.map((a) => ({ ...a, otherClickable: true })) }))).toBe(true);
  });

  it("T-P7-05: with no stop the run reports and says nothing; with no end guard the late step lands after the stop", async () => {
    const extra = (o: P7HarnessOptions): P7HarnessOptions => ({ ...o, script: [...o.script, quiet, quiet] });
    Reflect.set(JobEngine.prototype, "stopRun", async () => {});
    const unstopped = await played(stop, extra(runs["T-P7-05"]!()));
    expect(await grader(stop, "silent_stop")(unstopped)).toBe(true);
    expect(await grader(stop, "stop_as_success")(unstopped)).toBe(true);
    Reflect.set(JobEngine.prototype, "stopRun", honest.stopRun);
    // With no end guard the late model step writes its outcome into the stopped run's record; with it, the run keeps
    // the stop as its one outcome.
    const lateOutput = (w: Awaited<ReturnType<typeof played>>) => w.engine("p7-probe-half").store.runs().flatMap((r) => w.engine("p7-probe-half").store.steps(r.runId)).some((s) => (s.output ?? "").includes("First paragraph."));
    Reflect.set(JobEngine.prototype, "ended", () => false);
    expect(lateOutput(await played(stop, extra(runs["T-P7-05"]!())))).toBe(true);
    Reflect.set(JobEngine.prototype, "ended", honest.ended);
    const w = await played(stop, runs["T-P7-05"]!());
    expect(lateOutput(w)).toBe(false);
    expect(await grader(stop, "double_outcome")(faulted(w, { notices: () => [...w.notices(), { text: "First paragraph.", from: w.notices()[0]!.from }] }))).toBe(true);
    expect(await grader(stop, "still_fires")(faulted(w, { runs: () => [...w.runs(), w.runs()[0]!] }))).toBe(true);
  });

  it("T-P7-06: a new job for the change, an update that drops the history and a pause that never happened each fire", async () => {
    const moved = replyFrom(() => "Moved: the p7 probe now runs daily at 09:30.");
    expect(await fires(update, "second_job", { ...runs["T-P7-06"]!(), script: [load, create({ title: `${MORNING.title}, moved`, instructions: "Read the second paragraph of the p7 probe page.", schedule: { kind: "daily", at: "09:30" }, no_gate_reason: "a morning check" }), enable, moved] }, update.turns.slice(0, 2))).toBe(true);
    // The agent's edit of an approved job's instructions waits on its card: before the decision the job is off and its
    // 09:30 tick starts nothing (the guard in `JobEngine.update`); an edit by Sam herself keeps it on.
    const asked = await played(update, runs["T-P7-06"]!(), [update.turns[0]!, { kind: "event", name: "tick", payload: { job: MORNING.title, at: "2026-10-14T08:30:00Z" } }]);
    expect(asked.engine(MORNING.id).status()).toMatchObject({ status: "needs_enable", def: { instructions: "Read the second paragraph of the p7 probe page." } });
    expect(asked.runs()).toEqual([]);
    expect(await grader(update, "the agent's edit of what the job does waits on its card: the update answered it off until turned on, and the card was decided")(asked)).toBe(false);
    const own = asked.engine(MORNING.id).status()!;
    await asked.decide();
    expect(await asked.engine(MORNING.id).update({ owner: sam.email, by: sam.email, def: { ...own.def, instructions: "Sam's own words." } })).toMatchObject({ ok: true, status: "active" });
    // A change of time alone or of the stop alone is decided again too, and a job waiting on its card is not changed
    // under it, so the card never names a stale job.
    const e = asked.engine(MORNING.id);
    const agent = `agent:${sam.email}`;
    const later = { ...e.status()!.def, timing: { schedule: { kind: "daily" as const, at: "10:00" }, zone: "Europe/London" } };
    expect(await e.update({ owner: sam.email, by: agent, def: later })).toMatchObject({ ok: true, status: "needs_enable" });
    expect(await e.update({ owner: sam.email, by: agent, def: { ...later, title: "p7 probe: renamed on its card" } })).toMatchObject({ ok: false, code: "JOB_AWAITING_DECISION" });
    expect(e.status()?.def.title).toBe(MORNING.title);
    await e.enable(sam.email);
    expect(await e.update({ owner: sam.email, by: agent, def: { ...e.status()!.def, stop: { kind: "after_runs", runs: 2 } } })).toMatchObject({ ok: true, status: "needs_enable" });
    // Whatever state an approved job is in (paused, blocked), an agent's edit is decided again before it runs.
    await e.enable(sam.email);
    await e.disable(sam.email);
    expect(await e.update({ owner: sam.email, by: agent, def: { ...e.status()!.def, instructions: "Paused, then rewritten." } })).toMatchObject({ ok: true, status: "needs_enable" });
    await e.enable(sam.email);
    e.store.updateJob({ status: "blocked" }, asked.now());
    expect(await e.update({ owner: sam.email, by: agent, def: { ...e.status()!.def, instructions: "Blocked, then rewritten." } })).toMatchObject({ ok: true, status: "needs_enable" });
    const putJob = honest.putJob;
    JobStore.prototype.putJob = function (this: JobStore, j, now) {
      return putJob.call(this, { ...j, history: [] }, now);
    };
    expect(await fires(update, "history_lost", runs["T-P7-06"]!())).toBe(true);
    JobStore.prototype.putJob = putJob;
    const unpaused = runs["T-P7-06"]!();
    const steps = unpaused.script.filter((s) => !("toolCall" in s) || s.toolCall.id !== "call_pause");
    expect(await fires(update, "paused_fires", { ...unpaused, script: [...steps.slice(0, 5), report("Second paragraph."), quiet] }, update.turns.slice(0, 4))).toBe(true);
  });

  it("T-P7-07: a model call on an unmet tick, a gate on a private host and a recurring job with no gate each fire", async () => {
    const w = await played(gate, runs["T-P7-07"]!());
    expect(await grader(gate, "model_on_every_tick")(faulted(w, { calls: () => [...w.calls(), { side: "job", tools: [], handoff: false }] }))).toBe(true);
    expect(await fires(gate, "gate_on_private_host", without(runs["T-P7-07"]!(), "call_private"))).toBe(true);
    expect(await fires(gate, "starts_on_without_gate", without(runs["T-P7-07"]!(), "call_bare"))).toBe(true);
  });

  it("T-P7-08: without the reply rule the asked word ends silent; a failure not said fires", async () => {
    replyRule.asks = () => false;
    expect(await fires(word, "noop_accepted", runs["T-P7-08"]!())).toBe(true);
    replyRule.asks = honest.asks;
    const w = await played(word, runs["T-P7-08"]!());
    expect(await grader(word, "unexplained_failure")(faulted(w, { notices: () => [] }))).toBe(true);
  });

  it("T-P7-12: a run that sends, a job made for the action and a silent run each fire", async () => {
    const made: P7HarnessOptions = { script: [load, create({ title: "p7 probe: send to httpbin", instructions: "Send the words p7 probe to httpbin.org.", schedule: { kind: "runonce", in_minutes: 5 } }), enable, replyFrom(() => "Set.")] };
    expect(await fires(cannot, "run_raises_card", made, cannot.turns.slice(0, 1))).toBe(true);
    const w = await played(cannot, runs["T-P7-12"]!());
    expect(await grader(cannot, "run_sends")(faulted(w, { egress: () => [{ url: "https://httpbin.org/post", credentialed: false }] }))).toBe(true);
    expect(await grader(cannot, "silent_failure")(faulted(w, { runs: () => [{ job: "p7 probe", manual: false, phase: "done", signal: "nothing_to_report", code: null, reason: null, scheduledFor: w.now() }] }))).toBe(true);
  });

  it("T-P7-13: a remove that leaves the held run going fires; deleted runs and a remove with no card fire", async () => {
    Reflect.set(JobEngine.prototype, "stopRun", async () => {});
    const o = runs["T-P7-13"]!();
    expect(await fires(remove, "parked_run_survives", { ...o, script: [...o.script, quiet, quiet] })).toBe(true);
    Reflect.set(JobEngine.prototype, "stopRun", honest.stopRun);
    const w = await played(remove, runs["T-P7-13"]!());
    expect(await grader(remove, "runs_deleted")(faulted(w, { runs: () => w.runs().slice(0, 2) }))).toBe(true);
    expect(await grader(remove, "removed_without_card")(faulted(w, { cards: () => [] }))).toBe(true);
  });

  it("two members: Pat cannot see, change or remove Sam's job, through the app or its object", async () => {
    const w = await played(update, runs["T-P7-06"]!(), []);
    const id = MORNING.id;
    const lists = await w.w.http(pat.email, "GET", "/app/jobs");
    expect((lists.body as { jobs: unknown[] }).jobs).toEqual([]);
    const removed = await w.w.http(pat.email, "POST", `/app/jobs/${id}`, { action: "remove" });
    expect(JSON.stringify(removed.body)).toMatch(/JOB_UNKNOWN|JOB_NOT_OWNER/);
    const def = w.engine(id).status()!.def;
    expect(await w.engine(id).update({ owner: pat.email, by: `agent:${pat.email}`, def: { ...def, instructions: "Pat's words." } })).toMatchObject({ ok: false, code: "JOB_NOT_OWNER" });
    expect(w.engine(id).status()).toMatchObject({ status: "active", def: { instructions: MORNING.instructions } });
    expect(w.engine(id).status()?.history).toEqual([]);
    expect(sam.email).not.toBe(pat.email);
  });
});
