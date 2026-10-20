// M18.2: reasoning reads as thinking (QYVR-163), asking for a job twice gives one job (QYVR-162) and a
// time the agent chose is said (QYVR-165). Muse's repros, rewritten with the fictional set and the
// scripted fake model. Two members wherever history or jobs are read: Bo never receives Ada's
// reasoning and never sees, matches or reuses her job.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx } from "../../packages/agent/src/chat/engine.ts";
import { connectFrame } from "../../packages/agent/src/chat/protocol.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { jobIdFor } from "../../packages/agent/src/jobs/tools.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };
import { ada, authorityWorld } from "./support/authority-world.ts";

const adaP = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 15, 9, 0, 0);

const THINK_A = "The person asks for a Tuesday check. Let me get a fresh one before I answer.";

function chatWorld(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const clock = { now: T0 };
  const ledgers = harnessNamespace((name) =>
    new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}, (l) => {
      l.now = () => clock.now;
    }),
  );
  const env = { TENANT_ID: adaP.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const chatFor = (name: string) =>
    new ObjectHarness(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), env, (c) => {
      c.now = () => clock.now;
      c.wait = async () => {};
    });
  const resync = (chat: ObjectHarness<ChatEngine>, person: string) => connectFrame(person, chat.instance.owner(), () => chat.instance.history());
  return { fake, clock, chatFor, resync };
}

type Frame = Record<string, unknown>;
const ofType = (frames: Frame[], type: string) => frames.filter((f) => f.type === type);
const joined = (frames: Frame[]) => frames.map((f) => String(f.text)).join("");
const entries = (r: ReturnType<typeof connectFrame>) => (r.ok && r.frame.type === "history" ? r.frame.entries : null);

describe("[M18.2] reasoning reads as the agent's thinking (QYVR-163)", () => {
  it("a reply with reasoning deltas streams them as reasoning frames only: the reply frames, the stored text and the history reply carry the words alone", async () => {
    const w = chatWorld([{ reasoning: THINK_A, text: "Your Tuesday is free." }]);
    const chat = w.chatFor("chat-ada");
    const socket = chat.connect();
    await chat.instance.send({ person: adaP.email, text: "Is my Tuesday free?" });

    expect(joined(ofType(socket.frames, "reasoning"))).toBe(THINK_A);
    // Never streamed into the reply.
    expect(joined(ofType(socket.frames, "delta"))).toBe("Your Tuesday is free.");
    expect(joined(ofType(socket.frames, "delta"))).not.toContain("fresh one");
    // Stored as its own block beside the text block, so no reader can mistake one for the other.
    const stored = chat.rows("SELECT body FROM messages WHERE role = 'assistant'").map((r) => JSON.parse(String(r.body)).content as Array<{ type: string; text?: string; thinking?: string }>);
    expect(stored).toEqual([[{ type: "thinking", thinking: THINK_A }, { type: "text", text: "Your Tuesday is free." }]]);

    // History draws the thinking as an entry of its own, before the reply, never inside it.
    const expected = [
      { kind: "you", text: "Is my Tuesday free?", mid: "m1" },
      { kind: "thinking", text: THINK_A },
      { kind: "agent", text: "Your Tuesday is free.", mid: "m2" },
    ].map((e) => ({ ...e, at: expect.any(Number) }));
    expect(entries(w.resync(chat, adaP.email))).toEqual(expected);
    chat.evict();
    expect(entries(w.resync(chat, adaP.email))).toEqual(expected);
  });

  it("a step that thinks and then calls a tool keeps its thinking apart from the final answer, in order", async () => {
    const w = chatWorld([
      { reasoning: THINK_A, toolCall: { id: "p1", name: "send_to_user", arguments: { text: "Checking now." } } },
      { reasoning: "The check came back clear.", text: "Free all day." },
    ]);
    const chat = w.chatFor("chat-ada");
    await chat.instance.send({ person: adaP.email, text: "Is my Tuesday free?" });
    const kinds = entries(w.resync(chat, adaP.email))!.map((e) => [e.kind, e.text]);
    expect(kinds).toEqual([
      ["you", "Is my Tuesday free?"],
      ["thinking", THINK_A],
      ["agent", "Checking now."],
      ["thinking", "The check came back clear."],
      ["agent", "Free all day."],
    ]);
    // No agent entry holds a word of reasoning.
    for (const e of entries(w.resync(chat, adaP.email))!) if (e.kind === "agent") expect(e.text).not.toMatch(/fresh one|came back clear/);
  });

  it("the page draws the thinking as one line while it streams, never the reasoning's text, and ends it when the reply starts (M23.2)", () => {
    // Live: a reasoning frame starts the one line and ends the reply block; a reply frame ends the line.
    expect(APP_PAGE).toContain('f.type === "reasoning") { reply = null; startThinking(); }');
    expect(APP_PAGE).toContain('f.type === "delta") { endThinking(); reply ??= add("agent", "", true);');
    // History: a thinking entry is drawn as nothing, never as an agent message.
    expect(APP_PAGE).toContain('if (h.kind === "thinking") continue;');
    // Planted: the labelled block that held the reasoning's text is gone.
    expect(APP_PAGE).not.toContain("Agent's thinking");
  });
});

describe("[M18.2] asking for the same job twice gives one job (QYVR-162)", () => {
  const TITLE = "Standup digest";
  const create = (instructions: string, over: Record<string, unknown> = {}, id = "c1"): FakeStep => ({
    toolCall: { id, name: "jobs_create", arguments: { title: TITLE, instructions, schedule: { kind: "daily", at: "08:30" }, no_gate_reason: "A reminder at a set time: there is nothing to watch.", ...over } },
  });
  const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["jobs"] } } };
  const open = async (w: ReturnType<typeof authorityWorld>, p: string) => ((await w.host(p).chats.open(w.clock.now)) as { chatId: string }).chatId;

  it("two identical proposals in one chat register one job and the second answer names it as already existing", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create("Summarise my calendar."), { text: "Done." });
    await w.say(ada.email, "Every day at 08:30, summarise my calendar.", chat);
    w.fake.enqueue(create("Summarise my calendar.", {}, "c2"), { text: "Same again." });
    await w.say(ada.email, "Set that up again.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(1);
    const [id] = w.jobIds(ada.email);
    expect(w.transcriptOf(ada.email).join("\n")).toContain(`The job ${id} (${TITLE}) already existed`);
  });

  it("the same instructions under another title and at another time are the same job; other wording is another (M21.1: the action is the instructions and the kind)", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, create("Summarise my calendar."), create("  summarise my CALENDAR ", { title: "Another name", schedule: { kind: "daily", at: "17:00" } }, "c2"), { text: "Done." });
    await w.say(ada.email, "Every day at 08:30, summarise my calendar.", chat);
    const ids = w.jobIds(ada.email);
    expect(ids).toHaveLength(1);
    // The id is still the hash of the first proposal; nothing else changed about how ids are made.
    expect(ids[0]).toBe(jobIdFor(TITLE, chat, { kind: "daily", at: "08:30" }, "Summarise my calendar."));
    expect(w.transcriptOf(ada.email).join("\n")).toMatch(/already existed \(off until you turn it on/);
    w.fake.enqueue(create("Give me a one-line digest of my day, please.", {}, "c3"), { text: "Made it." });
    await w.say(ada.email, "Also a one-line digest.", chat);
    expect(w.jobIds(ada.email)).toHaveLength(2);
  });

  it("an active job is reused too, and is not reset to off", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    const id = jobIdFor(TITLE, chat, { kind: "daily", at: "08:30" }, "Summarise my calendar.");
    w.fake.enqueue(load, create("Summarise my calendar."), { toolCall: { id: "e1", name: "jobs_enable", arguments: { id } } }, { text: "It is on." });
    await w.say(ada.email, "Every day at 08:30, summarise my calendar.", chat);
    await w.chats.harness(chat).instance.decide([w.cardsOf(ada.email)[0]!.id], { person: ada.email, agent: false }, "once");
    expect(w.jobOf(ada.email, id).instance.status()).toMatchObject({ status: "active" });
    w.fake.enqueue(create("Summarise my calendar.", { title: "Another name" }, "c2"), { text: "It is already on." });
    await w.say(ada.email, "Make that job.", chat);
    expect(w.jobIds(ada.email)).toEqual([id]);
    expect(w.jobOf(ada.email, id).instance.status()).toMatchObject({ status: "active" });
    expect(w.transcriptOf(ada.email).join("\n")).toContain("already existed (on");
  });

  it("another chat or other wording is another job (the same wording under another title or time is the same job, M21.1), and an off job is not reused", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const one = await open(w, ada.email);
    const two = await open(w, ada.email);
    w.fake.enqueue(
      load,
      create("Summarise my calendar."),
      create("Summarise my calendar.", { schedule: { kind: "daily", at: "09:30" } }, "c2"),
      create("Summarise my calendar, with the weather.", { title: "Other digest" }, "c3"),
      { text: "Three." },
    );
    await w.say(ada.email, "Set up three.", one);
    w.fake.enqueue(load, create("Summarise my calendar.", {}, "c4"), { text: "Fourth, in another chat." });
    await w.say(ada.email, "Same, here.", two);
    // The second proposal differs only in its time and the first and second are one job; the third has other wording.
    expect(w.jobIds(ada.email)).toHaveLength(3);

    // Turned off, a job is no longer asked for: a new proposal (other wording) is a new job.
    const first = jobIdFor(TITLE, one, { kind: "daily", at: "08:30" }, "Summarise my calendar.");
    expect(w.jobIds(ada.email)).toContain(first);
    await w.http(ada.email, "POST", `/app/jobs/${first}`, { action: "enable" });
    await w.http(ada.email, "POST", `/app/jobs/${first}`, { action: "disable" });
    w.fake.enqueue(create("Now with other words.", {}, "c5"), { text: "New." });
    await w.say(ada.email, "Again.", one);
    expect(w.jobIds(ada.email)).toHaveLength(4);
  });
});

describe("[M18.2] a time the agent chose is said (QYVR-165)", () => {
  const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["jobs"] } } };
  const TITLE = "Dentist reminder";
  const AT = "2026-10-14T09:00";
  const WHEN = "once, at 2026-10-14 09:00 (Europe/London)";
  const vague = (id = "c1", title = TITLE): FakeStep => ({
    toolCall: { id, name: "jobs_create", arguments: { title, instructions: "Remind me to book the dentist.", schedule: { kind: "runonce", at: AT }, zone: "Europe/London" } },
  });
  const open = async (w: ReturnType<typeof authorityWorld>, p: string) => ((await w.host(p).chats.open(w.clock.now)) as { chatId: string }).chatId;

  it("the answer names the resolved local time and tells the model to state it and offer to change it", async () => {
    const w = authorityWorld({ jobs: true, script: [] });
    const chat = await open(w, ada.email);
    w.fake.enqueue(load, vague(), { text: "I set it for 09:00 tomorrow; shall I change it?" });
    await w.say(ada.email, "Remind me sometime tomorrow to book the dentist.", chat);
    const text = w.transcriptOf(ada.email).join("\n");
    expect(text).toContain(`Resolved time: ${WHEN}`);
    expect(text).toMatch(/The person has been told this time by the harness.*offer to change it/);
    // Both the repeated proposal and the first answer say the time, so a reuse is as clear as a new job.
    w.fake.enqueue({ toolCall: { id: "c2", name: "jobs_create", arguments: { title: "Another name", instructions: "Remind me to book the dentist.", schedule: { kind: "runonce", at: AT }, zone: "Europe/London" } } }, { text: "Same job." });
    await w.say(ada.email, "Again.", chat);
    expect(w.transcriptOf(ada.email).join("\n")).toContain(`already existed (off until you turn it on, ${WHEN})`);
  });
});
