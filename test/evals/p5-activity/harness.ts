// The tier-1 harness of the P5 tasks (F31): `P5Tier1World` over the authority world with Sam's real `ChatEngine` chats
// `c1` and `c2`, the real file, memory and job stores, the real `browse` namespace over the fake browser (the probe page
// at `PROBE` with one link; `example.invalid` absent, so both engines answer 404 and the read is `BROWSE_UNREACHABLE`),
// the real sub-agent host, facets and verifier (the child reads through the same `browse` namespace, the brief's
// address in its url table), the real Ledger, the app's real routes and panel script (the page harness), and the
// scripted fake model, which answers every chat turn, child, verifier and job step from one script in the order they
// run. Turns:
//   - `prompt` (payload `text`, `chat`, `wait`), or a `prompt` turn by Sam (a tier-2 task's, F32): Sam's message, run
//     to its end with every sub-agent it launched and the handoff turn they wake; with `wait`, the sub-agents are left
//     launched and `during` keeps the task as it stood;
//   - `children` (payload `chat`): the launched sub-agents run, and the handoff turn they wake;
//   - `hold` (payload `text`, `chat`, `stop`): Sam's message whose script holds at the fake's `hold: "mid"` step; the
//     world keeps `during` (the thread, the Stop control and the task as they stood), presses the composer's Stop when
//     `stop` is set, then releases the step and runs the turn and its sub-agents to their end;
//   - `decide` (payload `chat`): Sam decides every pending card, once;
//   - `tick` (payload `job`, a title): the job's alarm fires, then every retry its delivery arms;
//   - `embed`: one Ledger row on a second model (the embedding model, at its listed price) is kept for the newest task's
//     anchor turn, as a memory search's embedding is;
//   - `open`: nothing; every read of the world is fresh.
// Two members are seeded, Sam and Pat (`test/fixtures/people.json`): a planted test reads Sam's task as Pat, and T-P5-09's
// undelivered job reports to Pat's chat, which refuses Sam's notice.
import { chatBrowse } from "../../../packages/agent/src/browse/hook.ts";
import { PersonBrowse } from "../../../packages/agent/src/browse/memory.ts";
import { UrlTable } from "../../../packages/agent/src/browse/urls.ts";
import { WORK_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import { dashboardRoutes } from "../../../packages/agent/src/http/dashboard-routes.ts";
import type { JobDefinition } from "../../../packages/agent/src/jobs/body.ts";
import { chargeMicros } from "../../../packages/agent/src/ledger/budget.ts";
import type { PersonDashboardDeps } from "../../../packages/agent/src/obs/dashboard.ts";
import people from "../../fixtures/people.json" with { type: "json" };
import { FakeBrowser } from "../../support/browser/fake-browser.ts";
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import type { Snapshot } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { type AuthorityWorld, authorityWorld } from "../../workers/support/authority-world.ts";
import { type El, page } from "../../workers/support/page-harness.ts";
import type { ChatLabel, DrawerView, ModelRow, P5World, RowView, RunRow, TaskDetail, TaskView, ThreadEntry } from "./world.ts";
import { PROBE, PROBE_LINK, PROBE_TITLE } from "./world.ts";

export const sam = people.people.find((p) => p.id === "sam-solo")!;
export const pat = people.people.find((p) => p.id === "pat-solo")!;
/** The probe page as the fake browser serves it: a title, two sentences and one link. */
/** The second model a task's usage names (T-P5-11): the embedding model, priced in the Ledger's table. */
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
export const PAGE = `# ${PROBE_TITLE}\n\nThe probe has one line of text. It has one link.\n\n[Elsewhere](${PROBE_LINK})`;
export const JOB_TASK_MARK = "You are running one step of a scheduled job";
export const CHILD_MARK = "Surface: sub-agent.";
export const VERIFIER_MARK = "You check one sub-agent's handoff";

const settleUi = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
const all = (e: El): El[] => e.children.flatMap((c) => [c, ...all(c)]);
const byClass = (e: El, cls: string) => all(e).filter((c) => c.className.split(" ").includes(cls));
type Msg = { role: string; content?: unknown; toolName?: string; isError?: boolean };
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
const inputsOf = (r: FakeRequest) => r.inputs as { messages?: Array<{ role: string; content?: unknown }> };
/** What the tools returned in the request the fake answers, in order. */
export const toolResults = (r: FakeRequest): string[] => (inputsOf(r).messages ?? []).filter((m) => m.role === "tool").map((m) => textOf(m.content));

export interface P5HarnessOptions {
  /** One script for the seed and the turns, in the order the chats, children, verifier and jobs call the model. */
  script: FakeStep[];
  /** Runs before the snapshot, after `c1` and `c2` are open: the task's setup records. */
  seed?: (w: P5Tier1World) => Promise<void>;
}

export class P5Tier1World implements P5World {
  readonly w: AuthorityWorld;
  readonly browser = new FakeBrowser({ "example.com": { markdown: PAGE } });
  readonly ids = new Map<ChatLabel, string>();
  during: P5World["during"] = null;
  private holds = 0;
  before: Record<string, number> = {};
  private readonly memory = new Map<string, ObjectHarness<PersonBrowse>>();

  constructor(o: P5HarnessOptions) {
    const now = () => this.w.clock.now;
    const browseMemory = (person: string) => {
      let h = this.memory.get(person);
      if (!h) {
        h = new ObjectHarness(`browse-${person}`, (ctx) => new PersonBrowse((ctx as DurableObjectState).storage, now), {});
        this.memory.set(person, h);
      }
      return h.instance;
    };
    const hook = { port: this.browser, memory: (person: string) => ({ get: async (d: string) => browseMemory(person).get(d), record: async (r: Parameters<PersonBrowse["record"]>[0]) => browseMemory(person).record(r) }) };
    // A sub-agent's production reads are the Hacker News pair (`SUBAGENT_READS`); here, as F14's children read a
    // fixture, the child reads the probe page through the real `browse_open`, offered eager (a child has no
    // `tool_search`), its url table holding the address its brief carries as the chat's holds the one Sam typed.
    const cell = (v: string | null = null) => ({ get: () => v, set: (x: string | null) => { v = x; } });
    const childReads = (person: string) => {
      const urls = cell();
      new UrlTable(urls).add([PROBE]);
      const ns = chatBrowse(hook, person, { urls, session: cell() }, now);
      return [{ ...ns, deferral: "eager" as const, tools: ns.tools.filter((t) => t.name === "browse_open") }];
    };
    this.w = authorityWorld({ seed: [sam, pat], stores: true, jobs: true, script: o.script, browse: hook, subagents: { reads: childReads }, jobFetch: async (url) => (url === PROBE ? new Response(PAGE, { status: 200, headers: { "content-type": "text/plain" } }) : new Response("no", { status: 404 })) });
  }

  async open(): Promise<void> {
    for (const c of ["c1", "c2"] as const) {
      // `c1` is the person's main chat; `c2` a side chat, as the page's New chat opens it.
      const r = c === "c1" ? await this.w.host(sam.email).chats.main(this.w.clock.now) : await this.w.host(sam.email).chats.open(this.w.clock.now);
      this.ids.set(c, (r as { chatId: string }).chatId);
    }
  }

  chatId(chat: ChatLabel = "c1"): string {
    return this.ids.get(chat) as string;
  }

  engine(chat: ChatLabel = "c1") {
    return this.w.chats.harness(this.chatId(chat)).instance;
  }

  private label(chatId: string): string {
    return [...this.ids].find(([, id]) => id === chatId)?.[0] ?? chatId;
  }

  /** A job Sam made herself, on at once, reporting to `chat` (a chat id; `c1` when unset). */
  async defineJob(def: Partial<JobDefinition> & Pick<JobDefinition, "id" | "title" | "timing" | "instructions">) {
    const chat = def.chat ?? this.chatId();
    const full: JobDefinition = { owner: { kind: "chat", id: chat }, stop: { kind: "after_runs", runs: 1 }, gate: null, steps: [{ kind: "model" }, { kind: "notify" }], ceilingTokens: 20_000, ...def, chat };
    return this.w.jobOf(sam.email, def.id).instance.define({ owner: sam.email, by: sam.email, def: full });
  }

  /** Runs every sub-agent the chat launched, the handoff turn they wake, and the chat to rest. */
  private async settle(chat: ChatLabel) {
    await this.engine(chat).settled();
    await this.w.subagents.get(this.chatId(chat))?.settle();
    await this.engine(chat).settled();
  }

  async play(t: Turn): Promise<void> {
    // A tier-2 task's prompt (F32) is Sam's, as the slot's runner sends it: played as the `prompt` event.
    const turn: Turn = t.kind === "prompt" ? { kind: "event", name: "prompt", payload: { text: t.text, ...(t.chat ? { chat: t.chat } : {}) } } : t;
    if (turn.kind !== "event") throw new Error(`P5_TURN_UNSUPPORTED: ${turn.kind}`);
    const p = (turn.payload ?? {}) as { text?: string; chat?: ChatLabel; stop?: "yes"; job?: string; wait?: "yes" };
    const chat = p.chat ?? "c1";
    // A minute passes before each message Sam sends, so the list's newest-first order is the order she asked in.
    if (turn.name === "prompt" || turn.name === "hold") this.w.clock.now += 60_000;
    if (turn.name === "prompt") {
      await this.w.say(sam.email, p.text as string, this.chatId(chat));
      if (p.wait) {
        await this.engine(chat).settled();
        await this.keep(chat);
      } else await this.settle(chat);
    } else if (turn.name === "children") {
      await this.settle(chat);
    } else if (turn.name === "embed") {
      const t = await this.newestRecord("c1");
      await this.w.ledger().record({ tenant: "solo-sam", person: sam.email, runId: t?.id ?? "", route: "embed" as never, model: EMBED_MODEL, attempt: 1, status: "ok" as never, code: null, httpStatus: 200, inputTokens: 1200, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, at: this.w.clock.now, startedAt: this.w.clock.now, firstTokenAt: null, finishedAt: this.w.clock.now } as never);
    } else if (turn.name === "hold") {
      const sent = this.w.say(sam.email, p.text as string, this.chatId(chat));
      await this.w.fake.reached("mid", ++this.holds);
      await this.keep(chat);
      if (p.stop) await this.engine(chat).stop(sam.email);
      this.w.fake.release("mid");
      await sent;
      await this.settle(chat);
    } else if (turn.name === "decide") {
      const pending = ((await this.engine(chat).cardsFor(sam.email)) ?? []).filter((c) => c.state === "pending").map((c) => c.id);
      if (pending.length) await this.engine(chat).decide(pending, { person: sam.email, agent: false }, "once");
      await this.settle(chat);
    } else if (turn.name === "tick") {
      const h = this.w.jobOf(sam.email, this.jobId(p.job as string));
      // The run, then each delivery retry it arms, until the job has nothing armed.
      for (let i = 0; i < 12 && h.alarmAt !== null; i++) {
        this.w.clock.now = Math.max(this.w.clock.now, h.alarmAt);
        await h.fireAlarm();
        for (const c of ["c1", "c2"] as const) await this.engine(c).settled();
      }
    } else if (turn.name !== "open") throw new Error(`P5_UNKNOWN_TURN: ${turn.name}`);
  }

  /** The thread, the Stop control and the newest task as they stand now: the first time only. */
  private async keep(chat: ChatLabel) {
    if (this.during) return;
    const t = await this.newestRecord(chat);
    const steps = t ? (await this.task(chat, t.id)).steps : [];
    // Stop is offered by the composer while a turn runs and by the task's drawer while the task runs (F31).
    const offered = this.engine(chat).history().running !== null || (t ? !!(await this.drawer(chat, t.id))?.stop : false);
    this.during = { thread: this.thread(chat), stop: offered, status: t?.status ?? "", summary: t?.summary ?? null, summaryStep: steps.some((x) => x.kind === "summary") };
  }

  private jobId(title: string): string {
    const id = this.w.jobIds(sam.email).find((i) => this.w.jobOf(sam.email, i).instance.status()?.def.title === title);
    if (!id) throw new Error(`P5_NO_JOB: ${title}`);
    return id;
  }

  private async newestRecord(chat: ChatLabel) {
    return (await this.activity()).tasks.find((t) => t.chat === chat);
  }

  async activity() {
    const r = await this.w.http(sam.email, "GET", "/app/activity");
    const b = r.body as { tasks?: Array<Omit<TaskView, "chat"> & { chatId: string }>; unread?: Array<{ chatId: string; code: string }>; runs?: RunRow[] };
    return {
      tasks: (b.tasks ?? []).map(({ chatId, ...t }) => ({ ...t, chat: this.label(chatId) }) as TaskView),
      unread: (b.unread ?? []).map((u) => ({ chat: this.label(u.chatId), code: u.code })),
      runs: (b.runs ?? []).map((x) => ({ title: x.title, word: x.word, code: x.code })),
    };
  }

  async task(chat: ChatLabel, id: string, as: "sam" | "pat" = "sam"): Promise<TaskDetail> {
    const r = await this.w.http(as === "pat" ? pat.email : sam.email, "GET", `/app/activity/${this.chatId(chat)}/${id}`);
    const b = r.body as unknown as TaskDetail & { task?: TaskView & { chatId?: string } };
    if (b.task?.chatId) b.task = { ...b.task, chat: this.label(b.task.chatId) };
    return { ...b, steps: b.steps ?? [], subagents: b.subagents ?? [], usage: b.usage ?? null };
  }

  async page(layout: { desktop?: boolean } = { desktop: true }) {
    const p = await page(
      {
        onSend() {},
        fetch: async (path, init) => {
          const r = await this.w.http(sam.email, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
          return new Response(JSON.stringify(r.body), { status: r.status });
        },
      },
      layout,
    );
    await settleUi();
    if (!layout.desktop) {
      await p.byId("open-agent").onclick?.();
      await settleUi();
    }
    return p;
  }

  private rowsIn(p: Awaited<ReturnType<P5Tier1World["page"]>>): El[] {
    return byClass(p.byId("panel-activity"), "prow");
  }

  private rowView(r: El): RowView {
    const glyph = (byClass(r, "prow-tile")[0]?.children[0] as (El & { copyOf?: string }) | undefined)?.copyOf ?? "";
    return { kind: r.dataset.run ? "run" : "task", title: byClass(r, "t-sub-m")[0]?.textContent ?? "", desc: byClass(r, "t-foot")[0]?.textContent ?? "", glyph: glyph.replace(/^glyph-/, "") };
  }

  async rows(): Promise<RowView[]> {
    return this.rowsIn(await this.page()).map((r) => this.rowView(r));
  }

  async drawer(chat: ChatLabel, id: string, phone = false): Promise<DrawerView | null> {
    const at = (await this.activity()).tasks.findIndex((t) => t.chat === chat && t.id === id);
    if (at < 0) return null;
    const p = await this.page(phone ? {} : { desktop: true });
    const row = this.rowsIn(p).filter((r) => !r.dataset.run)[at];
    if (!row) return null;
    await row.onclick?.();
    await settleUi();
    const lis = () => all(p.byId("task-steps")).filter((e) => e.tag === "li");
    const details: DrawerView["details"] = {};
    let stacked = false;
    for (let i = 0; i < lis().length; i++) {
      const li = lis()[i] as El;
      await li.onclick?.();
      await settleUi();
      const pane = p.byId("task-pane");
      const title = byClass(li, "nm")[0]?.textContent ?? "";
      details[title] = { text: all(pane).map((e) => (e.children.length ? "" : e.textContent)).join("\n"), plain: !all(pane).some((e) => ["script", "img", "iframe", "a", "object"].includes(e.tag)) };
      if (phone) stacked = p.byId("task-body").className.split(" ").includes("is-detail");
      if (phone) {
        await p.byId("task-back").onclick?.();
        await settleUi();
      }
    }
    return { pill: p.byId("task-state").text(), stop: !p.byId("task-stop").hidden, title: p.byId("task-title").text(), usage: p.byId("task-usage").text(), steps: lis().map((li) => byClass(li, "nm")[0]?.textContent ?? ""), details, stacked };
  }

  thread(chat: ChatLabel = "c1"): ThreadEntry[] {
    return this.engine(chat).history().entries.map((e) => ({ kind: e.kind, text: "text" in e ? String(e.text ?? "") : "" }));
  }

  replies(chat: ChatLabel = "c1"): string[] {
    return this.thread(chat).filter((e) => e.kind === "agent").map((e) => e.text);
  }

  results(chat: ChatLabel = "c1") {
    return this.w.chats
      .harness(this.chatId(chat))
      .rows("SELECT body FROM messages ORDER BY seq")
      .map((r) => JSON.parse(String(r.body)) as Msg)
      .filter((m) => m.role === "toolResult")
      .map((m) => ({ tool: m.toolName ?? "", text: textOf(m.content), isError: !!m.isError }));
  }

  private chatRequests(): FakeRequest[] {
    return this.w.fake.requests.filter((r) => {
      const sent = JSON.stringify(inputsOf(r).messages ?? []);
      return !sent.includes(JOB_TASK_MARK) && !sent.includes(CHILD_MARK) && !sent.includes(VERIFIER_MARK);
    });
  }

  prompts(): string[] {
    return this.chatRequests().map((r) => textOf((inputsOf(r).messages ?? []).find((m) => m.role === "system")?.content));
  }

  instructions(): string[] {
    return WORK_WORDS.split("\n").filter((l) => l.trim());
  }

  async ledgerRows(): Promise<ModelRow[]> {
    const rows = await this.w.ledger().modelCalls({ person: sam.email });
    return rows.map((r) => ({ runId: r.runId, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, costMicros: r.costMicros ?? 0 }));
  }

  async dayUsage() {
    const req = new Request("https://solo-sam.example/app/usage.json?days=1");
    const res = await dashboardRoutes(req, new URL(req.url), sam.email, { person: () => ({ ledger: this.w.ledger() }) as unknown as PersonDashboardDeps, now: () => this.w.clock.now, admin: {} as never });
    const b = (await res?.json()) as { totals: { calls: number; tokens: number; costMicros: number } };
    return b.totals;
  }

  priceOf(row: ModelRow): number {
    return chargeMicros(row.model, { input: row.inputTokens, output: row.outputTokens, cached: row.cachedTokens });
  }

  async runHistory(title: string): Promise<string[]> {
    const p = await this.page();
    const row = this.rowsIn(p).find((r) => r.dataset.run && byClass(r, "t-sub-m")[0]?.textContent === title);
    if (!row) return [];
    await row.onclick?.();
    await settleUi();
    return all(p.byId("job-runs")).filter((e) => e.className === "job-run").map((e) => all(e).map((c) => c.textContent).join(" "));
  }

  outbox() {
    return this.w.jobIds(sam.email).flatMap((id) => {
      const e = this.w.jobOf(sam.email, id).instance;
      const title = e.status()?.def.title ?? id;
      return e.store.outbox().map((o: { state: string }) => ({ job: title, state: o.state }));
    });
  }

  notices(chat: ChatLabel = "c1"): string[] {
    return this.engine(chat).notices().map((n) => n.text);
  }

  async files(): Promise<string[]> {
    const r = (await this.w.filesOf(sam.email).fileList({}, sam.email)) as unknown as { files?: Array<{ path: string }> };
    return (r.files ?? []).map((f) => f.path);
  }

  memoryLines(): string[] {
    return this.results().filter((r) => r.tool === "memory_write" && !r.isError).map((r) => r.text);
  }

  jobTitles(): string[] {
    return this.w.jobIds(sam.email).map((id) => this.w.jobOf(sam.email, id).instance.status()?.def.title ?? id);
  }

  subagents(chat: ChatLabel = "c1") {
    const s = this.w.subagents.get(this.chatId(chat));
    if (!s) return [];
    return s.store.list().map((r) => ({ id: r.id, status: r.status, code: r.code ?? null }));
  }

  async journal() {
    return (await this.w.journal()).map((r) => {
      const row = r as unknown as Record<string, unknown>;
      return { kind: String(row.actionKind ?? row.kind ?? ""), outcome: String(row.outcome ?? ""), fields: Object.keys(row) };
    });
  }

  tables(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, h] of this.w.objects()) {
      for (const t of h.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")) {
        out[`${this.label(name)}/${t.name}`] = Number(h.rows(`SELECT COUNT(*) AS n FROM "${String(t.name)}"`)[0]?.n ?? 0);
      }
    }
    return out;
  }

  pagesRead(): string[] {
    return this.browser.reads.map((r) => r.url);
  }

  async snapshot(): Promise<Snapshot> {
    // The journal's rows by kind and outcome (content-free, B-P5-10), and Sam's files by path.
    return { journal: (await this.journal()).map((r) => `${r.kind}:${r.outcome}`), vault: [], r2: await this.files() };
  }
}

export function p5Harness(o: P5HarnessOptions): TaskHarness<P5World> {
  return {
    setup: async () => {
      const w = new P5Tier1World(o);
      await w.open();
      await o.seed?.(w);
      // Sam's first read of her Activity tab touches every object her reads reach, so the snapshot holds their tables.
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P5Tier1World).play(turn),
  };
}

/** The task's turns played through `p5Harness(o)`, and the world after them. */
export async function played(task: DefinedTask<P5World>, o: P5HarnessOptions, turns = task.turns): Promise<P5Tier1World> {
  const h = p5Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task)) as P5Tier1World;
  for (const t of turns) await h.play(world, t, rng);
  return world;
}

/** Plays a task through `p5Harness(o)` and answers each grader: `true` for a grader that held (a minefield that did not happen). */
export async function graded(task: DefinedTask<P5World>, o: P5HarnessOptions): Promise<Record<string, boolean>> {
  const world = await played(task, o);
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}
