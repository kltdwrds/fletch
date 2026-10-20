// M21.1: one job per request and the job's time always said, both decided in code (QYVR-178, step 6).
// The scripted fake model drives the real chat engine, gate, cards and `Job` engine on the world's
// clock. The "hostile" model varies the title per send and passes `separate: true` unasked. Ada and Bo
// of solo-sam wherever a job is read: Bo never sees or reuses Ada's job.
import { describe, expect, it } from "vitest";
import { actionKey, asksForAnother, timeLine } from "../../packages/agent/src/jobs/reuse.ts";
import { jobsNamespace } from "../../packages/agent/src/jobs/tools.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

const BODY = "Remind me to stretch.";
const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["jobs"] } } };
const create = (schedule: unknown, title: string, extra: Record<string, unknown> = {}, id = "c1", instructions = BODY): FakeStep => ({
  toolCall: { id, name: "jobs_create", arguments: { title, instructions, schedule, ...((schedule as { kind?: string })?.kind === "runonce" ? {} : { no_gate_reason: "A reminder at a set time: there is nothing to watch." }), ...extra } },
});
const enable = (jobId: string, id = "e1"): FakeStep => ({ toolCall: { id, name: "jobs_enable", arguments: { id: jobId } } });
const open = async (w: ReturnType<typeof authorityWorld>, p: string) => ((await w.host(p).chats.open(w.clock.now)) as { chatId: string }).chatId;
const sentIn = (w: ReturnType<typeof authorityWorld>, chat: string) =>
  w.chats.harness(chat).rows("SELECT payload FROM outbox").map((r) => JSON.parse(String(r.payload)) as { kind: string; text?: string }).filter((e) => e.kind === "deliver").map((e) => String(e.text));

describe("[M21.1] one job per request, whatever title the model gives it (QYVR-178)", () => {
  it("a model that varies the title and the time in it on every send still gets one job", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 5 }, "stretch-reminder-10-05"), { text: "Set." });
    await w.say(ada.email, "In 5 minutes remind me to stretch.", chat);
    const [first] = w.jobIds(ada.email) as [string];
    w.clock.now += 120_000;
    w.fake.enqueue(create({ kind: "runonce", in_minutes: 5 }, "stretch-reminder-10-07", {}, "c2"), { text: "Same one." });
    await w.say(ada.email, "In 5 minutes remind me to stretch.", chat);
    expect(w.jobIds(ada.email)).toEqual([first]);
    const text = w.transcriptOf(ada.email).join("\n");
    expect(text).toContain(`The job ${first} (stretch-reminder-10-05) already existed`);
    expect(text).not.toContain("use another title");
    expect(text).toContain("separate: true");
  });

  it("the normalized prompt is the action: case, punctuation and spacing do not make another job", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 5 }, "A"), create({ kind: "runonce", in_minutes: 9 }, "B", {}, "c2", "  remind me  to STRETCH "), { text: "Done." });
    await w.say(ada.email, "In 5 minutes remind me to stretch.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(1);
  });

  it("another prompt is another job, and so is the same prompt as another kind", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(
      load,
      create({ kind: "runonce", in_minutes: 5 }, "Stretch"),
      create({ kind: "runonce", in_minutes: 5 }, "Water", {}, "c2", "Remind me to drink water."),
      create({ kind: "daily", at: "09:00" }, "Stretch daily", {}, "c3"),
      { text: "Done." },
    );
    await w.say(ada.email, "Set three reminders.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(3);
  });

  it("a model that passes separate: true when the person did not ask still gets one job, and is told why", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 5 }, "Stretch"), { text: "Set." });
    await w.say(ada.email, "In 5 minutes remind me to stretch.", chat);
    const [first] = w.jobIds(ada.email) as [string];
    w.fake.enqueue(create({ kind: "runonce", in_minutes: 5 }, "Stretch 2", { separate: true }, "c2"), { text: "Same one." });
    await w.say(ada.email, "In 5 minutes remind me to stretch.", chat);
    expect(w.jobIds(ada.email)).toEqual([first]);
    expect(w.transcriptOf(ada.email).join("\n")).toContain("the person's latest message does not ask for another one");
  });

  it("a person who refuses another one is not asking for one", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 5 }, "Stretch"), { text: "Set." });
    await w.say(ada.email, "In 5 minutes remind me to stretch.", chat);
    w.fake.enqueue(create({ kind: "runonce", in_minutes: 5 }, "Stretch", { separate: true }, "c2"), { text: "Same one." });
    await w.say(ada.email, "Don't make another one of those.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(1);
  });

  it("a person who says 'another one' gets two", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 5 }, "Stretch"), { text: "Set." });
    await w.say(ada.email, "In 5 minutes remind me to stretch.", chat);
    w.fake.enqueue(create({ kind: "runonce", in_minutes: 5 }, "Stretch", { separate: true }, "c2"), create({ kind: "runonce", in_minutes: 5 }, "Stretch", { separate: true }, "c3"), { text: "Two." });
    await w.say(ada.email, "Set another one of those, the same in 5 minutes.", chat);
    // The model asks for a copy twice in the turn; the person's one "another" buys exactly one.
    const ids = w.jobIds(ada.email);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(w.jobOf(ada.email, id).instance.status()).toMatchObject({ status: "needs_enable" });
    // A later message that says it again buys one more.
    w.fake.enqueue(create({ kind: "runonce", in_minutes: 5 }, "Stretch", { separate: true }, "c4"), { text: "Three." });
    await w.say(ada.email, "Another one, please.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(3);
  });
});

describe("[M21.1] the job's time is said in code for a named and a picked time, with the turn paused on the card", () => {
  const LINE = "Set for Wednesday 2026-10-14 at 09:00 Europe/London. Say so to change it.";

  it("a named time: delivered once, live and in history, with no model text", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    const socket = w.chats.harness(chat).connect();
    const id = (await import("../../packages/agent/src/jobs/tools.ts")).jobIdFor("Dentist", chat, { kind: "runonce", at: "2026-10-14T09:00" }, BODY);
    w.fake.enqueue(load, create({ kind: "runonce", at: "2026-10-14T09:00" }, "Dentist", { zone: "Europe/London" }), enable(id));
    const said = await w.say(ada.email, "Remind me tomorrow at 9 to stretch.", chat);
    expect(said.result).toMatchObject({ status: "done", awaiting: true });
    expect(sentIn(w, chat)).toEqual([LINE]);
    expect(socket.frames.filter((f) => f.type === "message").map((f) => f.text)).toEqual([LINE]);
    const drawn = w.chats.harness(chat).instance.history().entries.filter((e) => "text" in e && e.text === LINE);
    expect(drawn).toHaveLength(1);
  });

  it("a picked time (the model gave the person no exact time and passes no flag) is delivered the same", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    // The world's clock is Tuesday 2026-10-13 10:00 UTC, so 1440 minutes on is Wednesday 10:00 in London (BST, +1: 11:00).
    // 1440 minutes on from 10:00 UTC is 11:00 in London that day; the model writes no text and proposes the enable.
    const id = (await import("../../packages/agent/src/jobs/tools.ts")).jobIdFor("Dentist", chat, { kind: "runonce", at: "2026-10-14T11:00" }, BODY);
    w.fake.enqueue(load, create({ kind: "runonce", in_minutes: 1440 }, "Dentist", { zone: "Europe/London" }), enable(id));
    const said = await w.say(ada.email, "Remind me sometime tomorrow to stretch.", chat);
    expect(said.result).toMatchObject({ status: "done", awaiting: true });
    expect(sentIn(w, chat)).toEqual(["Set for Wednesday 2026-10-14 at 11:00 Europe/London. Say so to change it."]);
  });

  it("time_picked is gone from the tool", () => {
    const ns = jobsNamespace({} as never, { principal: ada.email, chatId: "c", zone: () => "UTC", request: () => undefined, now: () => 0, separate: { text: () => undefined, spent: () => false, spend: () => undefined } });
    const create = ns.tools.find((t) => t.name === "jobs_create");
    expect(JSON.stringify(create?.parameters)).not.toContain("time_picked");
    expect(JSON.stringify(create?.parameters)).toContain("separate");
  });
});

describe("[M21.1] the pure rules", () => {
  it("asksForAnother reads the person's words, never an absent message", () => {
    for (const t of ["another one please", "make a second one", "one more of those", "a separate reminder too", "an additional job"]) expect(asksForAnother(t)).toBe(true);
    for (const t of ["In 5 minutes remind me to stretch.", "Don't make another one", "do not set a second one", "change it to 6pm", ""]) expect(asksForAnother(t)).toBe(false);
    expect(asksForAnother(undefined)).toBe(false);
  });

  it("actionKey ignores case, punctuation and spacing and keeps the kind", () => {
    expect(actionKey("runonce", " Remind me, to STRETCH! ")).toBe(actionKey("runonce", "remind me to stretch"));
    expect(actionKey("runonce", "x")).not.toBe(actionKey("daily", "x"));
  });

  it("timeLine names weekday, date, time and zone from the resolved first run", () => {
    const now = Date.UTC(2026, 9, 13, 10, 0);
    expect(timeLine({ schedule: { kind: "runonce", at: "2026-10-14T09:00" }, zone: "Europe/London" } as never, now)).toBe("Set for Wednesday 2026-10-14 at 09:00 Europe/London. Say so to change it.");
  });
});
