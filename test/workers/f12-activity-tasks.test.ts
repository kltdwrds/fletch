// F12: a task is a record. Every main-agent turn's work is a task its owner can list, read from the chat's own turns,
// so work that leaves no journal row (a file written) is listed too. `/app/activity` goes through the agent script's
// real `route` as Sam (the plan's Ada) or Pat (its Bo) of solo-sam; the person's real `PersonChats` says which chats
// are theirs and each real `ChatEngine` answers its own tasks for its owner. The page is the shipped script under the
// page harness. The model is the scripted fake.
import { describe, expect, it } from "vitest";
import { type TaskReads, type TaskRecord, tasksOf } from "../../packages/agent/src/chat/activity.ts";
import { promptTitle, TITLE_FROM_PROMPT } from "../../packages/agent/src/chat/prompt-title.ts";
import type { ChatStore } from "../../packages/agent/src/chat/store.ts";
import { TASKS_SHOWN } from "../../packages/agent/src/http/app-routes.ts";
import * as chatsList from "../../packages/agent/src/http/app/chats-list.ts";
import { ACTIVITY_GLYPH, ACTIVITY_TEXT, PANEL_TEXT } from "../../packages/agent/src/http/app/panel.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, person } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const pat = person("pat-solo");
const world = (o: { stores?: boolean } = {}) => authorityWorld({ script: [], seed: [ada, pat], ...o });
type World = ReturnType<typeof world>;
type Activity = { ok: boolean; tasks: TaskRecord[]; unread: Array<{ chatId: string; title: string; code: string }> };

const activity = async (w: World, as: string) => {
  const r = await w.http(as, "GET", "/app/activity");
  expect(r.status).toBe(200);
  return r.body as unknown as Activity;
};
/** The engine's own reads, as `ChatEngine.taskReads` hands them to `tasksOf`. */
const readsOf = (w: World, chatId: string): TaskReads => {
  const e = w.chats.harness(chatId).instance as unknown as { taskReads: TaskReads };
  return e.taskReads;
};

const settle = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
/** The person's page, its requests answered by the world's real routes as that person. */
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

const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["files"] } } };
const write: FakeStep = { toolCall: { id: "w1", name: "file_write", arguments: { path: "work/ferry.md", text: "Ferry at 9.\n" } } };
const mail = (id: string): FakeStep => ({ toolCall: { id, name: "mail_send", arguments: { body: "Notes." } } });

describe("[F12] a task is a record", () => {
  it("a turn that only writes a file is a task titled from the prompt, done, with its times and one turn, drawn on the Activity tab while the Ledger holds no journal row for it", async () => {
    const w = world({ stores: true });
    w.fake.enqueue(load, write, { text: "Saved it." });
    const started = w.clock.now;
    const { chatId } = await w.say(ada.email, "Write the ferry time into my notes");
    const turns = w.chats.harness(chatId).rows("SELECT id, ended_at FROM turns");
    expect(turns).toHaveLength(1);
    // The file was written: the tool answered, and no card or gate stood in the way.
    expect(w.chats.harness(chatId).rows("SELECT body FROM messages WHERE role = 'toolResult'").map((r) => String(r.body)).some((b) => b.includes("saved work/ferry.md"))).toBe(true);
    const a = await activity(w, ada.email);
    expect(a).toEqual({
      ok: true,
      unread: [],
      tasks: [
        {
          id: turns[0]?.id,
          chatId,
          title: "Write the ferry time into my notes",
          origin: "typed",
          status: "done",
          code: null,
          startedAt: started,
          endedAt: turns[0]?.ended_at,
          turnIds: [turns[0]?.id],
          stepCount: 2,
          groups: [],
          summary: null,
          capped: false,
        },
      ],
    });
    expect(typeof a.tasks[0]?.endedAt).toBe("number");
    // Planted: a list read from the journal alone. The Ledger holds no row for this turn, nor any for Sam, so it
    // would be empty; the tasks list is not.
    const journal = await w.journal();
    expect(journal.filter((r) => r.runId === turns[0]?.id || r.principal === ada.email)).toEqual([]);
    const p = await pageOf(w, ada.email);
    const box = p.byId("panel-activity");
    const rows = byClass(box, "prow");
    expect(rows.map((r) => [byClass(r, "t-sub-m")[0]?.textContent, byClass(r, "t-foot")[0]?.textContent, r.dataset.task])).toEqual([["Write the ferry time into my notes", ACTIVITY_TEXT.status.done, `${chatId}/${turns[0]?.id}`]]);
    expect(byClass(rows[0] as El, "prow-tile")[0]?.children[0]?.copyOf).toBe(`glyph-${ACTIVITY_GLYPH.done}`);
    expect(box.text()).not.toContain(PANEL_TEXT.activityEmpty);
    // The one task opens by its chat and anchor turn.
    const one = await w.http(ada.email, "GET", `/app/activity/${chatId}/${turns[0]?.id}`);
    expect([one.status, one.body]).toEqual([200, { ok: true, task: a.tasks[0] }]);
  });

  it("a mail proposal decided later continues under the same task: the continuation turn attaches", async () => {
    const w = world();
    w.fake.enqueue(mail("m1"));
    const { chatId } = await w.say(ada.email, "Mail Pat the notes.");
    const waiting = (await activity(w, ada.email)).tasks;
    expect(waiting.map((t) => [t.title, t.status, t.endedAt, t.turnIds.length])).toEqual([["Mail Pat the notes.", "waiting", null, 1]]);
    w.fake.enqueue({ text: "Sent." });
    w.clock.now += 60_000;
    const card = w.cardsOf(ada.email).find((c) => c.state === "pending") as { id: string };
    await w.chats.harness(chatId).instance.decide([card.id], { person: ada.email, agent: false }, "once");
    const turns = w.chats.harness(chatId).rows("SELECT id FROM turns ORDER BY started_at, rowid").map((r) => r.id);
    expect(turns).toHaveLength(2);
    const [task] = (await activity(w, ada.email)).tasks;
    expect([task?.id, task?.title, task?.status, task?.turnIds, task?.stepCount]).toEqual([turns[0], "Mail Pat the notes.", "done", turns, 1]);
  });

  it("a delegation's handoff turn attaches to the task that delegated; the person's next words begin a new task", async () => {
    const w = world();
    w.fake.enqueue({ text: "I asked two workers." }, { text: "The workers found three ferries." }, { text: "The 9:10." });
    const { chatId } = await w.say(ada.email, "Find me a ferry to the island");
    w.clock.now += 1000;
    expect(await w.chats.harness(chatId).instance.handoff({ grp: "g1", person: ada.email, text: "HANDOFF: three ferries found." })).toMatchObject({ status: "done" });
    w.clock.now += 1000;
    await w.say(ada.email, "Which one is earliest?", chatId);
    const turns = w.chats.harness(chatId).rows("SELECT id FROM turns ORDER BY started_at, rowid").map((r) => r.id);
    const tasks = (await activity(w, ada.email)).tasks;
    expect(tasks.map((t) => [t.title, t.turnIds])).toEqual([
      ["Which one is earliest?", [turns[2]]],
      ["Find me a ferry to the island", [turns[0], turns[1]]],
    ]);
  });

  it("a colleague's request is its own task in the receiver's list, titled from the request; the sender's list holds none of it", async () => {
    const w = world();
    w.fake.enqueue({ text: "I'll look at it." });
    const text = "Please look at the wombat budget for the spring offsite, line by line, and say what you would cut";
    await w.request({ from: ada.email, to: pat.email, text, origin: ada.email, hops: 0, viaAgent: false });
    const mine = (await activity(w, pat.email)).tasks;
    expect(mine.map((t) => [t.title, t.origin, t.status])).toEqual([[promptTitle(text), "request", "done"]]);
    expect(mine[0]?.title.endsWith("…")).toBe(true);
    expect((await activity(w, ada.email)).tasks).toEqual([]);
  });

  it("a compacted anchor still lists with its title and step count; planted: a `compacted = 0` filter in `rowsOfTurns` loses both", async () => {
    const w = world({ stores: true });
    w.fake.enqueue(load, write, { text: "Saved." }, { text: "Done again." }, { text: "Sam saved the ferry time; then asked again." });
    const { chatId } = await w.say(ada.email, "Write the ferry time into my notes");
    w.clock.now += 60_000;
    await w.say(ada.email, "Thanks, anything else?", chatId);
    const before = (await activity(w, ada.email)).tasks;
    expect(await w.chats.harness(chatId).instance.compactNow(ada.email)).toMatchObject({ ok: true, record: { status: "done" } });
    const h = w.chats.harness(chatId);
    const anchor = before.at(-1) as TaskRecord;
    // The anchor's own messages are folded out of the prompt now.
    expect(h.rows("SELECT compacted FROM messages WHERE turn_id = ?", anchor.id).map((r) => r.compacted)).toContain(1);
    const after = (await activity(w, ada.email)).tasks;
    expect(after).toEqual(before);
    expect([anchor.title, anchor.stepCount]).toEqual(["Write the ferry time into my notes", 2]);
    // Planted: the same reads with the transcript's `compacted = 0` filter in `rowsOfTurns`.
    const reads = readsOf(w, chatId);
    const filtered = Object.create(reads.store) as ChatStore;
    const kept = new Set(h.rows("SELECT seq FROM messages WHERE compacted = 0").map((r) => r.seq));
    filtered.rowsOfTurns = (ids) => reads.store.rowsOfTurns(ids).filter((r) => kept.has(r.seq));
    const planted = tasksOf({ ...reads, store: filtered }).find((t) => t.id === anchor.id);
    expect([planted?.title, planted?.stepCount]).not.toEqual([anchor.title, anchor.stepCount]);
  });

  it("Pat cannot list or open Sam's task: his list has none, and the task's address answers 403 with CHAT_NOT_OWNER", async () => {
    const w = world();
    w.fake.enqueue({ text: "Noted." });
    const { chatId } = await w.say(ada.email, "Note the ferry at nine");
    const [task] = (await activity(w, ada.email)).tasks;
    expect((await activity(w, pat.email)).tasks).toEqual([]);
    const theirs = await w.http(pat.email, "GET", `/app/activity/${chatId}/${task?.id}`);
    expect([theirs.status, theirs.body]).toEqual([403, { ok: false, code: "CHAT_NOT_OWNER" }]);
    const unknown = await w.http(ada.email, "GET", `/app/activity/${chatId}/${crypto.randomUUID()}`);
    expect([unknown.status, unknown.body]).toEqual([404, { ok: false, code: "TASK_NOT_FOUND" }]);
    expect((await w.http(ada.email, "GET", `/app/activity/${chatId}/not-a-turn`)).status).toBe(404);
    expect((await w.http(ada.email, "GET", `/app/activity/not-a-chat/${task?.id}`)).body).toEqual({ ok: false, code: "CHAT_NOT_FOUND" });
  });

  it("every chat's tasks merge newest first; a chat whose read fails is named in unread and the tab says Could not read for it, never empty", async () => {
    const w = world();
    w.fake.enqueue({ text: "One." }, { text: "Two." }, { text: "Three." });
    const first = await w.say(ada.email, "First errand");
    w.clock.now += 1000;
    const broken = await w.say(ada.email, "Second errand");
    w.clock.now += 1000;
    await w.say(ada.email, "Third errand", first.chatId);
    expect((await activity(w, ada.email)).tasks.map((t) => t.title)).toEqual(["Third errand", "Second errand", "First errand"]);
    expect(TASKS_SHOWN).toBe(100);
    const app = (w.dir as unknown as { app: { chatTasks(p: string, c: string): Promise<unknown> } }).app;
    const real = app.chatTasks;
    app.chatTasks = async (p, c) => {
      if (c === broken.chatId) throw new Error("chat unreachable");
      return real(p, c);
    };
    const a = await activity(w, ada.email);
    expect([a.tasks.map((t) => t.title), a.unread]).toEqual([["Third errand", "First errand"], [{ chatId: broken.chatId, title: "New chat", code: "APP_READ_FAILED" }]]);
    const p = await pageOf(w, ada.email);
    const box = p.byId("panel-activity");
    const note = all(box).find((e) => e.dataset.code === "APP_READ_FAILED");
    expect(note?.textContent).toBe("Could not read the tasks in “New chat” just now. Reload the page to try again.");
    expect(byClass(box, "prow")).toHaveLength(2);
    // With no task read at all, the tab still says what it could not read and never "Nothing yet".
    app.chatTasks = async () => {
      throw new Error("chat unreachable");
    };
    const q = await pageOf(w, ada.email);
    const said = q.byId("panel-activity").text();
    expect(said).toContain("Could not read the tasks in “New chat”");
    expect(said).not.toContain(PANEL_TEXT.activityEmpty);
  });

  it("a person with no tasks is told Nothing yet; promptTitle through chats-list.ts is the one rule", async () => {
    const w = world();
    const p = await pageOf(w, pat.email);
    expect([byClass(p.byId("panel-activity"), "prow").length, p.byId("panel-activity").text()]).toEqual([0, PANEL_TEXT.activityEmpty]);
    expect([chatsList.promptTitle, chatsList.TITLE_FROM_PROMPT]).toEqual([promptTitle, TITLE_FROM_PROMPT]);
  });
});
