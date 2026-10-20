// M15.7: jobs from chat. The agent registers a job through `jobs_create` (off), the person turns it
// on from one approval card (`jobs_enable`, an action the grants engine decides) or from the Jobs
// page, and the job's result comes back into the chat it was asked for in, through the owner's
// delivery. Every run is real: the chat engine with its gate and cards, the owner's `Person`
// authority and job index, the `Job` engine on the world's clock, the real Ledger, the fake model.
// Fixture people are Sam Solo and Bo Wren of solo-sam; the clock is the test's.
import { describe, expect, it } from "vitest";
import { JobEngine, type JobDeps } from "../../packages/agent/src/jobs/engine.ts";
import { deliveredNotices } from "../../packages/agent/src/jobs/notices.ts";
import { completeForJob } from "../../packages/agent/src/jobs/model.ts";
import { jobIdFor, MAX_JOBS } from "../../packages/agent/src/jobs/tools.ts";
import { type FakeStep, report } from "../support/fake-model.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld, T0 } from "./support/authority-world.ts";
import { deliveryWorld, ada as dAda, T0 as D0 } from "./support/delivery-world.ts";

const TITLE = "Push test";
const BODY = "Tell me: push test";
/** "In three minutes" from T0 (10:00 UTC), read in UTC: the chat has sent no zone. */
const AT = "2026-10-13T10:03";
const THREE = { kind: "runonce", in_minutes: 3 };

const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["jobs"] } } };
const create = (schedule: unknown = THREE, extra: Record<string, unknown> = {}, id = "c1"): FakeStep => ({
  // A recurring job names a gate or why it has none (M25.2).
  toolCall: { id, name: "jobs_create", arguments: { title: TITLE, instructions: BODY, schedule, ...((schedule as { kind?: string })?.kind === "runonce" ? {} : { no_gate_reason: "A reminder at a set time: there is nothing to watch." }), ...extra } },
});
const enable = (jobId: string, id = "e1"): FakeStep => ({ toolCall: { id, name: "jobs_enable", arguments: { id: jobId } } });

async function openChat(w: ReturnType<typeof authorityWorld>, person: string): Promise<string> {
  return ((await w.host(person).chats.open(w.clock.now)) as { chatId: string }).chatId;
}

describe("[M15.7] jobs from chat", () => {
  it("Ada asks for a message in three minutes: the job is registered off, her card appears, and once she approves the job runs once and its result lands in that chat", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await openChat(w, ada.email);
    const id = jobIdFor(TITLE, chat, { kind: "runonce", at: AT }, BODY);
    // The turn pauses on the card; once she decides it goes on by itself (M20.1) and says so, then the job's own call.
    w.fake.enqueue(load, create(), enable(id), { text: "It is on." }, report("push test"));

    const said = await w.say(ada.email, "In 3 minutes, tell me 'push test'.", chat);
    expect(said.result).toMatchObject({ status: "done", awaiting: true });

    // Registered, off, and the card is the only thing standing between it and a run.
    const job = w.jobOf(ada.email, id).instance;
    expect(job.status()).toMatchObject({ id, owner: ada.email, status: "needs_enable", cadence: `once, at 2026-10-13 10:03 (UTC)` });
    expect(job.status()?.def).toMatchObject({ chat, steps: [{ kind: "model" }, { kind: "notify" }], gate: null });
    expect(w.jobIds(ada.email)).toEqual([id]);
    const cards = w.cardsOf(ada.email);
    expect(cards).toEqual([expect.objectContaining({ state: "pending", title: "Your agent asks to: jobs enable", lines: ["Job: Push test", "When: once, at 2026-10-13 10:03 (UTC)", "Stops: after it runs once"], proposed: { id } })]);
    expect(w.jobOf(ada.email, id).alarmAt).toBeNull();
    expect(w.noticesOf(ada.email)).toEqual([]);

    // She approves: the action runs under the grant her decision created, and the job is on.
    const decided = await w.chats.harness(chat).instance.decide([cards[0]!.id], { person: ada.email, agent: false }, "once");
    expect(decided).toEqual([expect.objectContaining({ ok: true, state: "approved", outcome: "DONE" })]);
    expect(job.status()).toMatchObject({ status: "active" });
    const cited = (await w.journal()).find((r) => r.actionKind === "jobs.enable" && r.outcome === "DONE");
    expect(cited).toMatchObject({ principal: ada.email, decision: "auto", grantId: expect.stringMatching(/\S/) });
    expect(w.jobOf(ada.email, id).alarmAt).toBe(T0 + 3 * 60_000);
    expect(w.noticesOf(ada.email)).toEqual([]);

    // On the clock: one run, one model call on the job route for Ada, and the result in the chat.
    const calls = w.fake.requests.length;
    await w.fireJob(ada.email, id);
    expect(w.clock.now).toBe(T0 + 3 * 60_000);
    expect(job.store.runs()).toEqual([expect.objectContaining({ phase: "done", signal: "notify", manual: false })]);
    expect(w.fake.requests).toHaveLength(calls + 1);
    expect(w.noticesOf(ada.email)).toEqual([expect.objectContaining({ source: `job:${id}`, text: "push test" })]);
    expect(await w.ledger().runs({ person: ada.email })).toEqual([expect.objectContaining({ signal: "notify", phase: "done", person: ada.email })]);
    expect((await w.ledger().modelCalls({ person: ada.email })).filter((c) => c.route === "job")).toHaveLength(1);

    // Once means once: the job is finished, holds no alarm, and nothing more arrives.
    expect(job.status()).toMatchObject({ status: "finished" });
    expect(w.jobOf(ada.email, id).alarmAt).toBeNull();
    w.clock.now += 60 * 60_000;
    await job.alarm();
    expect(job.store.runs()).toHaveLength(1);
    expect(w.noticesOf(ada.email)).toHaveLength(1);
  });

  it("a job Ada did not approve never runs, whether her card is left pending or declined", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await openChat(w, ada.email);
    const id = jobIdFor(TITLE, chat, { kind: "runonce", at: AT }, BODY);
    w.fake.enqueue(load, create(), enable(id), { text: "Left off." });
    await w.say(ada.email, "In 3 minutes, tell me 'push test'.", chat);
    const job = w.jobOf(ada.email, id);
    let calls = w.fake.requests.length;

    // Pending: the time passes, the object is woken anyway, and no run, call or notice exists.
    w.clock.now = T0 + 30 * 60_000;
    await job.instance.alarm();
    expect(job.instance.store.runs()).toEqual([]);
    expect(job.instance.status()).toMatchObject({ status: "needs_enable" });
    expect(w.fake.requests).toHaveLength(calls);
    expect(w.noticesOf(ada.email)).toEqual([]);

    // Declined: final, and the job stays off.
    const card = w.cardsOf(ada.email)[0]!;
    expect(await w.chats.harness(chat).instance.decide([card.id], { person: ada.email, agent: false }, "deny")).toEqual([expect.objectContaining({ ok: true, state: "declined" })]);
    // The decision continues the chat's turn (M20.1): one chat call, and none for the job after it.
    expect(w.fake.requests).toHaveLength(calls + 1);
    calls = w.fake.requests.length;
    w.clock.now += 60 * 60_000;
    await job.instance.alarm();
    expect(job.instance.store.runs()).toEqual([]);
    expect(job.instance.status()).toMatchObject({ status: "needs_enable" });
    expect(w.fake.requests).toHaveLength(calls);
    expect(await w.ledger().runs({ person: ada.email })).toEqual([]);
  });

  it("an agent session never turns a job on: the card is refused for it and the job stays off", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await openChat(w, ada.email);
    const id = jobIdFor(TITLE, chat, { kind: "runonce", at: AT }, BODY);
    w.fake.enqueue(load, create(), enable(id));
    await w.say(ada.email, "In 3 minutes, tell me 'push test'.", chat);
    const card = w.cardsOf(ada.email)[0]!;
    const refused = await w.chats.harness(chat).instance.decide([card.id], { person: ada.email, agent: true }, "once");
    expect(refused).toEqual([expect.objectContaining({ ok: false, code: "APPROVAL_AGENT_REFUSED" })]);
    expect(w.jobOf(ada.email, id).instance.status()).toMatchObject({ status: "needs_enable" });
    expect(w.jobOf(ada.email, id).alarmAt).toBeNull();
  });

  it("the Jobs page turns on a job the agent left off, with no card", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await openChat(w, ada.email);
    const id = jobIdFor(TITLE, chat, { kind: "runonce", at: AT }, BODY);
    // The agent registers it and never proposes enabling it.
    w.fake.enqueue(load, create(), { text: "Registered; it is off." }, report("push test"));
    await w.say(ada.email, "In 3 minutes, tell me 'push test'.", chat);
    expect(w.cardsOf(ada.email)).toEqual([]);
    expect(await w.http(ada.email, "GET", "/app/jobs")).toMatchObject({ body: { jobs: [{ id, job: { status: "needs_enable" } }] } });
    expect(await w.http(ada.email, "POST", `/app/jobs/${id}`, { action: "enable" })).toMatchObject({ status: 200 });
    await w.fireJob(ada.email, id);
    expect(w.noticesOf(ada.email)).toEqual([expect.objectContaining({ text: "push test" })]);
  });

  it("refuses what cannot be scheduled with a code, registering nothing", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await openChat(w, ada.email);
    w.fake.enqueue(
      load,
      create({ kind: "interval", every_minutes: 2 }, {}, "c1"),
      create(THREE, { zone: "Mars/Olympus" }, "c2"),
      create({ kind: "runonce", at: "2026-10-13T09:00" }, {}, "c3"),
      create({ kind: "weekly", at: "09:00" }, {}, "c4"),
      create({ kind: "runonce" }, {}, "c5"),
      { text: "None of those could be scheduled." },
    );
    await w.say(ada.email, "Schedule things.", chat);
    const text = w.transcriptOf(ada.email).join("\n");
    for (const code of ["SCHEDULE_INVALID", "SCHEDULE_ZONE_REQUIRED", "SCHEDULE_PAST"]) expect(text, code).toContain(code);
    expect(w.jobIds(ada.email)).toEqual([]);
  });

  it("creating the same job twice changes nothing, and the number of jobs is capped with a code", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await openChat(w, ada.email);
    const id = jobIdFor(TITLE, chat, { kind: "runonce", at: AT }, BODY);
    w.fake.enqueue(load, create(), enable(id), { text: "It is on." }, create(THREE, {}, "c2"), { text: "Already there." });
    await w.say(ada.email, "In 3 minutes, tell me 'push test'.", chat);
    await w.chats.harness(chat).instance.decide([w.cardsOf(ada.email)[0]!.id], { person: ada.email, agent: false }, "once");
    expect(w.jobOf(ada.email, id).instance.status()).toMatchObject({ status: "active" });
    // A second proposal of the same job (the model asked again) is told it exists; it is not reset to off.
    await w.say(ada.email, "Again please.", chat);
    expect(w.transcriptOf(ada.email).join("\n")).toContain(`The job ${id} (${TITLE}) already existed (on`);
    expect(w.jobOf(ada.email, id).instance.status()).toMatchObject({ status: "active" });
    expect(w.jobIds(ada.email)).toEqual([id]);

    // A person at the cap gets JOBS_LIMIT, not a twenty-sixth job.
    for (let i = 0; i < MAX_JOBS - 1; i++) w.host(ada.email).jobs.note(`filler-${i}`, T0);
    w.fake.enqueue(create({ kind: "daily", at: "07:30" }, { title: "Another" }, "c3"), { text: "At the limit." });
    await w.say(ada.email, "One more.", chat);
    expect(w.transcriptOf(ada.email).join("\n")).toContain("JOBS_LIMIT");
    expect(w.jobIds(ada.email)).toHaveLength(MAX_JOBS);
  });

  it("budgets apply as for any job: an exhausted person budget stops the approved run before a model call and says so in the chat", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    await w.ledger().setBudgets({ personDailyMicros: 185 });
    await w.ledger().record({ tenant: "solo-sam", person: ada.email, runId: "earlier", route: "chat", model: "@cf/zai-org/glm-5.3-flash", attempt: 1, status: "ok", code: null, httpStatus: null, inputTokens: 900, outputTokens: 100, reasoningTokens: 0, cachedTokens: 0, at: T0, startedAt: null, firstTokenAt: null, finishedAt: null });
    const chat = await openChat(w, ada.email);
    const id = jobIdFor(TITLE, chat, { kind: "runonce", at: AT }, BODY);
    w.fake.enqueue(load, create(), enable(id));
    // The chat turn itself is a model call the exhausted budget refuses, so the job is registered directly.
    expect(await w.jobOf(ada.email, id).instance.define({ owner: ada.email, by: `agent:${ada.email}`, def: { id, title: TITLE, chat, owner: { kind: "chat", id: chat }, stop: { kind: "after_runs", runs: 1 }, timing: { schedule: { kind: "runonce", at: AT }, zone: "UTC" }, gate: null, steps: [{ kind: "model" }, { kind: "notify" }], ceilingTokens: 20_000, instructions: BODY } })).toMatchObject({ ok: true, status: "needs_enable" });
    await w.jobOf(ada.email, id).instance.enable(ada.email);
    const calls = w.fake.requests.length;
    await w.fireJob(ada.email, id);
    expect(w.fake.requests).toHaveLength(calls);
    expect(w.jobOf(ada.email, id).instance.store.runs()[0]).toMatchObject({ signal: "failed", code: "BUDGET_PERSON_EXHAUSTED" });
    expect(w.noticesOf(ada.email)[0]!.text).toContain("BUDGET_PERSON_EXHAUSTED");
  });
});

describe("[M15.7] a job's result reaches the person", () => {
  /** Ada's job on the delivery world's clock, delivering as `objects/job.ts` does: through her `Person`. */
  function jobFor(w: ReturnType<typeof deliveryWorld>, chat: string, instructions: string, steps: unknown[] = [{ kind: "model" }, { kind: "notify" }]) {
    const deps: JobDeps = {
      now: () => w.clock.now,
      get: () => async () => ({ ok: false, code: "EGRESS_UNAVAILABLE", reason: "none" }) as never,
      ledger: { recordRun: (row) => w.ledger().recordRun(row) },
      complete: (a) => completeForJob({ ai: model.binding as unknown as Ai, ledger: w.ledger(), tenant: "solo-sam", now: () => w.clock.now, wait: async () => {} }, a),
      chat: (chatId) => deliveredNotices(chatId, { deliver: (p, input) => w.person(p).deliver(input), hasNotice: async (id) => w.chats.harness(chatId).instance.hasNotice(id) }),
    };
    const h = new ObjectHarness(`${dAda.email}/push-test`, (ctx, e) => new JobEngine({ storage: (ctx as { storage: never }).storage }, e as unknown as JobDeps), deps as unknown as Record<string, unknown>);
    const def = { id: "push-test", title: "Push test", chat, owner: { kind: "chat" as const, id: chat }, stop: { kind: "after_runs" as const, runs: 1 }, timing: { schedule: { kind: "runonce" as const, at: "2026-10-13T10:03" }, zone: "UTC" }, gate: null, steps: steps as never, ceilingTokens: 20_000, instructions };
    return { h, def };
  }
  const model = { binding: null as unknown };

  it("with no client of Ada's connected the result is pushed to her device, and in the chat when she opens it", async () => {
    const { FakeModel } = await import("../support/fake-model.ts");
    const fake = new FakeModel([report("push test")]);
    model.binding = fake.binding;
    const w = deliveryWorld();
    const chat = w.openChat(dAda.email);
    const browser = await w.push.browser();
    await w.http(dAda.email, "POST", "/push/subscribe", { subscription: browser.subscription });
    const { h, def } = jobFor(w, chat, "Tell me: push test");
    expect(await h.instance.define({ owner: dAda.email, by: dAda.email, def })).toMatchObject({ ok: true, status: "active" });
    const pushes = w.push.delivered().length;

    w.clock.now = Math.max(w.clock.now, h.alarmAt as number);
    expect(w.clock.now).toBe(D0 + 3 * 60_000);
    await h.fireAlarm();
    for (let i = 0; i < 20 && h.alarmAt !== null && h.alarmAt <= w.clock.now; i++) await h.fireAlarm();

    expect(h.instance.store.runs()).toEqual([expect.objectContaining({ phase: "done", signal: "notify" })]);
    expect(w.push.delivered()).toHaveLength(pushes + 1);
    expect(w.push.delivered().at(-1)?.payload).toMatchObject({ title: "job:push-test", items: [expect.stringMatching(/^push-test:/)] });
    // The same item is in her chat too, once, so opening it shows the result.
    expect(w.notices(dAda.email).filter((n) => n.text === "push test")).toHaveLength(1);
    expect(w.mail).toEqual([]);
  });

  it("with a client connected the result lands in the chat and no push is sent", async () => {
    const { FakeModel } = await import("../support/fake-model.ts");
    model.binding = new FakeModel([report("push test")]).binding;
    const w = deliveryWorld();
    const chat = w.openChat(dAda.email);
    const browser = await w.push.browser();
    await w.http(dAda.email, "POST", "/push/subscribe", { subscription: browser.subscription });
    w.connect(chat);
    const { h, def } = jobFor(w, chat, "Tell me: push test");
    await h.instance.define({ owner: dAda.email, by: dAda.email, def });
    const pushes = w.push.delivered().length;
    w.clock.now = h.alarmAt as number;
    await h.fireAlarm();
    for (let i = 0; i < 20 && h.alarmAt !== null && h.alarmAt <= w.clock.now; i++) await h.fireAlarm();
    expect(w.notices(dAda.email).filter((n) => n.text === "push test")).toHaveLength(1);
    expect(w.push.delivered()).toHaveLength(pushes);
  });

  it("with no client and no push subscription the result is mailed", async () => {
    const { FakeModel } = await import("../support/fake-model.ts");
    model.binding = new FakeModel([report("push test")]).binding;
    const w = deliveryWorld();
    const chat = w.openChat(dAda.email);
    const { h, def } = jobFor(w, chat, "Tell me: push test");
    await h.instance.define({ owner: dAda.email, by: dAda.email, def });
    w.clock.now = h.alarmAt as number;
    await h.fireAlarm();
    for (let i = 0; i < 20 && h.alarmAt !== null && h.alarmAt <= w.clock.now; i++) await h.fireAlarm();
    expect(w.mail).toEqual([expect.objectContaining({ person: dAda.email, chat, text: expect.stringContaining("push test") })]);
  });
});
