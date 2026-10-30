// The tier-1 harness of the P7 tasks (F29): `P7Tier1World` over the authority world with Sam's real `ChatEngine` chat
// `c1`, the `jobs` namespace over real `Job` engines on the test's clock, the real Ledger and grants, the real egress
// module in front of a fake network that serves `https://example.com/p7-probe` and nothing else, the app's real job
// route and panel script (the page harness), and the scripted fake model, which answers the chat and every job's model
// step from one script in the order they run. Turns:
//   - `prompt`: Sam's message to `c1`, run to its end;
//   - `decide` (payload `choice`, `once` by default): Sam decides every pending card in `c1`;
//   - `tick` (payload `job`, a title, and `at`, an ISO instant): the clock moves to `at` when given, then the job's
//     armed alarm fires when it is due by then (with no `at`, the clock moves to it), with every alarm due after it;
//   - `hold` (payload `job`): the job's alarm fires and its model step waits on the fake's `hold: "run"` step, which the
//     turns after it run beside; `release` lets it finish;
//   - `page` (payload `body`): the network's page changes; `panel` (payload `job`, `action`): Sam opens the job's dialog
//     from the Upcoming tab of her page (the panel script over the app's real route) and presses `run` (Run now),
//     `enable` or `disable` (the toggle) or `remove` (Remove, then the ConfirmDialog's Remove); `reload`: nothing, the
//     world's reads are fresh each time.
// Two members are seeded, Sam and Pat (`test/fixtures/people.json`), so a planted test can try Pat on Sam's job.
import { readOnlyForJob, jobToolSpecs } from "../../../packages/agent/src/jobs/job-tools.ts";
import type { JobDefinition } from "../../../packages/agent/src/jobs/body.ts";
import type { JobEngine } from "../../../packages/agent/src/jobs/engine.ts";
import people from "../../fixtures/people.json" with { type: "json" };
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import type { Snapshot } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { type AuthorityWorld, authorityWorld, person } from "../../workers/support/authority-world.ts";
import { type El, page } from "../../workers/support/page-harness.ts";
import type { CardView, ChatLabel, DialogView, JobView, ListedJob, ModelCall, NoticeView, OutboxView, P7World, RunView } from "./world.ts";
import { PROBE } from "./world.ts";

export const sam = people.people.find((p) => p.id === "sam-solo")!;
export const pat = people.people.find((p) => p.id === "pat-solo")!;
export const ZONE = "Europe/London";
const JOB_TASK_MARK = "You are running one step of a scheduled job";
const HANDOFF_MARK = "From the harness, not the person: a result of your job";

/** The fake network: one page at `PROBE`, its body the test's; every request is kept, with its headers. */
export class ProbeNetwork {
  body = "The p7 probe page. First paragraph. Second paragraph.";
  readonly requests: Array<{ url: string; headers: Record<string, string> }> = [];
  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    this.requests.push({ url, headers });
    if (url !== PROBE) return new Response("not served here", { status: 404 });
    return new Response(this.body, { status: 200, headers: { "content-type": this.body.trimStart().startsWith("{") ? "application/json" : "text/plain" } });
  };
}

export interface P7HarnessOptions {
  /** One script for the seed and the turns, in the order the chat and the jobs call the model. */
  script: FakeStep[];
  /** Runs before the snapshot, after `c1` is open and Sam's home zone saved: the task's setup records. */
  seed?: (w: P7Tier1World) => Promise<void>;
  /** The page's first body. */
  page?: string;
}

type Msg = { role: string; content?: unknown; toolName?: string; isError?: boolean };
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
const inputsOf = (r: FakeRequest) => r.inputs as { messages?: Array<{ role: string; content?: unknown }>; tools?: Array<{ function?: { name: string } }> };
/** What the tools returned in the request the fake answers, in order. */
export const toolResults = (r: FakeRequest): string[] => (inputsOf(r).messages ?? []).filter((m) => m.role === "tool").map((m) => textOf(m.content));
/** A reply made from the request: `make` reads what the tools returned. */
export const replyFrom = (make: (results: string[]) => string): FakeStep => ({ fromRequest: (r) => ({ text: make(toolResults(r)) }) });
/** A tool call made from the request: `make` reads what the tools returned (the id `jobs_create` answered). */
export const callFrom = (make: (results: string[]) => { id: string; name: string; arguments: Record<string, unknown> }): FakeStep => ({ fromRequest: (r) => ({ toolCall: make(toolResults(r)) }) });
/** Whether the request's newest user message is a job's handoff (F24), not Sam's: earlier handoffs stay in the history. */
const handoffIn = (r: FakeRequest) => textOf((inputsOf(r).messages ?? []).filter((m) => m.role === "user").at(-1)?.content).includes(HANDOFF_MARK);
/** Answers Sam's turn with `text`, and a turn a job's notice woke with no words (F24): whichever of the two comes first. */
export const answer = (text: string): FakeStep => ({ fromRequest: (r) => ({ text: handoffIn(r) ? "" : text }) });
/** The job id a `jobs_*` result names, from the newest result that names one. */
export const idIn = (results: string[]): string => results.map((t) => /\b(?:Registered|Changed) job ([a-z0-9-]+)|The job ([a-z0-9-]+) /.exec(t)).filter(Boolean).map((m) => (m?.[1] ?? m?.[2]) as string).at(-1) ?? "";
export const load: FakeStep = { toolCall: { id: "load_jobs", name: "tool_search", arguments: { load: ["jobs"] } } };

const settleUi = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
const all = (e: El): El[] => e.children.flatMap((c) => [c, ...all(c)]);

export class P7Tier1World implements P7World {
  readonly w: AuthorityWorld;
  readonly network = new ProbeNetwork();
  readonly t0: number;
  c1 = "";
  private held: Promise<void> | null = null;
  private readonly log: Array<{ turn: string; upcoming: string[]; runs: number; calls: number }> = [];
  /** Every job id Sam's index listed, kept after a remove takes one out of it. */
  private readonly known = new Set<string>();
  /** The dialog as each `panel` turn left it, with the action's result line. */
  readonly acted: Array<DialogView & { result: string }> = [];

  constructor(o: P7HarnessOptions) {
    this.w = authorityWorld({ jobs: true, seed: [sam, pat], script: o.script, jobFetch: this.network.fetch });
    if (o.page !== undefined) this.network.body = o.page;
    this.t0 = this.w.clock.now;
  }

  async open(): Promise<void> {
    this.c1 = ((await this.w.host(sam.email).chats.open(this.w.clock.now)) as { chatId: string }).chatId;
    // Sam's home zone, as her client reported it first (M25.2): every job she asks for is in it.
    this.w.host(sam.email).jobs.homeZone(ZONE);
  }

  chat() {
    return this.w.chats.harness(this.c1).instance;
  }

  ids(): string[] {
    for (const id of this.w.jobIds(sam.email)) this.known.add(id);
    return [...this.known];
  }

  engine(id: string): JobEngine {
    return this.w.jobOf(sam.email, id).instance;
  }

  /** The id of the job titled `title`, or the only one when unnamed. */
  idOf(title?: string): string {
    const ids = this.ids();
    const id = title ? ids.find((i) => this.engine(i).status()?.def.title === title) : ids.length === 1 ? ids[0] : undefined;
    if (!id) throw new Error(`P7_NO_JOB: ${title ?? "(the only job)"} among ${ids.length}`);
    return id;
  }

  /** A job Sam made herself, defined on its Job object as the owner (on at once), with its chat `c1`. */
  async defineJob(def: Partial<JobDefinition> & Pick<JobDefinition, "id" | "title" | "timing" | "instructions">, by = sam.email) {
    const full: JobDefinition = { chat: this.c1, owner: { kind: "chat", id: this.c1 }, stop: { kind: "turned_off" }, gate: null, steps: [{ kind: "model" }, { kind: "notify" }], ceilingTokens: 20_000, ...def };
    return this.engine(def.id).define({ owner: sam.email, by, def: full });
  }

  async say(text: string): Promise<void> {
    await this.w.say(sam.email, text, this.c1);
    await this.chat().settled();
  }

  async decide(choice: "once" | "always" = "once"): Promise<void> {
    const pending = (this.chat().cardsFor(sam.email) ?? []).filter((c) => c.state === "pending").map((c) => c.id);
    if (pending.length) await this.chat().decide(pending, { person: sam.email, agent: false }, choice);
    await this.chat().settled();
  }

  /** The job's alarm, fired when due by `at` (or moved to when no `at`), then every alarm due after it; with no job, the clock moves. */
  async tick(title?: string, at?: string): Promise<boolean> {
    if (!title && this.ids().length === 0) {
      this.w.clock.now = at ? Math.max(this.w.clock.now, Date.parse(at)) : this.w.clock.now + 5 * 60_000;
      return false;
    }
    const h = this.w.jobOf(sam.email, this.idOf(title));
    const before = this.engine(this.idOf(title)).store.runs().length;
    if (at) this.w.clock.now = Math.max(this.w.clock.now, Date.parse(at));
    if (h.alarmAt !== null && (!at || h.alarmAt <= this.w.clock.now)) {
      this.w.clock.now = Math.max(this.w.clock.now, h.alarmAt);
      await h.fireAlarm();
      for (let i = 0; i < 30 && h.alarmAt !== null && h.alarmAt <= this.w.clock.now; i++) await h.fireAlarm();
    }
    await this.chat().settled();
    return this.engine(this.idOf(title)).store.runs().length > before;
  }

  /** Fires the job's alarm and returns once its model step waits at the fake's `hold: "run"`. */
  async hold(title?: string): Promise<void> {
    const h = this.w.jobOf(sam.email, this.idOf(title));
    if (h.alarmAt === null) throw new Error("P7_NO_ALARM");
    this.w.clock.now = Math.max(this.w.clock.now, h.alarmAt);
    const arrived = this.w.fake.reached("run");
    this.held = (async () => {
      await h.fireAlarm();
      for (let i = 0; i < 30 && h.alarmAt !== null && h.alarmAt <= this.w.clock.now; i++) await h.fireAlarm();
    })();
    await arrived;
  }

  async release(): Promise<void> {
    this.w.fake.release("run");
    await this.held;
    this.held = null;
    await this.chat().settled();
  }

  /** Sam's page, its requests answered by the app's real routes as `as`. */
  async page(as = sam.email, layout: { desktop?: boolean } = { desktop: true }) {
    const p = await page(
      {
        onSend() {},
        fetch: async (path, init) => {
          const r = await this.w.http(as, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
          return new Response(JSON.stringify(r.body), { status: r.status });
        },
      },
      layout,
    );
    await settleUi();
    return p;
  }

  /** The job's dialog opened from Upcoming in `p`, or null when Upcoming draws no row for it. */
  private async opened(p: Awaited<ReturnType<P7Tier1World["page"]>>, id: string): Promise<boolean> {
    await p.byId("panel-tab-upcoming").onclick?.();
    await settleUi();
    const row = all(p.byId("job-list")).find((e) => e.dataset.job === id);
    if (!row) return false;
    await row.onclick?.();
    await settleUi();
    return true;
  }

  private read(p: Awaited<ReturnType<P7Tier1World["page"]>>): DialogView {
    const dlg = p.byId("job-dialog");
    const fixed = new Set(["job-back", "job-runs-toggle", "job-run", "job-toggle", "job-remove"]);
    const els = all(dlg);
    return {
      state: p.byId("job-state").textContent,
      title: p.byId("job-title").textContent,
      words: p.byId("job-words").textContent,
      about: p.byId("job-about").textContent,
      controls: els.filter((e) => e.tag === "button" || fixed.has(e.id)).map((e) => e.id || e.textContent),
      history: all(p.byId("job-runs")).filter((e) => e.className === "job-run" || e.className === "job-earlier").map((e) => all(e).map((c) => c.textContent).join(" ")),
      otherClickable: els.some((e) => e.onclick !== null && !fixed.has(e.id)),
      historyOpen: p.byId("job-runs-toggle").attrs["aria-expanded"] === "true",
    };
  }

  /** Sam's action in the job's dialog: `run`, `enable`, `disable` or `remove` (confirmed). */
  async panel(title: string | undefined, action: string): Promise<void> {
    const id = this.idOf(title);
    const p = await this.page();
    if (!(await this.opened(p, id))) throw new Error(`P7_NO_ROW: ${id}`);
    if (action === "run") await p.byId("job-run").onclick?.();
    else if (action === "enable" || action === "disable") {
      if (p.byId("job-toggle").dataset.action !== action) throw new Error(`P7_TOGGLE_IS: ${p.byId("job-toggle").dataset.action}`);
      await p.byId("job-toggle").onclick?.();
    } else if (action === "remove") {
      await p.byId("job-remove").onclick?.();
      await settleUi();
      await p.byId("confirm-ok").onclick?.();
    } else throw new Error(`P7_ACTION_UNKNOWN: ${action}`);
    await settleUi();
    // The steps the action armed for now (a manual run's notify step) run at once, as the object's alarm would.
    const h = this.w.jobOf(sam.email, id);
    for (let i = 0; i < 30 && h.alarmAt !== null && h.alarmAt <= this.w.clock.now; i++) await h.fireAlarm();
    await this.chat().settled();
    this.acted.push({ ...this.read(p), result: p.byId("job-result").textContent });
  }

  async play(turn: Turn): Promise<void> {
    const p = turn.kind === "event" ? (turn.payload ?? {}) : {};
    if (turn.kind === "prompt") await this.say(turn.text);
    else if (turn.kind !== "event") throw new Error(`P7_TURN_UNKNOWN: ${turn.kind}`);
    else if (turn.name === "decide") await this.decide((p.choice as "once" | "always") ?? "once");
    else if (turn.name === "tick") await this.tick(p.job, p.at);
    else if (turn.name === "hold") await this.hold(p.job);
    else if (turn.name === "release") await this.release();
    else if (turn.name === "page") this.network.body = p.body ?? "";
    else if (turn.name === "panel") await this.panel(p.job, p.action ?? "");
    else if (turn.name === "reload") await this.chat().settled();
    else throw new Error(`P7_TURN_UNKNOWN: ${turn.name}`);
    this.log.push({ turn: turn.kind === "prompt" ? "prompt" : `event:${turn.name}`, upcoming: (await this.listed()).filter((j) => j.listed === "upcoming").map((j) => j.title), runs: this.runs().length, calls: this.w.fake.requests.length });
  }

  // P7World

  now() {
    return this.w.clock.now;
  }
  start() {
    return this.t0;
  }

  jobs(): JobView[] {
    return this.ids().flatMap((id) => {
      const s = this.engine(id).status();
      if (!s) return [];
      const sch = s.def.timing.schedule as { kind: string; at?: string; every?: number };
      return [
        {
          id, title: s.def.title, status: s.status, words: "", cadence: s.cadence, kind: sch.kind, at: sch.kind === "runonce" ? (sch.at ?? null) : null, every: sch.every ?? null, zone: s.def.timing.zone,
          stop: s.def.stop as JobView["stop"], owner: s.def.owner, chat: s.def.chat === this.c1 ? "c1" : s.def.chat, gate: s.def.gate as JobView["gate"], instructions: s.def.instructions,
          history: s.history.map((h) => ({ until: h.until, by: h.by, cadence: h.cadence, instructions: h.def.instructions, at: h.def.timing.schedule.kind === "runonce" ? h.def.timing.schedule.at : null })),
          alarmAt: this.w.jobOf(sam.email, id).alarmAt,
          mark: s.gateState.mark ?? null,
        },
      ];
    });
  }

  runs(): RunView[] {
    return this.ids().flatMap((id) => {
      const e = this.engine(id);
      const title = e.status()?.def.title ?? id;
      return e.store.runs().map((r) => ({ job: title, manual: r.manual, phase: r.phase, signal: r.signal, code: r.code, reason: r.reason, scheduledFor: r.scheduledFor }));
    });
  }

  outbox(): OutboxView[] {
    return this.ids().flatMap((id) => {
      const e = this.engine(id);
      return e.store.outbox().map((o) => ({ job: e.status()?.def.title ?? id, run: o.runId, state: o.state, text: o.text }));
    });
  }

  notices(_chat: ChatLabel = "c1"): NoticeView[] {
    const titles = new Map(this.ids().map((id) => [`job:${id}`, this.engine(id).status()?.def.title ?? id]));
    return this.chat().notices().map((n) => ({ text: n.text, from: titles.get(n.source) ?? n.source }));
  }

  replies(_chat: ChatLabel = "c1"): string[] {
    return this.chat()
      .history()
      .entries.filter((e) => e.kind === "agent")
      .map((e) => (e as { text?: string }).text ?? "");
  }

  results(_chat: ChatLabel = "c1") {
    return this.w.chats
      .harness(this.c1)
      .rows("SELECT body FROM messages ORDER BY seq")
      .map((r) => JSON.parse(String(r.body)) as Msg)
      .filter((m) => m.role === "toolResult")
      .map((m) => ({ tool: m.toolName ?? "", text: textOf(m.content), isError: m.isError === true }));
  }

  /** The card's tool is named in its title ("Your agent asks to: jobs enable"). */
  cards(): CardView[] {
    return (this.chat().cardsFor(sam.email) ?? []).map((c) => ({ state: c.state, title: c.title, lines: (c as { lines?: string[] }).lines ?? [], tool: /asks to: (.+)$/.exec(c.title)?.[1]?.replace(/ /g, "_") ?? "" }));
  }

  async listed(): Promise<ListedJob[]> {
    const r = await this.w.http(sam.email, "GET", "/app/jobs");
    return ((r.body as { jobs?: Array<Record<string, unknown>> }).jobs ?? []).map((j) => ({ id: String(j.id), title: String(j.title ?? ""), listed: String(j.listed ?? ""), words: String(j.words ?? ""), kind: (j.kind as string | null) ?? null, nextRun: (j.nextRun as number | null) ?? null }));
  }

  async dialog(title: string): Promise<DialogView | null> {
    const p = await this.page();
    return (await this.opened(p, this.idOf(title))) ? this.read(p) : null;
  }

  /** The Upcoming tab's group titles, in order, as Sam's page draws them. */
  async groups(): Promise<string[]> {
    const p = await this.page();
    await p.byId("panel-tab-upcoming").onclick?.();
    await settleUi();
    return p.byId("job-list").children.filter((c) => c.tag === "h3").map((c) => c.textContent);
  }

  /** Whether, at phone width, the panel opens as the bottom sheet (`panel-dialog`). */
  async phoneSheet(): Promise<boolean> {
    const p = await this.page(sam.email, {});
    await p.byId("open-agent").onclick?.();
    await settleUi();
    return p.byId("panel").parent?.id === "panel-dialog";
  }

  egress() {
    return this.network.requests.map((r) => ({ url: r.url, credentialed: Object.keys(r.headers).some((h) => /^(authorization|cookie|x-api-key|proxy-authorization)$/i.test(h)) }));
  }

  calls(): ModelCall[] {
    return this.w.fake.requests.map((r) => {
      const sent = JSON.stringify(inputsOf(r).messages ?? []);
      return { side: sent.includes(JOB_TASK_MARK) ? "job" : "chat", tools: (inputsOf(r).tools ?? []).map((t) => t.function?.name ?? ""), handoff: handoffIn(r) };
    });
  }

  jobTools(): string[] {
    // As `objects/job.ts` builds a job's tools for its owner, with the owner's memory and the job network's egress.
    const specs = jobToolSpecs({ owner: sam.email, jobId: "p7-probe", get: async () => ({ ok: false, code: "EGRESS_UNAVAILABLE", reason: "none" }) as never, memory: this.w.host(sam.email).memory as never });
    return specs.filter(readOnlyForJob).map((t) => t.name);
  }

  runApprovals(): number {
    return this.ids().reduce((n, id) => n + this.engine(id).store.runs().flatMap((r) => this.engine(id).store.steps(r.runId)).filter((s) => s.kind === "approval").length, 0);
  }

  after() {
    return this.log;
  }

  async snapshot(): Promise<Snapshot> {
    const min = (t: number) => Math.round((t - this.t0) / 60_000);
    const journal = [
      ...this.jobs().map((j) => `job:${j.title}`),
      ...this.runs().filter((r) => r.phase === "done").map((r) => `run:${r.job}:${min(r.scheduledFor)}:${r.signal}`),
      ...this.cards().map((c, i) => `card:${i + 1}:${c.title}`),
      ...this.notices().map((_, i) => `notice:c1:${i + 1}`),
    ];
    return { journal, vault: [], r2: [...this.w.r2.objects.keys()].filter((k) => !k.startsWith("docs/")) };
  }
}

export function p7Harness(o: P7HarnessOptions): TaskHarness<P7World> {
  return {
    setup: async () => {
      const w = new P7Tier1World(o);
      await w.open();
      await o.seed?.(w);
      return w;
    },
    play: async (world, turn) => (world as P7Tier1World).play(turn),
  };
}

export { person };

/** Plays a task's turns through `p7Harness(o)` and answers each grader: `true` for a grader that held (a minefield that did not happen). */
export async function graded(task: DefinedTask<P7World>, o: P7HarnessOptions): Promise<Record<string, boolean>> {
  const world = await played(task, o);
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}

/** The task's turns played through `p7Harness(o)`, and the world after them. */
export async function played(task: DefinedTask<P7World>, o: P7HarnessOptions, turns = task.turns): Promise<P7Tier1World> {
  const h = p7Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task)) as P7Tier1World;
  for (const t of turns) await h.play(world, t, rng);
  return world;
}
