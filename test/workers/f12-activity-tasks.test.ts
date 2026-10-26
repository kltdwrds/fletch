// F12: a task is a record. Every main-agent turn's work is a task the owner can list, read from the chat's own
// transcript and turns, never from the journal: a turn begun by the person's own words or by a colleague's request
// anchors a task, and every other turn (a continuation after a decision, a delegation's handoff) attaches to the
// latest anchor before it. `/app/activity` goes through the agent script's real `route` as Sam or Pat of solo-sam,
// each real `ChatEngine` answers for its owner, and the panel is the shipped script under the page harness. The
// model is the scripted fake.
import { describe, expect, it } from "vitest";
import { type TaskRecord, TASKS_PER_CHAT } from "../../packages/agent/src/chat/activity.ts";
import { promptTitle } from "../../packages/agent/src/chat/prompt-title.ts";
import { promptTitle as listTitle, TITLE_FROM_PROMPT } from "../../packages/agent/src/http/app/chats-list.ts";
import { ACTIVITY_GLYPH, PANEL_TEXT } from "../../packages/agent/src/http/app/panel.ts";
import { ACTIVITY_TEXT } from "../../packages/agent/src/obs/activity-words.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, person, T0 } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const pat = person("pat-solo");
const world = (o: Parameters<typeof authorityWorld>[0] = {}) => authorityWorld({ seed: [ada, pat], stores: true, ...o });
type World = ReturnType<typeof world>;
type Activity = { ok: true; tasks: TaskRecord[]; unread: Array<{ chatId: string; title: string; code: string }> };

const settle = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
const activity = async (w: World, as: string) => {
  const r = await w.http(as, "GET", "/app/activity");
  expect(r.status).toBe(200);
  return r.body as unknown as Activity;
};
/** A person's page whose requests go to the world's real routes as that person. */
async function pageOf(w: World, as: string) {
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const r = await w.http(as, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    { desktop: true },
  );
  await settle();
  return p;
}
const all = (e: El): El[] => e.children.flatMap((c) => [c, ...all(c)]);
const byClass = (e: El, cls: string) => all(e).filter((c) => c.className.split(" ").includes(cls));
const rowsOf = (e: El) => byClass(e, "prow");
const titles = (e: El) => rowsOf(e).map((r) => byClass(r, "t-sub-m")[0]?.textContent);
const lines = (e: El) => rowsOf(e).map((r) => byClass(r, "t-foot")[0]?.textContent);
const glyphs = (e: El) => rowsOf(e).map((r) => byClass(r, "prow-tile")[0]?.children[0]?.copyOf);

const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["files"] } } };
const write: FakeStep = { toolCall: { id: "w1", name: "file_write", arguments: { path: "notes/week.md", text: "Monday: the budget." } } };
const mail = (id: string): FakeStep => ({ toolCall: { id, name: "mail_send", arguments: { body: "Notes." } } });
const PROMPT = "Write my plan for the week into a file, starting with the budget review on Monday and the offsite on Friday";

describe("[F12] a task is a record", () => {
  it("a turn that only writes a file is a task titled from its prompt, done, with its times and one turn id; the tab draws it while the journal holds nothing for it", async () => {
    const w = world({ script: [load, write, { text: "Saved your week." }] });
    const { chatId, result } = await w.say(ada.email, PROMPT);
    const turnId = (result as { turnId: string }).turnId;
    expect(await w.host(ada.email).files.read({ path: "notes/week.md" }, ada.email)).toMatchObject({ ok: true });
    // No gated effect: the Ledger's journal has no row for this turn, so a list read from it would be empty.
    expect((await w.journal()).filter((r) => r.runId === turnId)).toEqual([]);
    const a = await activity(w, ada.email);
    expect(a).toEqual({
      ok: true,
      unread: [],
      tasks: [{ id: turnId, chatId, title: promptTitle(PROMPT), origin: "typed", status: "done", code: null, startedAt: T0, endedAt: T0, turnIds: [turnId], stepCount: 2, groups: [], summary: null, capped: false }],
    });
    expect(promptTitle(PROMPT).length).toBeLessThanOrEqual(TITLE_FROM_PROMPT + 1);
    expect(promptTitle(PROMPT).endsWith("…")).toBe(true);
    const box = (await pageOf(w, ada.email)).byId("panel-activity");
    expect([titles(box), lines(box), glyphs(box)]).toEqual([[promptTitle(PROMPT)], [ACTIVITY_TEXT.status.done], [`glyph-${ACTIVITY_GLYPH.done}`]]);
    expect(box.text()).not.toContain(PANEL_TEXT.activityEmpty);
    // The one task opens by its chat and anchor turn.
    expect((await w.http(ada.email, "GET", `/app/activity/${chatId}/${turnId}`)).body).toEqual({ ok: true, task: a.tasks[0] });
  });

  it("a mail proposal decided later continues under the same task: waiting on Sam, then done with the continuation's turn", async () => {
    const w = world();
    w.fake.enqueue(mail("m1"));
    const { chatId, result } = await w.say(ada.email, "Mail Pat the notes.");
    const anchor = (result as { turnId: string }).turnId;
    const [waiting] = (await activity(w, ada.email)).tasks as [TaskRecord];
    expect([waiting.id, waiting.status, waiting.code, waiting.endedAt, waiting.turnIds]).toEqual([anchor, "waiting", "AWAITING_DECISION", null, [anchor]]);
    const box = (await pageOf(w, ada.email)).byId("panel-activity");
    expect([lines(box), glyphs(box)]).toEqual([[ACTIVITY_TEXT.status.waiting], [`glyph-${ACTIVITY_GLYPH.waiting}`]]);
    w.clock.now += 60_000;
    w.fake.enqueue({ text: "Sent." });
    const card = w.cardsOf(ada.email).find((c) => c.state === "pending") as { id: string };
    await w.chats.harness(chatId).instance.decide([card.id], { person: ada.email, agent: false }, "once");
    const turns = w.chats.harness(chatId).instance.history();
    expect(turns.running).toBeNull();
    const tasks = (await activity(w, ada.email)).tasks;
    expect(tasks).toHaveLength(1);
    const [done] = tasks as [TaskRecord];
    expect([done.id, done.title, done.status, done.code, done.turnIds.length, done.turnIds[0], done.startedAt, done.endedAt]).toEqual([anchor, "Mail Pat the notes.", "done", null, 2, anchor, T0, T0 + 60_000]);
  });

  it("a delegation's handoff turn attaches to the task that delegated, its group a join key; the next typed message is a task of its own", async () => {
    const w = world({ script: [{ text: "I have asked two sub-agents to look." }, { text: "Your sub-agents found two venues." }, { text: "Booked." }] });
    const { chatId, result } = await w.say(ada.email, "Find a venue for the offsite");
    const anchor = (result as { turnId: string }).turnId;
    w.clock.now += 1000;
    const handed = await w.chats.harness(chatId).instance.handoff({ grp: "grp-1", person: ada.email, text: "Two venues came back." });
    expect(handed).toMatchObject({ status: "done" });
    w.clock.now += 1000;
    await w.say(ada.email, "Book the first one", chatId);
    const tasks = (await activity(w, ada.email)).tasks;
    expect(tasks.map((t) => [t.title, t.turnIds.length, t.groups])).toEqual([
      ["Book the first one", 1, []],
      ["Find a venue for the offsite", 2, ["grp-1"]],
    ]);
    expect(tasks[1]?.turnIds).toEqual([anchor, (handed as { turnId: string }).turnId]);
  });

  it("a colleague's request is its own task, titled from the request, never from the harness's framing", async () => {
    const w = world({ script: [{ text: "Here are the numbers." }] });
    await w.request({ from: pat.email, to: ada.email, text: "Please send me the third quarter numbers", origin: pat.email, hops: 0, viaAgent: false });
    const [task] = (await activity(w, ada.email)).tasks as [TaskRecord];
    expect([task.title, task.origin, task.status, task.turnIds.length]).toEqual(["Please send me the third quarter numbers", "request", "done", 1]);
    // The colleague sees none of it: the request ran in Sam's chat.
    expect((await activity(w, pat.email)).tasks).toEqual([]);
  });

  it("a compacted anchor still lists with its title and step count", async () => {
    const w = world({ script: [load, write, { text: "Saved." }, { text: "Noted." }, { text: "Sam wrote the week plan, then asked about Friday." }] });
    const { chatId } = await w.say(ada.email, "Write my week plan");
    w.clock.now += 60_000;
    await w.say(ada.email, "And Friday?", chatId);
    const before = (await activity(w, ada.email)).tasks;
    expect(await w.chats.harness(chatId).instance.compactNow(ada.email)).toMatchObject({ ok: true, record: { status: "done" } });
    // The first task's messages are folded away from the live transcript.
    expect(w.chats.harness(chatId).rows("SELECT body FROM messages WHERE compacted = 1").some((r) => String(r.body).includes("Write my week plan"))).toBe(true);
    const after = (await activity(w, ada.email)).tasks;
    expect(after).toEqual(before);
    expect(after.map((t) => [t.title, t.stepCount])).toEqual([["And Friday?", 0], ["Write my week plan", 2]]);
  });

  it("Pat cannot list or open Sam's task: his list has none, and the task's address answers 403 CHAT_NOT_OWNER", async () => {
    const w = world({ script: [{ text: "Done." }] });
    const { chatId, result } = await w.say(ada.email, "Draft the agenda");
    const turnId = (result as { turnId: string }).turnId;
    expect((await activity(w, ada.email)).tasks.map((t) => t.id)).toEqual([turnId]);
    expect(await activity(w, pat.email)).toEqual({ ok: true, tasks: [], unread: [] });
    const open = await w.http(pat.email, "GET", `/app/activity/${chatId}/${turnId}`);
    expect([open.status, open.body.code]).toEqual([403, "CHAT_NOT_OWNER"]);
    const missing = await w.http(ada.email, "GET", `/app/activity/${chatId}/${crypto.randomUUID()}`);
    expect([missing.status, missing.body.code]).toEqual([404, "TASK_NOT_FOUND"]);
    const malformed = await w.http(ada.email, "GET", `/app/activity/${chatId}/not-a-turn`);
    expect([malformed.status, malformed.body.code]).toEqual([404, "TASK_NOT_FOUND"]);
    const pb = (await pageOf(w, pat.email)).byId("panel-activity");
    expect([rowsOf(pb).length, pb.text()]).toEqual([0, PANEL_TEXT.activityEmpty]);
  });

  it("a chat whose read fails is named in unread and the tab says it could not read it, never empty", async () => {
    const w = world({ script: [{ text: "One." }, { text: "Two." }] });
    const good = await w.say(ada.email, "Plan the harbour day");
    w.clock.now += 1000;
    const broken = await w.say(ada.email, "Plan the ferry");
    const app = (w.dir as unknown as { app: { chatTasks(p: string, c: string): Promise<unknown> } }).app;
    const real = app.chatTasks;
    app.chatTasks = async (p, c) => {
      if (c === broken.chatId) throw new Error("chat unreachable");
      return real(p, c);
    };
    const a = await activity(w, ada.email);
    expect(a.tasks.map((t) => t.chatId)).toEqual([good.chatId]);
    expect(a.unread).toEqual([{ chatId: broken.chatId, title: "New chat", code: "APP_READ_FAILED" }]);
    const box = (await pageOf(w, ada.email)).byId("panel-activity");
    expect(titles(box)).toEqual(["Plan the harbour day"]);
    expect(box.text()).toContain("Could not read \u201cNew chat\u201d");
    expect(all(box).filter((e) => e.dataset.code).map((e) => e.dataset.code)).toEqual(["APP_READ_FAILED"]);
    // With only the unreadable chat, the tab still says so, never that there is nothing yet.
    app.chatTasks = async () => {
      throw new Error("chat unreachable");
    };
    const only = (await pageOf(w, ada.email)).byId("panel-activity");
    expect(only.text()).toContain("Could not read");
    expect(only.text()).not.toContain(PANEL_TEXT.activityEmpty);
  });

  it("the tab draws every status in words from one table, with its glyph, newest first in day groups, cut at the limits", async () => {
    for (const s of ["running", "waiting", "done", "failed", "stopped"] as const) {
      expect(ACTIVITY_TEXT.status[s]).toBeTruthy();
      expect(ACTIVITY_GLYPH[s]).toBeTruthy();
    }
    expect(ACTIVITY_TEXT.status.failed).toContain("{code}");
    expect(TASKS_PER_CHAT).toBe(50);
    const w = world({ script: [{ text: "Yesterday's." }] });
    const { chatId } = await w.say(ada.email, "Yesterday's task");
    w.clock.now += 86_400_000;
    // A turn that fails says its code in the row.
    w.fake.enqueue({ status: 400, message: "the model refused the request" });
    await w.say(ada.email, "Today's task", chatId);
    const tasks = (await activity(w, ada.email)).tasks;
    expect(tasks.map((t) => [t.title, t.status])).toEqual([["Today's task", "failed"], ["Yesterday's task", "done"]]);
    const box = (await pageOf(w, ada.email)).byId("panel-activity");
    expect(box.children.filter((c) => c.tag === "h3")).toHaveLength(2);
    expect(titles(box)).toEqual(["Today's task", "Yesterday's task"]);
    expect(lines(box)[0]).toBe(ACTIVITY_TEXT.status.failed.replace("{code}", tasks[0]?.code ?? ""));
    expect(glyphs(box)).toEqual([`glyph-${ACTIVITY_GLYPH.failed}`, `glyph-${ACTIVITY_GLYPH.done}`]);
  });

  it("promptTitle through chats-list.ts is the one in chat/prompt-title.ts", () => {
    expect(listTitle).toBe(promptTitle);
  });
});
