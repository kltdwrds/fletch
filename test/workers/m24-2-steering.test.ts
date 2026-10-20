// M24.2: chat steering on the production engine, hermetic with the scripted fake model and two members.
// A send while a turn runs is a mailbox row taken at the next step boundary, a resend of its id is the
// first row, handoffs queue in the same order, and the epoch moves at a compaction and at reopen. Stop
// ends a turn at its next step boundary, stopped and never done, with what it had committed listed. A
// resumed step replays its turn's own blocks. A compaction can be asked for, and one that fails is a
// row with its reason. The checklist outlives compaction and nudges once. `db_query` reads only the
// owner's views, refuses anything but one SELECT, and a colleague's request never reaches it. Bo never
// reaches Ada's chat, turn or views.
import { describe, expect, it } from "vitest";
import { ChatEngine, type EngineCtx, LOADED_NAMESPACES_KEY } from "../../packages/agent/src/chat/engine.ts";
import { STEER_POLICY } from "../../packages/agent/src/chat/mailbox.ts";
import { ownerOnly } from "../../packages/agent/src/chat/protocol.ts";
import { answerFrame } from "../../packages/agent/src/chat/socket.ts";
import { STOPPED_TEXT } from "../../packages/agent/src/chat/stop.ts";
import { MAX_STEPS_PER_TURN } from "../../packages/agent/src/chat/turn.ts";
import { Ledger } from "../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../support/fake-model.ts";
import { Evicted, harnessNamespace, ObjectHarness } from "../support/object-harness.ts";
import { memoryFor } from "./support/memory-harness.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const T0 = Date.UTC(2026, 9, 16, 9, 0, 0);
type Frame = Record<string, unknown>;

/** Ada's and Bo's chats on one tenant's Ledger, over the production engine; the company text and the clock are the test's. */
function world(script: FakeStep[]) {
  const fake = new FakeModel(script);
  const clock = { now: T0 };
  const company = { text: "Solo Sam answers within a day." };
  const mem = memoryFor(ada.email);
  mem.clock.now = T0;
  const ledgers = harnessNamespace((name) => new ObjectHarness(name, (ctx, env) => new Ledger(ctx as DurableObjectState, env as Env), {}, (l) => {
    l.now = () => clock.now;
  }));
  const env = { TENANT_ID: ada.company, QYVR_ENV: "staging", AI: fake.binding, LEDGER: ledgers.binding };
  const conns: Array<{ state: { person: string }; frames: Frame[]; send(d: string): void }> = [];
  const chatFor = (name: string, owner: string) => {
    const h: ObjectHarness<ChatEngine> = new ObjectHarness(
      name,
      (ctx, e) =>
        new ChatEngine(ctx as EngineCtx, e as Env, {
          sockets: () => ownerOnly(conns, h.instance.owner()),
          ...(owner === ada.email ? { memory: () => mem.svc() as never, companyInstructions: async () => ({ tenant: ada.company, text: company.text }) } : {}),
        }),
      env,
      (c) => {
        c.now = () => clock.now;
        c.wait = async () => {};
      },
    );
    h.instance.claim(owner);
    return h;
  };
  const chat = chatFor("chat-ada", ada.email);
  const socketOf = (person: string) => {
    const c = { state: { person }, frames: [] as Frame[], send: (d: string) => void c.frames.push(JSON.parse(d)) };
    conns.push(c);
    return c;
  };
  const ledger = () => ledgers.harness(ada.company).instance;
  const send = (text: string, clientId?: string, person = ada.email) => chat.instance.send({ person, text, ...(clientId ? { clientId } : {}) });
  const request = (i: number) => JSON.stringify(fake.requests[i]?.inputs.messages ?? []);
  return { fake, clock, company, mem, chat, chatFor, socketOf, ledger, send, request };
}

const sendTool = (text: string): FakeStep => ({ toolCall: { name: "send_to_user", arguments: { text } } });
const held = (name: string, step: FakeStep): FakeStep => ({ checkpoint: name, step });
const mailbox = (w: ReturnType<typeof world>) => w.chat.rows("SELECT ordinal, message_id, epoch, kind, scope, state, delivery FROM mailbox ORDER BY ordinal");

describe("[M24.2] the mailbox row", () => {
  it("a send while a turn runs is a queued row with its ordinal, epoch, kind and scope; a resend of its id on a new socket is answered with the first row and never stored twice", async () => {
    const w = world([held("busy", sendTool("On it.")), { text: "Both handled: your week and the dentist." }]);
    const first = w.send("Plan my week.", "send-1");
    await w.fake.reached("busy");
    expect(await w.send("Also book the dentist.", "send-2")).toEqual({ status: "queued", id: "send-2", ordinal: 2, turnId: expect.any(String) });
    // The page's socket dropped and it sends the same frame again on a new one.
    const resend = JSON.stringify({ type: "send", text: "Also book the dentist.", id: "send-2" });
    expect(await answerFrame(ada.email, resend, w.chat.instance)).toEqual({ type: "duplicate", id: "send-2", ordinal: 2, state: "queued" });
    expect(mailbox(w)).toEqual([
      { ordinal: 1, message_id: "send-1", epoch: 0, kind: "user", scope: "owner", state: "completed", delivery: "start" },
      { ordinal: 2, message_id: "send-2", epoch: 0, kind: "user", scope: "owner", state: "queued", delivery: null },
    ]);
    w.fake.release("busy");
    expect(await first).toMatchObject({ status: "done" });
    // Taken at the next step boundary, as one fenced block with its policy line, by the same turn.
    expect(w.fake.requests).toHaveLength(2);
    expect(w.request(0)).not.toContain("dentist");
    expect(w.request(1)).toContain(STEER_POLICY.slice(0, 60));
    expect(w.request(1)).toContain(`person:${ada.email}`);
    expect(w.request(1)).toContain("Also book the dentist.");
    expect(mailbox(w).map((r) => [r.state, r.delivery])).toEqual([["completed", "start"], ["completed", "steer"]]);
    expect(w.chat.rows("SELECT status FROM turns")).toEqual([{ status: "done" }]);
    // The person's two messages, once each, in order, with the page's ids.
    const you = w.chat.instance.history().entries.filter((e) => e.kind === "you");
    expect(you.map((e) => [e.text, "id" in e ? e.id : undefined])).toEqual([["Plan my week.", "send-1"], ["Also book the dentist.", "send-2"]]);
  });

  it("Bo's send never queues into Ada's chat, while her turn runs or not", async () => {
    const w = world([held("busy", { text: "Done." })]);
    const first = w.send("Plan my week.", "send-1");
    await w.fake.reached("busy");
    expect(await w.send("let me in", "bo-1", other.email)).toEqual({ status: "refused", code: "CHAT_NOT_OWNER" });
    w.fake.release("busy");
    await first;
    expect(await w.send("and now?", "bo-2", other.email)).toEqual({ status: "refused", code: "CHAT_NOT_OWNER" });
    expect(mailbox(w).map((r) => r.message_id)).toEqual(["send-1"]);
    expect(JSON.stringify(w.chat.instance.history())).not.toContain("let me in");
  });

  it("a row left queued when a turn ends at the step cap starts the next turn, drawn as the person's; the Ledger counts the capped turn", async () => {
    const steps: FakeStep[] = Array.from({ length: MAX_STEPS_PER_TURN }, (_, i) => (i === MAX_STEPS_PER_TURN - 1 ? held("last", sendTool(`step ${i + 1}`)) : sendTool(`step ${i + 1}`)));
    const w = world([...steps, { text: "Here is the summary you asked for." }]);
    const first = w.send("Work through the list.", "send-1");
    await w.fake.reached("last");
    expect(await w.send("When done, summarise.", "send-2")).toMatchObject({ status: "queued" });
    w.fake.release("last");
    expect(await first).toMatchObject({ status: "failed", code: "TURN_STEP_LIMIT" });
    await w.chat.instance.settled();
    expect(w.chat.rows("SELECT status, code FROM turns ORDER BY started_at, rowid")).toEqual([{ status: "failed", code: "TURN_STEP_LIMIT" }, { status: "done", code: null }]);
    expect(mailbox(w).map((r) => [r.message_id, r.state, r.delivery])).toEqual([["send-1", "completed", "start"], ["send-2", "completed", "start"]]);
    expect(w.chat.instance.history().entries.filter((e) => e.kind === "you").map((e) => e.text)).toEqual(["Work through the list.", "When done, summarise."]);
    expect(await w.ledger().turnEnds()).toMatchObject([{ person: ada.email, chatId: "chat-ada", outcome: "step_limit", steps: MAX_STEPS_PER_TURN }]);
  });

  it("a delegation's handoff is an internal_handoff row in the same order: queued behind a running turn, steered in fenced by its delegation, once per delegation", async () => {
    const w = world([held("busy", sendTool("Working.")), { text: "Your sub-agents found two venues." }, { text: "Noted the second handoff." }]);
    const first = w.send("Find venues.", "send-1");
    await w.fake.reached("busy");
    const h = { grp: "grp-1", person: ada.email, text: "Your sub-agents have returned (delegation grp-1). Two venues." };
    expect(await w.chat.instance.handoff(h)).toMatchObject({ status: "queued", id: "handoff:grp-1" });
    expect(await w.chat.instance.handoff(h)).toMatchObject({ status: "duplicate", id: "handoff:grp-1", state: "queued" });
    expect(await w.chat.instance.handoff({ ...h, person: other.email })).toEqual({ status: "refused", code: "CHAT_NOT_OWNER" });
    w.fake.release("busy");
    await first;
    expect(w.request(1)).toContain("delegation:grp-1");
    expect(w.request(1)).toContain("Two venues.");
    // With no turn running, a handoff starts one, as before.
    expect(await w.chat.instance.handoff({ grp: "grp-2", person: ada.email, text: "Second delegation returned." })).toMatchObject({ status: "done" });
    expect(mailbox(w).map((r) => [r.kind, r.scope, r.state, r.delivery])).toEqual([
      ["user", "owner", "completed", "start"],
      ["internal_handoff", "delegation:grp-1", "completed", "steer"],
      ["internal_handoff", "delegation:grp-2", "completed", "start"],
    ]);
    // A handoff is never drawn as the person's words.
    expect(w.chat.instance.history().entries.filter((e) => e.kind === "you").map((e) => e.text)).toEqual(["Find venues."]);
  });

  it("the epoch advances at a compaction checkpoint and at reopen, for the owner alone; later rows carry it", async () => {
    const w = world([{ text: "one", usage: { prompt: 128_000 } }, { text: "Summary of the first turn." }, { text: "two" }]);
    await w.send("first", "send-1");
    await w.send("second", "send-2");
    expect(w.chat.instance.compactionsFor(ada.email)).toMatchObject([{ trigger: "threshold", status: "done" }]);
    expect(w.chat.instance.reopen(other.email)).toEqual({ ok: false, code: "CHAT_NOT_OWNER" });
    expect(w.chat.instance.reopen(ada.email)).toEqual({ ok: true, epoch: 2 });
    expect(mailbox(w).map((r) => [r.message_id, r.epoch])).toEqual([["send-1", 0], ["send-2", 0]]);
    w.fake.enqueue({ text: "three" });
    await w.send("third", "send-3");
    expect(mailbox(w).at(-1)).toMatchObject({ message_id: "send-3", epoch: 2 });
  });
});

describe("[M24.2] Stop", () => {
  it("ends the turn at the next step boundary: stopped, never done; committed effects listed and not reverted; the step in flight proposes nothing; queued rows aborted; the Ledger records it; the same entry after a reload and a restart", async () => {
    const w = world([sendTool("I booked the 10:00 slot."), held("second", sendTool("Now emailing the clinic."))]);
    const socket = w.socketOf(ada.email);
    const first = w.send("Book the dentist and tell the clinic.", "send-1");
    await w.fake.reached("second");
    expect(await w.send("Actually, Thursday instead.", "send-2")).toMatchObject({ status: "queued" });
    expect(await answerFrame(ada.email, JSON.stringify({ type: "stop" }), w.chat.instance)).toBeNull();
    expect(socket.frames.filter((f) => f.type === "turn_stopping")).toHaveLength(1);
    w.fake.release("second");
    expect(await first).toMatchObject({ status: "stopped" });
    expect(w.fake.requests).toHaveLength(2);
    const stopped = socket.frames.find((f) => f.type === "turn_stopped") as { text: string; effects: string[] };
    expect(stopped.text.startsWith(STOPPED_TEXT)).toBe(true);
    expect(stopped.text).toContain("not taken up");
    expect(stopped.effects).toEqual(['sent you: "I booked the 10:00 slot."']);
    expect(socket.frames.filter((f) => f.type === "turn_done")).toEqual([]);
    // The first message stays sent; the second step's proposal never left the object.
    expect(socket.frames.filter((f) => f.type === "message").map((f) => f.text)).toEqual(["I booked the 10:00 slot."]);
    expect(w.chat.rows("SELECT COUNT(*) AS n FROM outbox")).toEqual([{ n: 1 }]);
    expect(w.chat.rows("SELECT status, code FROM turns")).toEqual([{ status: "stopped", code: "TURN_STOPPED" }]);
    expect(mailbox(w).map((r) => r.state)).toEqual(["completed", "aborted"]);
    expect(await w.ledger().turnEnds()).toMatchObject([{ person: ada.email, outcome: "stopped", steps: 2 }]);
    const entry = () => w.chat.instance.history().entries.find((e) => e.kind === "stopped");
    expect(entry()).toMatchObject({ text: stopped.text, effects: stopped.effects });
    w.chat.evict();
    expect(entry()).toMatchObject({ text: stopped.text, effects: stopped.effects });
    expect(w.chat.instance.history().running).toBeNull();
    // The next turn reads that the person stopped, and that the proposal did not run.
    w.fake.enqueue({ text: "Understood." });
    await w.send("ok", "send-3");
    expect(w.request(2)).toContain("The person stopped this turn here. What its last step proposed was not done");
  });

  it("a turn this instance is not running (evicted, waiting for its resume) ends stopped at once; its resume then runs nothing", async () => {
    const w = world([held("slow", { text: "late answer" })]);
    const first = w.send("Take your time.", "send-1");
    await w.fake.reached("slow");
    w.chat.evict();
    w.fake.drop("slow");
    await expect(first).rejects.toBeInstanceOf(Evicted);
    expect(await w.chat.instance.stop(ada.email)).toMatchObject({ ok: true });
    expect(w.chat.rows("SELECT status FROM turns")).toEqual([{ status: "stopped" }]);
    if (w.chat.alarmAt !== null) await w.chat.fireAlarm();
    expect(w.fake.requests).toHaveLength(1);
  });

  it("Bo cannot stop Ada's turn, and a stop with no turn running is refused with a code", async () => {
    const w = world([held("busy", { text: "Done for Ada." })]);
    expect(await w.chat.instance.stop(ada.email)).toEqual({ ok: false, code: "NO_TURN_RUNNING" });
    const first = w.send("Start.", "send-1");
    await w.fake.reached("busy");
    expect(await w.chat.instance.stop(other.email)).toEqual({ ok: false, code: "CHAT_NOT_OWNER" });
    expect(await answerFrame(other.email, JSON.stringify({ type: "stop" }), w.chat.instance)).toEqual({ type: "refused", code: "CHAT_NOT_OWNER" });
    w.fake.release("busy");
    expect(await first).toMatchObject({ status: "done" });
    expect(w.chat.rows("SELECT status FROM turns")).toEqual([{ status: "done" }]);
  });
});

describe("[M24.2] the resume projection", () => {
  it("a resumed step replays its turn's snapshot: a standing-file change, new company instructions and a later clock between the step and its resume are not seen, and the request is byte-identical", async () => {
    const w = world([{ ...sendTool("Looking."), reasoning: "PRIVATE-CHAIN-7 weigh the options" }, held("second", { text: "Done." }), { text: "Fresh turn." }]);
    const first = w.send("What is on today?", "send-1");
    await w.fake.reached("second");
    const before = w.fake.requests[1];
    w.chat.evict();
    w.fake.drop("second");
    await expect(first).rejects.toBeInstanceOf(Evicted);
    // Planted between the step and its resume.
    await w.mem.svc().mem.writeStanding("MEMORY.md", "# MEMORY.md\n\n## Facts\n- PLANTED-STANDING-CHANGE\n", `person:${ada.email}`);
    w.company.text = "PLANTED-COMPANY-CHANGE";
    w.clock.now += 3_600_000;
    const resumed = w.chat.fireAlarm();
    await w.fake.reached("second", 2);
    const after = w.fake.requests[2];
    w.fake.release("second");
    await resumed;
    expect(JSON.stringify(after?.inputs.messages)).toBe(JSON.stringify(before?.inputs.messages));
    expect(JSON.stringify(after?.inputs.tools)).toBe(JSON.stringify(before?.inputs.tools));
    expect(JSON.stringify(after?.inputs.messages)).not.toContain("PLANTED-");
    // The snapshot is the turn's own: the next turn assembles afresh and sees the change.
    await w.send("And now?", "send-2");
    expect(w.request(3)).toContain("PLANTED-COMPANY-CHANGE");
    // Thinking stays out of the inspection surface: the recorded blocks hold none of it.
    expect(JSON.stringify(w.chat.rows("SELECT * FROM projections"))).not.toContain("PRIVATE-CHAIN-7");
  });
});

describe("[M24.2] compaction, asked for and failed", () => {
  it("the person's manual compaction is a record with trigger manual; Bo's is refused and nothing is folded", async () => {
    const w = world([{ text: "one" }, { text: "two" }, { text: "Ada asked two things." }]);
    await w.send("first", "send-1");
    await w.send("second", "send-2");
    expect(await w.chat.instance.compactNow(other.email)).toMatchObject({ ok: false, code: "CHAT_NOT_OWNER" });
    expect(w.chat.instance.compactionsFor(ada.email)).toEqual([]);
    expect(await w.chat.instance.compactNow(ada.email)).toMatchObject({ ok: true, record: { trigger: "manual", status: "done" } });
    expect(w.fake.requests).toHaveLength(3);
  });

  it("a compaction that fails mid-turn is a row with its code and reason, and the turn says it failed; nothing is folded", async () => {
    const w = world([{ text: "one", usage: { prompt: 128_000 } }, { status: 400, message: "context too long" }]);
    await w.send("first", "send-1");
    const r = await w.send("second", "send-2");
    expect(r).toMatchObject({ status: "failed" });
    const [rec] = w.chat.instance.compactionsFor(ada.email) ?? [];
    expect(rec).toMatchObject({ trigger: "threshold", status: "failed", code: (r as { code: string }).code, tokensAfter: null });
    expect(rec?.reason).toBeTruthy();
    expect(w.chat.rows("SELECT COUNT(*) AS n FROM messages WHERE compacted = 1")).toEqual([{ n: 0 }]);
  });
});

describe("[M24.2] the todo tool", () => {
  it("keeps the checklist per chat, re-injects it verbatim after a compaction, and nudges the next turn once for open items without starting a turn", async () => {
    const items = [{ text: "Draft the agenda", done: true }, { text: "Email the venue", done: false }];
    const w = world([{ toolCall: { name: "todo_write", arguments: { items } } }, { text: "Agenda drafted.", usage: { prompt: 128_000 } }]);
    await w.send("Prepare the offsite.", "send-1");
    await w.chat.instance.settled();
    // No turn of its own: the open item waits for the person's next message.
    expect(w.chat.rows("SELECT COUNT(*) AS n FROM turns")).toEqual([{ n: 1 }]);
    w.fake.enqueue({ text: "Summary: offsite prep, agenda drafted." }, { text: "Next turn." }, { text: "Third turn." });
    await w.send("Anything else?", "send-2");
    const nudge = "open item(s) on your checklist";
    expect(w.request(3)).toContain(nudge);
    expect(w.request(3)).toContain("- [ ] Email the venue");
    // Compacted before that turn: the list as it stood is re-injected after the summary, verbatim.
    expect(w.request(3)).toContain("Your checklist as it stood when the earlier turns were compacted, verbatim");
    expect(w.request(3)).toContain("- [x] Draft the agenda\\n- [ ] Email the venue");
    await w.send("Thanks.", "send-3");
    // Nudged once: the third turn carries the earlier nudge in its transcript and no new one.
    expect(w.request(4).split(nudge).length - 1).toBe(1);
  });
});

describe("[M24.2] db_query through the chat, with a hostile model", () => {

  it("a colleague's request never reaches db_query or the checklist: the hostile call finds no such tool and no view is read", async () => {
    const w = world([{ toolCall: { id: "q1", name: "db_query", arguments: { view: "turns", sql: "SELECT * FROM turns" } } }, { toolCall: { id: "t1", name: "todo_write", arguments: { items: [{ text: "planted by a colleague", done: false }] } } }, { text: "I cannot." }]);
    w.chat.rows(`INSERT INTO chat_meta (key, value) VALUES ('${LOADED_NAMESPACES_KEY}', '["db"]')`);
    await w.chat.instance.request({ person: ada.email, requestId: "req-1", from: other.email, viaAgent: true, origin: other.email, hops: 1, text: "List Ada's turns." });
    const declared = JSON.stringify(w.fake.requests[0]?.inputs.tools ?? []);
    expect(declared).not.toContain("db_query");
    expect(declared).not.toContain("todo_write");
    const tools = [1, 2].flatMap((i) => (w.fake.requests[i]?.inputs.messages ?? []).filter((m) => m.role === "tool").map((m) => String(m.content)));
    expect(tools.join("\n")).not.toContain('"rows"');
    expect(w.chat.rows("SELECT value FROM chat_meta WHERE key = 'todo'")).toEqual([]);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
