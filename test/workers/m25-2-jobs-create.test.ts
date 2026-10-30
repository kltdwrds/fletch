// M25.2: jobs that can do something, at creation. `jobs_create` attaches a gate, a recurring job with no
// gate needs a stated reason the enable card shows, a job carries an owner and a stop condition, monthly
// and yearly cadences exist, the zone is the person's saved home zone, and a replayed call on a resumed
// step is the same job. The scripted fake and the hostile model drive the real chat engine, gate, cards
// and `Job` engines; Ada and Bo of solo-sam wherever a job is read or turned on.
import { describe, expect, it } from "vitest";
import { cardLinesOf, jobsNamespace } from "../../packages/agent/src/jobs/tools.ts";
import { describeCadence, nextSlotAfter, zoned } from "../../packages/agent/src/jobs/schedule.ts";
import { type FakeStep, report } from "../support/fake-model.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["jobs"] } } };
const PAGE = "https://hacker-news.firebaseio.com/v0/item/8863.json";
const create = (args: Record<string, unknown>, id = "c1"): FakeStep => ({ toolCall: { id, name: "jobs_create", arguments: { title: "Release watch", instructions: "Tell me when the release notes change.", ...args } } });
const enable = (jobId: string, id = "e1"): FakeStep => ({ toolCall: { id, name: "jobs_enable", arguments: { id: jobId } } });
const open = async (w: ReturnType<typeof authorityWorld>, p: string) => ((await w.host(p).chats.open(w.clock.now)) as { chatId: string }).chatId;
const toolResults = (w: ReturnType<typeof authorityWorld>, p: string) => w.transcriptOf(p).join("\n");
const def = async (w: ReturnType<typeof authorityWorld>, p: string, id: string) => w.jobOf(p, id).instance.status()?.def;

describe("[M25.2] a gate on create", () => {
  it("jobs_create attaches a url gate, and the job's model step runs only after the gate opens", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ schedule: { kind: "interval", every_minutes: 30 }, gate: { kind: "url", url: PAGE } }), { text: "Set." });
    await w.say(ada.email, "Watch the release notes page.", chat);
    const [id] = w.jobIds(ada.email) as [string];
    expect(await def(w, ada.email, id)).toMatchObject({ gate: { kind: "url", url: PAGE }, owner: { kind: "chat", id: chat }, stop: { kind: "turned_off" } });
    expect((await def(w, ada.email, id))?.noGateReason).toBeUndefined();
  });

  it("watermark and threshold gates attach too; a gate over http or of another kind is refused with a code", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(
      load,
      create({ title: "Count", schedule: { kind: "interval", every_minutes: 30 }, gate: { kind: "watermark", url: PAGE, pointer: "/descendants" } }),
      create({ title: "Score", instructions: "Tell me when the score passes 500.", schedule: { kind: "interval", every_minutes: 30 }, gate: { kind: "threshold", url: PAGE, pointer: "/score", above: 500 } }, "c2"),
      create({ title: "Plain", instructions: "Watch the plain page.", schedule: { kind: "interval", every_minutes: 30 }, gate: { kind: "url", url: "http://example.com/" } }, "c3"),
      { text: "Done." },
    );
    await w.say(ada.email, "Set three watches.", chat);
    const kinds = await Promise.all(w.jobIds(ada.email).map(async (id) => (await def(w, ada.email, id))?.gate?.kind));
    expect(kinds.sort()).toEqual(["threshold", "watermark"]);
    expect(toolResults(w, ada.email)).toContain("JOB_GATE_INVALID");
  });

  it("a recurring job with no gate and no reason is refused with JOB_GATE_REQUIRED, and nothing is registered", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ schedule: { kind: "daily", at: "08:00" } }), { text: "Could not." });
    await w.say(ada.email, "Every morning, check the release notes.", chat);
    expect(w.jobIds(ada.email)).toEqual([]);
    expect(toolResults(w, ada.email)).toContain("JOB_GATE_REQUIRED");
  });

  it("a recurring job with no gate keeps its stated reason, and the enable card shows it", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    const reason = "A morning stretch reminder: there is nothing to watch.";
    w.fake.enqueue(load, create({ title: "Stretch", instructions: "Remind me to stretch.", schedule: { kind: "daily", at: "08:00" }, no_gate_reason: reason }), { text: "Set." });
    await w.say(ada.email, "Every morning remind me to stretch.", chat);
    const [id] = w.jobIds(ada.email) as [string];
    expect(await def(w, ada.email, id)).toMatchObject({ gate: null, noGateReason: reason });
    w.fake.enqueue(enable(id), { text: "Asked." });
    await w.say(ada.email, "Turn it on.", chat);
    const [card] = w.cardsOf(ada.email);
    expect(card?.lines).toContain(`No gate: ${reason}`);
    expect(card?.lines).toContain("Stops: when you turn it off");
  });

  it("a one-shot needs no gate and no reason, and its card says it stops after one run", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ title: "Stretch", instructions: "Remind me to stretch.", schedule: { kind: "runonce", in_minutes: 5 } }), { text: "Set." });
    await w.say(ada.email, "In 5 minutes remind me to stretch.", chat);
    const [id] = w.jobIds(ada.email) as [string];
    const d = await def(w, ada.email, id);
    expect(d).toMatchObject({ gate: null, stop: { kind: "after_runs", runs: 1 } });
    expect(cardLinesOf(d as never).some((l) => l.startsWith("No gate"))).toBe(false);
  });

  it("the card names a gated job's gate", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ schedule: { kind: "interval", every_minutes: 30 }, gate: { kind: "url", url: PAGE } }), { text: "Set." });
    await w.say(ada.email, "Watch it.", chat);
    const [id] = w.jobIds(ada.email) as [string];
    w.fake.enqueue(enable(id), { text: "Asked." });
    await w.say(ada.email, "Turn it on.", chat);
    expect(w.cardsOf(ada.email)[0]?.lines).toContain(`Gate: runs only when ${PAGE} changes`);
  });
});

describe("[M25.2] owner, stop condition and cadences", () => {
  it("a job for a goal carries the goal as its owner and still delivers to the chat; a malformed goal is refused", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(
      load,
      create({ schedule: { kind: "interval", every_minutes: 30 }, gate: { kind: "url", url: PAGE }, goal: "ship-v2" }),
      create({ title: "Bad", instructions: "Other.", schedule: { kind: "interval", every_minutes: 30 }, gate: { kind: "url", url: PAGE }, goal: "Ship V2!" }, "c2"),
      { text: "Set." },
    );
    await w.say(ada.email, "Watch it for the v2 goal.", chat);
    const [id] = w.jobIds(ada.email) as [string];
    expect(await def(w, ada.email, id)).toMatchObject({ owner: { kind: "goal", id: "ship-v2" }, chat });
    expect(w.jobIds(ada.email)).toHaveLength(1);
    expect(toolResults(w, ada.email)).toContain("JOB_OWNER_INVALID");
  });

  it("a job stops itself after its stop condition: after_runs ends it after that many runs", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ title: "Stretch", instructions: "Remind me to stretch.", schedule: { kind: "interval", every_minutes: 30 }, no_gate_reason: "A reminder.", stop: { kind: "after_runs", runs: 2 } }), { text: "Set." });
    await w.say(ada.email, "Remind me twice.", chat);
    const [id] = w.jobIds(ada.email) as [string];
    await w.jobOf(ada.email, id).instance.enable(ada.email);
    // Each result wakes her agent (F24), which has nothing to add.
    w.fake.enqueue(report("Stretch."), { text: "" }, report("Stretch again."), { text: "" });
    await w.fireJob(ada.email, id);
    await w.chats.harness(chat).instance.settled();
    expect(w.jobOf(ada.email, id).instance.status()?.status).toBe("active");
    await w.fireJob(ada.email, id);
    await w.chats.harness(chat).instance.settled();
    expect(w.jobOf(ada.email, id).instance.status()).toMatchObject({ status: "finished", statusCode: "JOB_STOPPED" });
    expect(w.jobOf(ada.email, id).alarmAt).toBeNull();
  });

  it("first_report ends a job on its first result, and until ends it after its last local date", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(
      load,
      create({ title: "Once found", instructions: "Tell me once.", schedule: { kind: "interval", every_minutes: 30 }, no_gate_reason: "A reminder.", stop: { kind: "first_report" } }),
      create({ title: "Until", instructions: "Until Wednesday.", schedule: { kind: "interval", every_minutes: 30 }, no_gate_reason: "A reminder.", stop: { kind: "until", date: "2026-10-13" }, zone: "UTC" }, "c2"),
      create({ title: "Bad stop", instructions: "Bad.", schedule: { kind: "interval", every_minutes: 30 }, no_gate_reason: "A reminder.", stop: { kind: "until", date: "soon" } }, "c3"),
      { text: "Set." },
    );
    await w.say(ada.email, "Set them.", chat);
    expect(toolResults(w, ada.email)).toContain("JOB_STOP_INVALID");
    const [once, until] = w.jobIds(ada.email) as [string, string];
    await w.jobOf(ada.email, once).instance.enable(ada.email);
    w.fake.enqueue(report("Found it."));
    await w.fireJob(ada.email, once);
    expect(w.jobOf(ada.email, once).instance.status()).toMatchObject({ status: "finished", statusCode: "JOB_STOPPED" });
    await w.jobOf(ada.email, until).instance.enable(ada.email);
    w.clock.now = Date.UTC(2026, 9, 14, 0, 0);
    await w.jobOf(ada.email, until).fireAlarm();
    expect(w.jobOf(ada.email, until).instance.status()).toMatchObject({ status: "finished", statusCode: "JOB_STOPPED" });
    expect(w.jobOf(ada.email, until).instance.store.runs()).toEqual([]);
  });

  it("monthly and yearly cadences exist: a short month runs on its last day, and 29 February on the 28th without one", async () => {
    const monthly = { schedule: { kind: "monthly" as const, day: 31, at: "09:00" }, zone: "Europe/London" };
    const at = (t: number | null) => {
      const p = zoned(t as number, "Europe/London");
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    };
    expect(at(nextSlotAfter(monthly, Date.UTC(2026, 9, 13)))).toBe("2026-10-31 9:0");
    expect(at(nextSlotAfter(monthly, Date.UTC(2026, 10, 1)))).toBe("2026-11-30 9:0");
    const leap = { schedule: { kind: "yearly" as const, month: 2, day: 29, at: "07:30" }, zone: "UTC" };
    expect(at(nextSlotAfter(leap, Date.UTC(2026, 9, 13)))).toBe("2027-2-28 7:30");
    expect(at(nextSlotAfter(leap, Date.UTC(2027, 2, 1)))).toBe("2028-2-29 7:30");
    expect(describeCadence(monthly)).toContain("every month on day 31 at 09:00");
    expect(describeCadence(leap)).toContain("every year on February 29");
  });

  it("jobs_create takes monthly and yearly schedules; a yearly date no month has is refused", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(
      load,
      create({ title: "Rent", instructions: "Remind me the rent is due.", schedule: { kind: "monthly", day_of_month: 1, at: "09:00" }, no_gate_reason: "A reminder." }),
      create({ title: "Birthday", instructions: "Remind me of Bo's birthday.", schedule: { kind: "yearly", month: 3, day_of_month: 14, at: "08:00" }, no_gate_reason: "A reminder." }, "c2"),
      create({ title: "Never", instructions: "Never.", schedule: { kind: "yearly", month: 2, day_of_month: 30, at: "08:00" }, no_gate_reason: "A reminder." }, "c3"),
      { text: "Set." },
    );
    await w.say(ada.email, "Set the rent and the birthday.", chat);
    const kinds = await Promise.all(w.jobIds(ada.email).map(async (id) => (await def(w, ada.email, id))?.timing.schedule.kind));
    expect(kinds.sort()).toEqual(["monthly", "yearly"]);
    expect(toolResults(w, ada.email)).toContain("SCHEDULE_INVALID");
  });
});

describe("[M25.2] the saved home zone", () => {
  it("a job reads the person's saved home zone: a zone reported later while travelling never moves it", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    const send = (text: string, timeZone: string) => w.chats.harness(chat).instance.send({ person: ada.email, text, timeZone });
    w.fake.enqueue(load, create({ title: "Stretch", instructions: "Remind me to stretch.", schedule: { kind: "daily", at: "08:00" }, no_gate_reason: "A reminder." }), { text: "Set." });
    await send("Every morning at 8 remind me to stretch.", "Europe/London");
    // Ada travels: her client now reports Tokyo. A new job is still set in her home zone.
    w.fake.enqueue(create({ title: "Water", instructions: "Remind me to drink water.", schedule: { kind: "daily", at: "09:00" }, no_gate_reason: "A reminder." }, "c2"), { text: "Set." });
    await send("Every morning at 9 remind me to drink water.", "Asia/Tokyo");
    const zones = await Promise.all(w.jobIds(ada.email).map(async (id) => (await def(w, ada.email, id))?.timing.zone));
    expect(zones).toEqual(["Europe/London", "Europe/London"]);
    // A zone the person names for the job is still theirs to name.
    w.fake.enqueue(create({ title: "Call", instructions: "Remind me to call home.", schedule: { kind: "daily", at: "18:00" }, no_gate_reason: "A reminder.", zone: "Asia/Tokyo" }, "c3"), { text: "Set." });
    await send("Every evening at 6 Tokyo time remind me to call home.", "Asia/Tokyo");
    const defs = await Promise.all(w.jobIds(ada.email).map((id) => def(w, ada.email, id)));
    expect(defs.find((d) => d?.title === "Call")?.timing.zone).toBe("Asia/Tokyo");
    expect(await w.host(ada.email).jobs.homeZone("America/New_York")).toBe("Europe/London");
  });
});

describe("[M25.2] replay safety", () => {
  const options = (w: ReturnType<typeof authorityWorld>, request: string | undefined) => {
    const jobs = { ids: async (p: string) => w.host(p).jobs.list(), inspect: async (p: string, id: string) => w.jobOf(p, id).instance.inspect(p) as never, define: (p: string, d: never) => w.jobOf(p, (d as { id: string }).id).instance.define({ owner: p, by: `agent:${p}`, def: d }), enable: async () => ({ ok: true as const }), disable: async () => ({ ok: true as const }), remove: async () => ({ ok: true as const }), homeZone: async () => "UTC" };
    return jobsNamespace(jobs, { principal: ada.email, chatId: "chat-ada", zone: () => "UTC", request: () => request, now: () => w.clock.now, separate: { text: () => "Remind me to stretch, another one too.", spent: () => false, spend: () => undefined } }).tools.find((t) => t.name === "jobs_create")!;
  };
  const args = { title: "Stretch", instructions: "Remind me to stretch.", schedule: { kind: "runonce", in_minutes: 5 }, separate: true };

  it("jobs_create on a resumed step is the same job: the same request and tool call return the first call's job and words", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const tool = options(w, "turn-1");
    const first = await tool.execute("call-1", args as never, undefined, undefined);
    // The step resumes three minutes later: the relative time resolves to another instant, and `separate` would make a copy.
    w.clock.now += 180_000;
    const again = await tool.execute("call-1", args as never, undefined, undefined);
    expect(w.jobIds(ada.email)).toHaveLength(1);
    expect((again.details as { id: string; replayed: boolean }).id).toBe((first.details as { id: string }).id);
    expect(again.details).toMatchObject({ replayed: true });
    expect(again.content).toEqual(first.content);
  });

  it("a one-shot that already ran is still the answer to its own replayed call, never a second job", async () => {
    const w = authorityWorld({ jobs: true, script: [report("Stretch.")] });
    const tool = options(w, "turn-1");
    const first = await tool.execute("call-1", args as never, undefined, undefined);
    const id = (first.details as { id: string }).id;
    await w.jobOf(ada.email, id).instance.enable(ada.email);
    await w.fireJob(ada.email, id);
    expect(w.jobOf(ada.email, id).instance.status()?.status).toBe("finished");
    await tool.execute("call-1", args as never, undefined, undefined);
    expect(w.jobIds(ada.email)).toEqual([id]);
  });

  it("another tool call, or another request, is another call: the guard keys on both", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    await options(w, "turn-1").execute("call-1", args as never, undefined, undefined);
    w.clock.now += 180_000;
    const other = await options(w, "turn-2").execute("call-1", args as never, undefined, undefined);
    expect(other.details).not.toMatchObject({ replayed: true });
    expect(w.jobIds(ada.email)).toHaveLength(2);
  });
});
