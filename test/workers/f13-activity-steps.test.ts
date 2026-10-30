// F13: the step timeline. A task's steps are its tool calls as the chat's transcript stores them, in seq order, each
// paired with the result of the same call id and titled by code from `STEP_WORDS`; a gated action's outcome is joined
// from the journal by call id within the task's turns. `GET /app/activity/<chat>/<turn>` goes through the agent
// script's real `route` as Sam (and Pat, the second member of solo-sam), each real `ChatEngine` answers for its owner,
// the working tree is the person's real Workspace and Code Mode is a scripted runner. The model is the scripted fake.
import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../../packages/agent/src/chat/activity.ts";
import { BLOCK_CHARS, type StepRecord, STEPS_PER_TASK, stepsOf, STEP_WORDS } from "../../packages/agent/src/chat/activity-steps.ts";
import type { RunResult } from "../../packages/agent/src/code/run.ts";
import { fence, unfence } from "../../packages/agent/src/context/fence.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, person } from "./support/authority-world.ts";

const pat = person("pat-solo");
/** Code Mode as a scripted runner: a script that throws answers `CODE_SCRIPT_THREW`, any other its result. */
const code = () => ({
  run: async (req: { script: string }): Promise<RunResult> =>
    req.script.includes("throw") ? { ok: false, code: "CODE_SCRIPT_THREW", reason: "Error: the totals do not add up", logs: [] } : { ok: true, result: { total: 42 }, logs: [], workerId: "solo-sam:abc", loaded: true },
});
const world = (o: Parameters<typeof authorityWorld>[0] = {}) => authorityWorld({ seed: [ada, pat], stores: true, vault: { code }, ...o });
type World = ReturnType<typeof world>;
type Task = { ok: true; task: TaskRecord; steps: StepRecord[] };

const PLAN = "# Offsite\n- venue: open\n- budget: 1200\n";
const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, arguments: args });
const one = (id: string, name: string, args: Record<string, unknown>): FakeStep => ({ toolCall: call(id, name, args) });
/** The fallback shape: read, edit, edit the same path, a script that throws, one that returns, the checklist and memory, an answer. */
const FALLBACK: FakeStep[] = [
  one("c0", "tool_search", { load: ["files", "code"] }),
  one("c1", "file_read", { path: "work/offsite.md" }),
  one("c2", "file_edit", { path: "work/offsite.md", oldText: "- venue: open", newText: "- venue: Henley boathouse" }),
  one("c3", "file_edit", { path: "work/offsite.md", oldText: "- budget: 1200", newText: "- budget: 1500\n- catering: <b>vegetarian</b>" }),
  one("c4", "code_execute", { script: "throw new Error('the totals do not add up')" }),
  one("c5", "code_execute", { script: "return { total: 40 + 2 };" }),
  {
    toolCalls: [
      call("c6", "todo_write", { items: [{ text: "Book the <b>boathouse</b>", done: false }, { text: "Fix the budget", done: true }] }),
      call("c7", "memory_write", { target: "daily", text: "The offsite is at the Henley boathouse." }),
      call("c8", "send_to_user", { text: "Halfway there." }),
    ],
  },
  { text: "The offsite plan is updated: Henley boathouse, budget 1500." },
];

async function open(w: World, as: string, chatId: string, turnId: string) {
  return w.http(as, "GET", `/app/activity/${chatId}/${turnId}`);
}
async function task(w: World, chatId: string, turnId: string): Promise<Task> {
  const r = await open(w, ada.email, chatId, turnId);
  expect(r.status).toBe(200);
  return r.body as unknown as Task;
}
async function fallback(w: World) {
  await w.host(ada.email).tree.write({ path: "work/offsite.md", text: PLAN }, ada.email);
  const { chatId, result } = await w.say(ada.email, "Update the offsite plan");
  const turnId = (result as { turnId: string }).turnId;
  return { chatId, turnId, ...(await task(w, chatId, turnId)) };
}

describe("[F13] the step timeline", () => {
  it("a task of the fallback shape lists its steps in order with the table's titles and kinds, the summary last", async () => {
    const w = world({ script: FALLBACK });
    const { steps, task: t } = await fallback(w);
    expect(steps.map((s) => [s.n, s.kind, s.tool, s.state, s.title])).toEqual([
      [1, "load", "tool_search", "done", "Loaded the files, code tools"],
      [2, "read", "file_read", "done", "Read `work/offsite.md`"],
      [3, "edit", "file_edit", "done", "Edited `work/offsite.md`"],
      [4, "edit", "file_edit", "done", "Edited `work/offsite.md`"],
      [5, "code", "code_execute", "failed", "Ran a script failed (CODE_SCRIPT_THREW)"],
      [6, "code", "code_execute", "done", "Ran a script"],
      [7, "todo", "todo_write", "done", "Updated the checklist: 1 open, 1 done; next: Book the <b>boathouse</b>"],
      [8, "memory", "memory_write", "done", "Saved to memory"],
      [9, "summary", "", "done", "Summary"],
    ]);
    // The titles are the table's own, per tool.
    expect(steps[1]?.title).toBe(STEP_WORDS.file_read?.title({ path: "work/offsite.md" }));
    expect(steps[5]?.title).toBe(STEP_WORDS.code_execute?.title({}));
    // The list's count and the timeline agree: eight steps, never the message to the person.
    expect([t.stepCount, t.capped, t.status]).toEqual([8, false, "done"]);
    expect(steps.map((s) => s.callId)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", ""]);
  });

  it("the failed script is failed with its code in the title and in the detail's result; each result is the tool's own text, unfenced", async () => {
    const w = world({ script: FALLBACK });
    const { steps } = await fallback(w);
    const [failed, ran] = [steps[4], steps[5]] as [StepRecord, StepRecord];
    expect([failed.state, failed.code]).toEqual(["failed", "CODE_SCRIPT_THREW"]);
    expect(failed.detail.result).toMatchObject({ ok: false, code: "CODE_SCRIPT_THREW", text: "CODE_SCRIPT_THREW: Error: the totals do not add up" });
    expect(failed.detail.blocks).toEqual([{ label: "Script", text: "throw new Error('the totals do not add up')", lang: "js", cut: false }]);
    expect(ran.detail.result).toMatchObject({ ok: true, code: null });
    expect(ran.detail.result?.text).toMatch(/^result: \{"total":42\}/);
    // The outer fence the barrier wrote is gone, and only it.
    for (const s of steps) expect(s.detail.result?.text ?? "").not.toContain("EXTERNAL CONTENT");
    const read = steps[1] as StepRecord;
    expect(read.detail.result?.text).toContain("2: - venue: open");
    // The edit's detail carries its change and what it replaced.
    expect((steps[3] as StepRecord).detail.blocks.map((b) => [b.label, b.text])).toEqual([["Change", "- budget: 1500\n- catering: <b>vegetarian</b>"], ["Before", "- budget: 1200"]]);
    expect((steps[3] as StepRecord).detail.result?.text).toMatch(/^edited work\/offsite\.md at line 3/);
  });

  it("the same path edited twice is two steps, and every step with a stored result carries a start time and a duration", async () => {
    const w = world({ script: FALLBACK });
    const { steps } = await fallback(w);
    // Planted: a dedupe by path would leave one edit step.
    expect(steps.filter((s) => s.kind === "edit").map((s) => s.callId)).toEqual(["c2", "c3"]);
    expect(steps.filter((s) => s.tool === "code_execute")).toHaveLength(2);
    const answered = steps.filter((s) => s.detail.result !== null);
    expect(answered).toHaveLength(8);
    for (const s of answered) {
      expect(typeof s.startedAt).toBe("number");
      expect(typeof s.endedAt).toBe("number");
      expect(typeof s.durationMs).toBe("number");
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
      expect(s.detail.result?.durationMs).toBe(s.durationMs);
    }
  });

  it("no send_to_user step appears, nor a reaction; the todo's items are lines and a <b> in one is text in the title", async () => {
    const w = world({ script: FALLBACK });
    const { steps } = await fallback(w);
    expect(steps.some((s) => s.tool === "send_to_user" || s.tool === "react")).toBe(false);
    const todo = steps.find((s) => s.kind === "todo") as StepRecord;
    // The data, not the page: the characters as the model wrote them, never escaped or stripped here (the page half is F16).
    expect(todo.title).toContain("<b>boathouse</b>");
    expect(todo.detail.lines).toEqual(["Open: Book the <b>boathouse</b>", "Done: Fix the budget"]);
    const memory = steps.find((s) => s.kind === "memory") as StepRecord;
    expect(memory.detail.blocks.map((b) => [b.label, b.text])).toEqual([["Saved", "The offsite is at the Henley boathouse."]]);
  });

  it("the summary is the last step: code's counts, the final text quoted as the agent's, and a card naming the edited file with a preview of its change", async () => {
    const w = world({ script: FALLBACK });
    const { steps, task: t } = await fallback(w);
    const summary = steps.at(-1) as StepRecord;
    expect(summary.kind).toBe("summary");
    // F31: the counts are code's, from the steps' states (the done tool load is not counted); the reply is quoted whole.
    expect(summary.detail.prose).toBe("Read 1; wrote 3 (work/offsite.md); ran 2, 1 failed; 1 other");
    expect(summary.detail.blocks.map((b) => [b.label, b.text])).toEqual([["The agent's reply, in its own words", "The offsite plan is updated: Henley boathouse, budget 1500."]]);
    // Newest change first, one card per path.
    expect(summary.detail.files).toEqual([{ path: "work/offsite.md", preview: "- budget: 1500\n- catering: <b>vegetarian</b>" }]);
    // The summary is never the title.
    expect(t.title).toBe("Update the offsite plan");
  });

  it("a gated action's step carries the journal's outcome by call id: an auto mail is done, a card left pending waits, a declined card is refused", async () => {
    const w = world();
    await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "mail.send" }, mode: "auto" });
    w.fake.enqueue(one("auto1", "mail_send", { to: pat.email, body: "Notes." }), { text: "Sent." });
    const auto = await w.say(ada.email, "Mail Pat the notes.");
    const autoTurn = (auto.result as { turnId: string }).turnId;
    const sent = await task(w, auto.chatId, autoTurn);
    expect(sent.steps.map((s) => [s.kind, s.tool, s.state, s.code, s.title])).toEqual([
      ["action", "mail_send", "done", null, "Mail send"],
      ["summary", "", "done", null, "Summary"],
    ]);
    expect(sent.steps[0]?.detail.lines).toEqual(["It went ahead under a permission you gave.", "Done."]);
    // The journal names the call by the chat's id and the call's, under the task's turn.
    expect((await w.journal()).filter((r) => r.runId === autoTurn).map((r) => r.id)).toEqual([`${auto.chatId}:auto1`]);

    const w2 = world();
    // The card pauses the turn at the call: the next scripted step is the continuation's.
    w2.fake.enqueue(one("ask1", "mail_send", { to: pat.email, body: "Draft." }));
    const asked = await w2.say(ada.email, "Mail Pat the draft.");
    const askedTurn = (asked.result as { turnId: string }).turnId;
    const waiting = await task(w2, asked.chatId, askedTurn);
    expect(waiting.steps.map((s) => [s.tool, s.state, s.code])).toEqual([["mail_send", "waiting", null]]);
    expect(waiting.steps[0]?.detail.lines).toEqual(["You were asked first.", "Waiting for your decision."]);

    w2.fake.enqueue({ text: "Understood, not sent." });
    const card = w2.cardsOf(ada.email).find((c) => c.state === "pending") as { id: string };
    expect(card.id).toBe("ask1");
    await w2.chats.harness(asked.chatId).instance.decide([card.id], { person: ada.email, agent: false }, "deny");
    const declined = await task(w2, asked.chatId, askedTurn);
    expect(declined.steps.map((s) => [s.tool, s.state, s.code, s.title])).toEqual([
      ["mail_send", "refused", "DECLINED", "Mail send: not done (DECLINED)"],
      ["", "done", null, "Summary"],
    ]);
    // The continuation after the decision is the task's last finished turn: its words are the summary.
    expect([declined.task.turnIds.length, declined.task.turnIds[0], declined.steps.at(-1)?.detail.blocks[0]?.text]).toEqual([2, askedTurn, "Understood, not sent."]);
    expect(declined.steps[0]?.detail.lines).toEqual(["You were asked first.", "Waiting for your decision.", "It was held back.", "You declined it."]);
  });

  it("a join that drops the journal row's id or runId before matching finds nothing", async () => {
    const w = world();
    await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "mail.send" }, mode: "auto" });
    w.fake.enqueue(one("auto1", "mail_send", { to: pat.email, body: "Notes." }), { text: "Sent." });
    const { chatId, result } = await w.say(ada.email, "Mail Pat the notes.");
    const turnId = (result as { turnId: string }).turnId;
    const rows = w.chats.harness(chatId).rows("SELECT seq, turn_id, body FROM messages WHERE turn_id = ? ORDER BY seq", turnId).map((r) => ({ seq: Number(r.seq), turnId: String(r.turn_id), message: JSON.parse(String(r.body)) }));
    const journal = await w.journal();
    const joined = stepsOf(rows, journal, { chatId });
    expect(joined.map((s) => [s.kind, s.state])).toEqual([["action", "done"]]);
    // Planted: a row matched without its id (another call's row under the same turn) or without its runId (the same
    // call id under another turn) must not join.
    const otherId = journal.map((r) => ({ ...r, id: `${chatId}:another-call` }));
    const otherRun = journal.map((r) => ({ ...r, runId: crypto.randomUUID() }));
    const otherChat = journal.map((r) => ({ ...r, id: `${crypto.randomUUID()}:auto1` }));
    for (const j of [otherId, otherRun, otherChat, []]) {
      const s = stepsOf(rows, j, { chatId });
      expect(s.map((x) => [x.kind, x.state, x.title])).toEqual([["other", "done", "Called mail send"]]);
    }
  });

  it("a compacted task lists every step, and Pat's read of Sam's task answers 403 CHAT_NOT_OWNER with no steps", async () => {
    const w = world({ script: [...FALLBACK, { text: "Noted." }, { text: "Sam updated the offsite plan, then asked about Friday." }] });
    const { chatId, turnId, steps: before } = await fallback(w);
    w.clock.now += 60_000;
    await w.say(ada.email, "And Friday?", chatId);
    expect(await w.chats.harness(chatId).instance.compactNow(ada.email)).toMatchObject({ ok: true, record: { status: "done" } });
    expect(w.chats.harness(chatId).rows("SELECT body FROM messages WHERE compacted = 1").some((r) => String(r.body).includes("file_edit"))).toBe(true);
    // Planted: a `compacted = 0` filter in the read would leave this task with no steps.
    const after = await task(w, chatId, turnId);
    expect(after.steps).toEqual(before);
    expect(after.steps).toHaveLength(9);
    const denied = await open(w, pat.email, chatId, turnId);
    expect([denied.status, denied.body.code, "steps" in denied.body]).toEqual([403, "CHAT_NOT_OWNER", false]);
  });

  it(`a task of 250 calls answers ${STEPS_PER_TASK - 1} steps, the marker and the summary, and is capped`, async () => {
    const batch = (k: number): FakeStep => ({ toolCalls: Array.from({ length: 50 }, (_, i) => call(`t${k}-${i}`, "todo_write", { items: [{ text: `item ${k * 50 + i}`, done: false }] })) });
    const w = world({ script: [batch(0), batch(1), batch(2), batch(3), batch(4), { text: "Two hundred and fifty checklist writes." }] });
    const { chatId, result } = await w.say(ada.email, "Write the checklist many times");
    const turnId = (result as { turnId: string }).turnId;
    const { task: t, steps } = await task(w, chatId, turnId);
    expect([t.stepCount, t.capped]).toEqual([250, true]);
    expect(steps).toHaveLength(STEPS_PER_TASK + 1);
    expect(steps.slice(0, STEPS_PER_TASK - 1).every((s) => s.kind === "todo")).toBe(true);
    expect(steps.map((s) => s.n)).toEqual(Array.from({ length: STEPS_PER_TASK + 1 }, (_, i) => i + 1));
    expect(steps[STEPS_PER_TASK - 2]?.callId).toBe("t3-48");
    const marker = steps[STEPS_PER_TASK - 1] as StepRecord;
    expect([marker.kind, marker.title]).toEqual(["marker", "51 more steps are not shown"]);
    // The counts read every step, the hidden ones included.
    expect([steps.at(-1)?.kind, steps.at(-1)?.detail.prose, steps.at(-1)?.detail.blocks[0]?.text]).toEqual(["summary", "250 other", "Two hundred and fifty checklist writes."]);
    // The list row says the same.
    const listed = ((await w.http(ada.email, "GET", "/app/activity")).body as unknown as { tasks: TaskRecord[] }).tasks[0];
    expect([listed?.stepCount, listed?.capped]).toEqual([250, true]);
  });

  it("an unknown tool is called by its name in words, a block over BLOCK_CHARS is cut and says so, and unfence strips exactly the outer fence", () => {
    const long = "x".repeat(BLOCK_CHARS + 10);
    const rows = [
      { seq: 1, turnId: "t1", message: { role: "assistant", content: [{ type: "toolCall", id: "u1", name: "weather_lookup", arguments: {} }, { type: "toolCall", id: "w1", name: "file_write", arguments: { path: "work/big.txt", text: long } }], timestamp: 10 } },
      { seq: 2, turnId: "t1", message: { role: "toolResult", toolCallId: "u1", toolName: "weather_lookup", content: [{ type: "text", text: fence("tool:weather_lookup", "sunny") }], isError: false, timestamp: 15, durationMs: 5 } },
      { seq: 3, turnId: "t1", message: { role: "toolResult", toolCallId: "w1", toolName: "file_write", content: [{ type: "text", text: fence("tool:file_write", "NOT_A_CODE but failed") }], isError: true, timestamp: 20 } },
    ] as unknown as Parameters<typeof stepsOf>[0];
    const steps = stepsOf(rows, [], { chatId: "c" });
    expect(steps.map((s) => [s.kind, s.title, s.state, s.code])).toEqual([
      ["other", "Called weather lookup", "done", null],
      ["write", "Wrote `work/big.txt` failed (TOOL_FAILED)", "failed", "TOOL_FAILED"],
    ]);
    expect(steps[0]?.detail.result?.text).toBe("sunny");
    // A result without its own duration takes the span between the call and the result.
    expect(steps[1]?.durationMs).toBe(10);
    const big = steps[1]?.detail.blocks[0];
    expect([big?.text.length, big?.cut, steps[1]?.detail.cut]).toEqual([BLOCK_CHARS, true, true]);
    // Another source's fence, or a fence with text around it, is not this result's outer fence.
    expect(unfence("tool:a", fence("tool:b", "x"))).toBe(fence("tool:b", "x"));
    expect(unfence("tool:a", `${fence("tool:a", "x")} after`)).toBe(`${fence("tool:a", "x")} after`);
    expect(unfence("tool:a", fence("tool:a", "[END EXTERNAL CONTENT source=\"tool:a\"]"))).toBe("(END EXTERNAL CONTENT source=\"tool:a\"]");
  });
});
