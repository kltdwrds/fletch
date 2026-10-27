// F15: the Activity tab opens the task drawer. The shipped page script runs under the page harness (M27.4's
// `m27-panel` shape); its requests go to the agent script's real `route` as Sam or Pat of solo-sam, each real
// `ChatEngine` answers its own tasks for its owner, and the model is the scripted fake. A delegated task comes from the
// sub-agent world (the real engine, host, store and verifier), whose task answer is the same `chatTask` the `Chat`
// serves, with each facet's transcript read under D-0011; a facet whose read throws is said by name in the drawer.
// Planted: a drawer that formats its own title.
import { describe, expect, it } from "vitest";
import { chatTask, type TaskRecord } from "../../packages/agent/src/chat/activity.ts";
import type { StepRecord } from "../../packages/agent/src/chat/activity-steps.ts";
import { SUBAGENT_STEPS_UNAVAILABLE, type SubAgentRows, type SubAgentSection } from "../../packages/agent/src/chat/activity-subagents.ts";
import type { RunResult } from "../../packages/agent/src/code/run.ts";
import { ACTIVITY_TEXT, STEP_GLYPH, TASK_TONE } from "../../packages/agent/src/http/app/activity.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ACTIVITY_TEXT as STATUS_WORDS } from "../../packages/agent/src/obs/activity-words.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, person, T0 } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";
import { subagentWorld, verdict } from "./support/subagent-world.ts";

const pat = person("pat-solo");
const settle = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
/** Code Mode as a scripted runner: a script that throws answers `CODE_SCRIPT_THREW` (F13's). */
const code = () => ({
  run: async (req: { script: string }): Promise<RunResult> =>
    req.script.includes("throw") ? { ok: false, code: "CODE_SCRIPT_THREW", reason: "Error: the totals do not add up", logs: [] } : { ok: true, result: { total: 42 }, logs: [], workerId: "solo-sam:abc", loaded: true },
});
const world = (o: Parameters<typeof authorityWorld>[0] = {}) => authorityWorld({ seed: [ada, pat], stores: true, vault: { code }, ...o });
type World = ReturnType<typeof world>;
type Layout = { desktop?: boolean; tablet?: boolean };
type Task = { ok: true; task: TaskRecord; steps: StepRecord[]; subagents: SubAgentSection[] };
type Answer = (path: string) => Promise<{ status: number; body: unknown } | null>;

const one = (id: string, name: string, args: Record<string, unknown>): FakeStep => ({ toolCall: { id, name, arguments: args } });
const PROMPT = "Write my plan for the week into a file";
/** A file-only turn: it loads the tools, writes a file, runs a script that throws, and answers. */
const FILES: FakeStep[] = [
  one("c0", "tool_search", { load: ["files", "code"] }),
  one("c1", "file_write", { path: "notes/week.md", text: "Monday: the budget." }),
  one("c2", "code_execute", { script: "throw new Error('the totals do not add up')" }),
  { text: "Saved your week." },
];

/** A person's page whose requests go to the world's real routes as that person, unless `over` answers first; every path asked is kept. */
async function pageOf(w: World | null, as: string, layout: Layout = { desktop: true }, o: { over?: Answer; plant?: (js: string) => string } = {}) {
  const asked: string[] = [];
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        asked.push(path);
        const r = (await o.over?.(path)) ?? (w ? await w.http(as, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined) : null);
        return r ? new Response(JSON.stringify(r.body), { status: r.status }) : null;
      },
    },
    layout,
    o.plant,
  );
  await settle();
  return Object.assign(p, { asked });
}
type Page = Awaited<ReturnType<typeof pageOf>>;
const all = (e: El): El[] => e.children.flatMap((c) => [c, ...all(c)]);
const byClass = (e: El, cls: string) => all(e).filter((c) => c.className.split(" ").includes(cls));
const has = (e: El, cls: string) => e.className.split(" ").includes(cls);
const rowsOf = (p: Page) => byClass(p.byId("panel-activity"), "prow");
const rowTitle = (r: El) => byClass(r, "t-sub-m")[0]?.textContent;
const click = async (e: El | undefined) => {
  await e?.onclick?.();
  await settle();
};
/** The drawer's steps, in drawing order: each `li` the timeline drew, with its key, kind, title and rail mark. */
const lis = (p: Page) => all(p.byId("task-steps")).filter((e) => e.tag === "li");
const stepTitle = (li: El) => byClass(li, "nm")[0]?.textContent;
const railMark = (li: El) => byClass(li, "rail")[0]?.children[0] as El;
const selected = (p: Page) => lis(p).filter((li) => has(li, "is-sel")).map((li) => li.dataset.key);
const pane = (p: Page) => p.byId("task-pane");
const taskAt = (chatId: string, turnId: string) => `/app/activity/${chatId}/${turnId}`;

async function filesTask(w: World) {
  await w.say(ada.email, PROMPT);
  const [t] = ((await w.http(ada.email, "GET", "/app/activity")).body as { tasks: TaskRecord[] }).tasks as [TaskRecord];
  const r = await w.http(ada.email, "GET", taskAt(t.chatId, t.id));
  expect(r.status).toBe(200);
  return r.body as unknown as Task;
}
/** Sam's page with the Activity tab drawn, then the first row clicked open. */
async function opened(w: World, layout: Layout = { desktop: true }, o: Parameters<typeof pageOf>[3] = {}) {
  const p = await pageOf(w, ada.email, layout, o);
  if (!layout.desktop && !layout.tablet) await click(p.byId("open-agent"));
  await click(rowsOf(p)[0]);
  return p;
}
const titles = (p: Page) => [rowTitle(rowsOf(p)[0] as El), p.byId("task-title").textContent, p.byId("task-detail-task").textContent];

describe("[F15] the Activity tab opens the task drawer", () => {
  it("a row is a button with the record's title, status word and time; it opens #task-dialog titled from the same record in all three places", async () => {
    const w = world({ script: FILES });
    const { task } = await filesTask(w);
    const p = await pageOf(w, ada.email);
    const [row] = rowsOf(p) as [El];
    expect(row.tag).toBe("button");
    expect([rowTitle(row), byClass(row, "t-foot")[0]?.textContent, byClass(row, "prow-side")[0]?.textContent]).toEqual([
      task.title,
      STATUS_WORDS.status.done,
      new Date(T0).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    ]);
    expect(p.byId("task-dialog").hidden).toBe(true);
    await click(row);
    expect(p.byId("task-dialog").hidden).toBe(false);
    expect(p.asked).toContain(taskAt(task.chatId, task.id));
    expect(titles(p)).toEqual([task.title, task.title, task.title]);
    // The pill is the record's status, in its tone and the one table's words.
    expect([p.byId("task-state").className, p.byId("task-state").text()]).toEqual([`qf-status qf-status--${TASK_TONE.done}`, STATUS_WORDS.status.done]);
  });

  it("planted: a drawer that formats its own title differs from the row's, and the check sees it", async () => {
    const w = world({ script: FILES });
    const { task } = await filesTask(w);
    let planted = false;
    const p = await opened(w, { desktop: true }, {
      plant: (js) => {
        const out = js.replace("const titleOf = (t) => t.title;", "const titleOf = (t) => t.title.toUpperCase();");
        planted = out !== js;
        return out;
      },
    });
    expect(planted).toBe(true);
    expect(titles(p)).not.toEqual([task.title, task.title, task.title]);
  });

  it("the timeline lists the steps in order with the route's titles, a glyph by kind and a failed step's rail mark; the summary is last", async () => {
    const w = world({ script: FILES });
    const { steps } = await filesTask(w);
    expect(steps.map((s) => [s.kind, s.state])).toEqual([["load", "done"], ["write", "done"], ["code", "failed"], ["summary", "done"]]);
    const p = await opened(w);
    const drawn = lis(p);
    expect(drawn.map((li) => [li.dataset.key, li.dataset.kind, stepTitle(li)])).toEqual(steps.map((s) => [String(s.n), s.kind, s.title]));
    for (const [i, li] of drawn.entries()) {
      const s = steps[i] as StepRecord;
      expect(railMark(li).children[0]?.copyOf).toBe(`glyph-${STEP_GLYPH[s.kind]}`);
      expect(has(railMark(li), "is-fail")).toBe(s.state === "failed");
    }
    // A title is one line: its `.nm` holds the text alone.
    for (const li of drawn) expect(byClass(li, "nm")[0]?.children).toEqual([]);
  });

  it("selecting a step marks it and draws its prose, blocks and result in words, with the code and duration", async () => {
    const w = world({ script: FILES });
    const { steps, task } = await filesTask(w);
    const p = await opened(w);
    // From 768 px the first step is open beside the timeline.
    expect(selected(p)).toEqual(["1"]);
    const failed = steps.find((s) => s.state === "failed") as StepRecord;
    await click(lis(p).find((li) => li.dataset.key === String(failed.n)));
    expect(selected(p)).toEqual([String(failed.n)]);
    const d = pane(p);
    expect(d.children.find((c) => c.tag === "h3")?.textContent).toBe(failed.title);
    expect(p.byId("task-detail-task").textContent).toBe(task.title);
    expect(d.text()).toContain(failed.detail.prose);
    const codes = byClass(d, "qf-code");
    const labels = codes.map((c) => byClass(c, "k")[0]?.textContent);
    expect(labels).toEqual([...failed.detail.blocks.map((b) => b.label), ACTIVITY_TEXT.result]);
    expect(codes.map((c) => byClass(c, "qf-src")[0]?.textContent)).toEqual([...failed.detail.blocks.map((b) => b.text), failed.detail.result?.text]);
    const result = byClass(d, "task-result")[0] as El;
    expect(result.dataset.code).toBe("CODE_SCRIPT_THREW");
    expect(result.textContent).toContain("CODE_SCRIPT_THREW");
    // The result in words: its code and its duration, from the table (the scripted run takes under a second).
    const ms = failed.detail.result?.durationMs as number;
    expect(ms).toBeLessThan(1000);
    expect(result.textContent).toBe(`${ACTIVITY_TEXT.failedWith.replace("{code}", "CODE_SCRIPT_THREW")} ${ACTIVITY_TEXT.after.replace("{duration}", ACTIVITY_TEXT.ms.replace("{n}", String(ms)))}.`);
  });

  it("a running task says Running and offers Refresh, which reads the route again and draws its new answer", async () => {
    const w = world({ script: [{ hold: "h", step: { text: "Still thinking." } }] });
    const said = w.say(ada.email, "Think about the offsite");
    await w.fake.reached("h");
    const p = await opened(w);
    const [t] = ((await w.http(ada.email, "GET", "/app/activity")).body as { tasks: TaskRecord[] }).tasks as [TaskRecord];
    expect(t.status).toBe("running");
    expect([p.byId("task-state").className, p.byId("task-state").text()]).toEqual([`qf-status qf-status--${TASK_TONE.running}`, "Running"]);
    // Refresh is offered: in the served head, labelled from the table, and not hidden.
    expect(p.byId("task-refresh").hidden).toBe(false);
    expect(APP_PAGE).toMatch(new RegExp(`<button id="task-refresh"[^>]*>${ACTIVITY_TEXT.refresh}</button>`));
    const reads = () => p.asked.filter((a) => a === taskAt(t.chatId, t.id)).length;
    expect(reads()).toBe(1);
    // A held turn has no step yet: the timeline is empty and the pill still says it is running.
    expect(lis(p)).toEqual([]);
    w.fake.release("h");
    await said;
    await click(p.byId("task-refresh"));
    expect(reads()).toBe(2);
    expect(p.byId("task-state").text()).toBe(STATUS_WORDS.status.done);
    expect(lis(p).map((li) => li.dataset.kind)).toEqual(["summary"]);
  });

  it("Refresh keeps a step selected by its n", async () => {
    const w = world({ script: FILES });
    await filesTask(w);
    const p = await opened(w);
    await click(lis(p)[2]);
    expect(selected(p)).toEqual(["3"]);
    await click(p.byId("task-refresh"));
    expect(selected(p)).toEqual(["3"]);
    expect(pane(p).children.find((c) => c.tag === "h3")?.textContent).toBe(stepTitle(lis(p)[2] as El));
  });

  it("opening pushes one entry and back closes the drawer and nothing else; the X and Escape close it and pop their entry", async () => {
    const w = world({ script: FILES });
    await filesTask(w);
    const p = await pageOf(w, ada.email);
    const at = [p.location.pathname, p.history.index];
    await click(rowsOf(p)[0]);
    expect(p.byId("task-dialog").hidden).toBe(false);
    expect([p.location.pathname, p.history.index]).toEqual([at[0], (at[1] as number) + 1]);
    p.history.back();
    await settle();
    expect(p.byId("task-dialog").hidden).toBe(true);
    expect([p.location.pathname, p.history.index]).toEqual(at);
    // The pinned panel beneath stays, with its row.
    expect(rowsOf(p)).toHaveLength(1);
    await click(rowsOf(p)[0]);
    await click(p.byId("task-close"));
    expect([p.byId("task-dialog").hidden, p.history.index]).toEqual([true, at[1]]);
    await click(rowsOf(p)[0]);
    p.key("Escape");
    await settle();
    expect([p.byId("task-dialog").hidden, p.history.index]).toEqual([true, at[1]]);
  });

  it("on a phone the drawer takes the panel's place and shows one pane: the detail hidden until a step is chosen, Back returns to the list", async () => {
    const w = world({ script: FILES });
    await filesTask(w);
    const p = await opened(w, {});
    expect(p.byId("panel-dialog").hidden).toBe(true);
    expect(p.byId("task-dialog").hidden).toBe(false);
    expect(has(p.byId("task-body"), "is-detail")).toBe(false);
    expect(selected(p)).toEqual([]);
    await click(lis(p)[1]);
    expect(has(p.byId("task-body"), "is-detail")).toBe(true);
    expect(selected(p)).toEqual(["2"]);
    await click(p.byId("task-back"));
    expect(has(p.byId("task-body"), "is-detail")).toBe(false);
    expect(p.byId("task-dialog").hidden).toBe(false);
  });

  it("a route refusal is said with its code, never drawn empty", async () => {
    const w = world({ script: FILES });
    const { task } = await filesTask(w);
    // The route's own answer to Pat for Sam's task: CHAT_NOT_OWNER.
    const refusal = await w.http(pat.email, "GET", taskAt(task.chatId, task.id));
    expect([refusal.status, (refusal.body as { code: string }).code]).toEqual([403, "CHAT_NOT_OWNER"]);
    const p = await opened(w, { desktop: true }, { over: async (path) => (path === taskAt(task.chatId, task.id) ? refusal : null) });
    expect(p.byId("task-dialog").hidden).toBe(false);
    expect(p.byId("task-note").textContent).toContain(`Could not read ${ACTIVITY_TEXT.thisTask}`);
    expect(p.byId("task-note").dataset.code).toBe("CHAT_NOT_OWNER");
    expect(lis(p)).toEqual([]);
    expect(p.byId("task-state").hidden).toBe(true);
  });

  it("Pat's panel draws none of Sam's rows", async () => {
    const w = world({ script: FILES });
    const { task } = await filesTask(w);
    const p = await pageOf(w, pat.email);
    expect(rowsOf(p)).toEqual([]);
    expect(p.byId("panel-activity").text()).not.toContain(task.title);
  });
});

const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["subagents"] } } };
const BRIEF = "Read Sam's notes for the launch date.";
const ONE_WORKER: FakeStep[] = [
  load,
  { toolCall: { id: "d1", name: "subagents_delegate", arguments: { tasks: [{ role: "worker", brief: BRIEF }] } } },
  { text: "A worker is on it." },
  { toolCall: { id: "w1", name: "notes_read", arguments: {} } },
  { text: "The launch is Thursday." },
  verdict("pass", "names the launch date from the notes"),
  { text: "Your worker found the launch is Thursday." },
];

/** The sub-agent world's task, served to the page as the `Chat` serves it (the parent's record with its facets' transcripts, D-0011), after the delegation has handed off. */
async function delegated(reader?: (real: SubAgentRows) => SubAgentRows) {
  const sw = subagentWorld({ script: ONE_WORKER });
  await sw.say("When is the launch? Delegate it.");
  sw.clock.now += 60_000;
  await sw.settle();
  const engine = sw.chat.instance.engine;
  const tasks = engine.tasksFor(ada.email) as TaskRecord[];
  const [t] = tasks as [TaskRecord];
  const answer = (await chatTask(engine, ada.email, t.id, reader ? reader(sw.record()) : sw.record())) as Task;
  const over: Answer = async (path) =>
    path === "/app/activity" ? { status: 200, body: { ok: true, tasks, unread: [] } } : path === taskAt(t.chatId, t.id) ? { status: 200, body: answer } : null;
  const p = await pageOf(null, ada.email, { desktop: true }, { over });
  await click(rowsOf(p)[0]);
  return { p, answer };
}
const heads = (p: Page) => byClass(p.byId("task-steps"), "qf-items-head");

describe("[F15] a delegated task in the drawer", () => {
  it("shows SUBAGENT 01 after the main steps with its status and verdict and the child's own steps nested, each selectable; the summary last", async () => {
    const { p, answer } = await delegated();
    const row = answer.subagents[0]?.rows[0];
    expect(row).toMatchObject({ status: "done", verdict: "pass" });
    const child = row?.steps as StepRecord[];
    expect(Array.isArray(child) && child.length).toBeGreaterThan(0);
    const [head] = heads(p) as [El];
    expect(head.text()).toContain("SUBAGENT 01");
    expect(head.text()).toContain(ACTIVITY_TEXT.rowStatus.done);
    expect(head.text()).toContain(ACTIVITY_TEXT.verdict.replace("{verdict}", "pass"));
    const sub = byClass(p.byId("task-steps"), "task-sub")[0] as El;
    expect(sub.text()).toContain(ACTIVITY_TEXT.verdict.replace("{verdict}", "pass"));
    expect(sub.text()).toContain("names the launch date from the notes");
    // The child's own steps, read from its facet, nested under the section in their order.
    const nested = byClass(p.byId("task-steps"), "qf-tl--nested")[0] as El;
    const kids = nested.children.filter((c) => c.tag === "li");
    expect(kids.map((li) => [li.dataset.kind, stepTitle(li)])).toEqual(child.map((s) => [s.kind, s.title]));
    expect(byClass(p.byId("task-steps"), "task-sub-note")).toEqual([]);
    await click(kids[0]);
    expect(selected(p)).toEqual([kids[0]?.dataset.key]);
    expect(pane(p).children.find((c) => c.tag === "h3")?.textContent).toBe(child[0]?.title);
    // The launch step's prose is its own paragraph, not its title: drawn as a line of the pane.
    const launch = answer.steps.find((s) => s.kind === "launch") as StepRecord;
    expect(launch.detail.prose).not.toBe(launch.title);
    await click(lis(p).find((li) => li.dataset.key === String(launch.n)));
    expect(pane(p).children.filter((c) => c.tag === "p").map((c) => c.textContent)).toContain(launch.detail.prose);
    // In drawing order: the main steps, the section and its steps, then the summary.
    const order = all(p.byId("task-steps")).filter((e) => e.tag === "li" || has(e, "qf-items-head")).map((e) => (e.tag === "li" ? e.dataset.kind : "section"));
    expect(order).toEqual([...answer.steps.filter((s) => s.kind !== "summary").map((s) => s.kind), "section", ...child.map((s) => s.kind), "summary"]);
  });

  it("a facet whose read throws is said by name under its section, never drawn as an empty list", async () => {
    const { p, answer } = await delegated((real) => ({ ...real, transcript: async () => { throw new Error("facet unreachable"); } }));
    expect(answer.subagents[0]?.rows[0]?.steps).toEqual({ ok: false, code: SUBAGENT_STEPS_UNAVAILABLE });
    expect(heads(p)[0]?.text()).toContain("SUBAGENT 01");
    expect(byClass(p.byId("task-steps"), "qf-tl--nested")).toEqual([]);
    const refused = byClass(p.byId("task-steps"), "task-sub-note")[0] as El;
    expect([refused.dataset.code, refused.textContent]).toEqual([SUBAGENT_STEPS_UNAVAILABLE, ACTIVITY_TEXT.stepsUnavailable]);
  });
});
