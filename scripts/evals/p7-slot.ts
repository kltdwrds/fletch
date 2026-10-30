// The P7 readers over a preview slot (F30): a scheduling task's world on a real slot, over the test host's `p7` op
// (`scripts/preview-slot/test-host-p7.mjs`), apart from the slot client so a hermetic test reads them without its socket,
// passkey or browser. Each trial starts with Sam's jobs removed and her home zone saved as Europe/London (`reset`), then
// the task's setup (`p7Seeds`), then its turns; after each turn the jobs, the chat's notices and the model calls are read
// again, and `after()` keeps what Upcoming listed then.
//
// What the slot cannot see is said, never guessed: a chat's tool results, the tools a job's model is offered as code
// builds them and the dialog's acted turns, which no tier-2 grader reads, throw `SLOT_P7_UNREAD`. A model call's side is
// its Ledger route (`job` or not); its tools and whether a notice woke it are not recorded, so they read empty and false.
import { INSTRUCTIONS, TITLE } from "../../test/evals/p7-scheduling/one-shot-set.task.ts";
import { INSTRUCTIONS as UNCHANGED, TITLE as UNCHANGED_TITLE } from "../../test/evals/p7-scheduling/silence-real-model.task.ts";
import { JOBS } from "../../test/evals/p7-scheduling/upcoming-and-dialog.task.ts";
import type { CardView, DialogView, JobView, ListedJob, ModelCall, NoticeView, OutboxView, P7World, RunView } from "../../test/evals/p7-scheduling/world.ts";
import type { SlotEntry } from "../../test/support/evals.ts";

type Json = Record<string, unknown>;

/** The test host's `p7` op: one call as Sam, with chat c1's notices read on `state`. */
export type P7Call = (call: Json) => Promise<Json>;

/** Sam's page on the slot, in a real browser: the job dialog from the Upcoming tab, its groups, and the phone's sheet. */
export interface P7Page {
  dialog(jobId: string): Promise<DialogView | null>;
  groups(): Promise<string[]>;
  phoneSheet(): Promise<boolean>;
}

export const ZONE = "Europe/London";
/** A local `YYYY-MM-DDTHH:MM` in Europe/London. */
export const localAt = (t: number): string => new Date(t).toLocaleString("sv-SE", { timeZone: ZONE }).slice(0, 16).replace(" ", "T");

/**
 * A job Sam made herself, on at once, its results to `chat`. Its id ends with the trial's `tag`: a removed job's object
 * keeps its runs, so an id an earlier trial used would bring them back.
 */
const job = (chat: string, tag: string, def: Json): Json => ({
  do: "define",
  def: { chat, owner: { kind: "chat", id: chat }, stop: { kind: "turned_off" }, gate: null, steps: [{ kind: "model" }, { kind: "notify" }], ceilingTokens: 20_000, ...def, id: `${String(def.id)}-${tag}` },
});
const daily = { schedule: { kind: "daily", at: "09:00" }, zone: ZONE };

/** Each task's setup as `p7` calls after the reset, given chat c1's id and the trial's start (its tag, in base 36). */
export function p7Seeds(taskId: string, chat: string, now: number): Json[] {
  const tag = now.toString(36);
  switch (taskId) {
    // T-P7-09's one-shot, made and on: the runner's tick fires it.
    case "T-P7-10":
      return [job(chat, tag, { id: "p7-probe-time", title: TITLE, instructions: INSTRUCTIONS, timing: { schedule: { kind: "runonce", at: localAt(now + 5 * 60_000) }, zone: ZONE }, stop: { kind: "after_runs", runs: 1 } })];
    case "T-P7-11":
      return [job(chat, tag, { id: "p7-probe-unchanged", title: UNCHANGED_TITLE, instructions: UNCHANGED, timing: { schedule: { kind: "interval", every: 30 }, zone: ZONE }, noGateReason: "the p7 probe has no change signal" })];
    case "T-P7-14":
      return [
        job(chat, tag, { id: "p7-probe-noon", title: JOBS.once, instructions: "Remind me of the p7 probe.", timing: { schedule: { kind: "runonce", at: `${localAt(now + 24 * 3_600_000).slice(0, 10)}T12:00` }, zone: ZONE }, stop: { kind: "after_runs", runs: 1 } }),
        job(chat, tag, { id: "p7-probe-nine", title: JOBS.daily, instructions: "Read the p7 probe page.", timing: daily, noGateReason: "a morning read" }),
        job(chat, tag, { id: "p7-probe-monday", title: JOBS.weekly, instructions: "Read the p7 probe page.", timing: { schedule: { kind: "weekly", days: [1], at: "09:00" }, zone: ZONE }, noGateReason: "a weekly read" }),
        { ...job(chat, tag, { id: "p7-probe-off", title: JOBS.off, instructions: "Read the p7 probe page.", timing: daily, noGateReason: "a morning read" }), off: true },
      ];
    default:
      return [];
  }
}

/** One job as the `state` op reads it: its inspection, its clock and its network's requests. */
interface Seen {
  id: string;
  inspection: { job: Json & { def: Json & { timing: { schedule: Json; zone: string } }; history: Json[]; gateState: { mark?: string } }; runs: Json[]; outbox: Json[] };
  alarmAt: number | null;
  egress: Array<{ url: string; credentialed: boolean }>;
}
interface State {
  jobs: Seen[];
  notices: Array<{ source: string; text: string }>;
  calls: Array<{ person: string; run_id: string; route: string }>;
}

const unread = (name: string) => () => {
  throw new Error(`SLOT_P7_UNREAD: ${name} is not read on a slot`);
};
const refusedBy = (r: Json, what: string) => {
  if (r.ok !== true) throw new Error(`P7_SETUP_REFUSED: ${what} ${String(r.code ?? "")} ${String(r.reason ?? "")}`.trim());
  return r;
};

export interface P7Slot {
  /** Removes Sam's jobs, saves her home zone, and makes the task's setup; throws `P7_SETUP_REFUSED` with the code. */
  begin(taskId: string, now: number): Promise<void>;
  /** The trial's start: when Sam's first prompt was sent, or `begin`'s instant. */
  started(t: number): void;
  /** Fires the job titled `title` (the only job when unset) at its next alarm; resolves with its id and its runs before. */
  tick(title?: string): Promise<{ id: string; before: number }>;
  /** The runs of job `id` so far, as `state` read them last. */
  runsOf(id: string): Json[];
  /** Reads the state again; with `turn`, records what Upcoming listed after it. */
  refresh(turn?: string): Promise<void>;
  readers: Omit<P7World, keyof import("../../test/support/scenario.ts").ScenarioWorld>;
}

/** The P7 readers over `call`, with chat c1's id, its history as the page draws it, the app's routes and Sam's page. */
export function p7Slot(call: P7Call, c1: () => string, entries: () => SlotEntry[], read: (path: string) => Promise<{ status: number; body: unknown }>, page: P7Page): P7Slot {
  let state: State = { jobs: [], notices: [], calls: [] };
  let t0 = 0;
  let callsBefore = 0;
  const known = new Set<string>();
  const trail: Array<{ turn: string; upcoming: string[]; runs: number; calls: number }> = [];
  const titleOf = (id: string) => (state.jobs.find((j) => j.id === id)?.inspection.job.def.title as string | undefined) ?? id;
  const idOf = (title?: string) => {
    const id = title ? state.jobs.find((j) => j.inspection.job.def.title === title)?.id : state.jobs.length === 1 ? state.jobs[0]?.id : undefined;
    if (!id) throw new Error(`P7_NO_JOB: ${title ?? "(the only job)"} among ${state.jobs.length}`);
    return id;
  };
  const calls = () => state.calls.slice(callsBefore);

  const readers: P7Slot["readers"] = {
    now: () => Date.now(),
    start: () => t0,
    jobs: () =>
      state.jobs.map(({ id, inspection: { job: s }, alarmAt }): JobView => {
        const sch = s.def.timing.schedule as { kind: string; at?: string; every?: number };
        return {
          id, title: String(s.def.title), status: String(s.status), words: "", cadence: String(s.cadence), kind: sch.kind, at: sch.kind === "runonce" ? (sch.at ?? null) : null, every: sch.every ?? null,
          zone: s.def.timing.zone, stop: s.def.stop as JobView["stop"], owner: s.def.owner as JobView["owner"], chat: s.def.chat === c1() ? "c1" : String(s.def.chat), gate: (s.def.gate ?? null) as JobView["gate"],
          instructions: String(s.def.instructions),
          history: s.history.map((h) => { const d = h.def as { instructions: string; timing: { schedule: { kind: string; at?: string } } }; return { until: Number(h.until), by: String(h.by), cadence: String(h.cadence), instructions: d.instructions, at: d.timing.schedule.kind === "runonce" ? (d.timing.schedule.at ?? null) : null }; }),
          alarmAt, mark: s.gateState.mark ?? null,
        };
      }),
    runs: () => state.jobs.flatMap((j) => j.inspection.runs.map((r): RunView => ({ job: titleOf(j.id), manual: r.manual === true, phase: String(r.phase), signal: (r.signal ?? null) as string | null, code: (r.code ?? null) as string | null, reason: (r.reason ?? null) as string | null, scheduledFor: Number(r.scheduledFor) }))),
    outbox: () => state.jobs.flatMap((j) => j.inspection.outbox.map((o): OutboxView => ({ job: titleOf(j.id), run: (o.runId ?? null) as string | null, state: String(o.state), text: String(o.text) }))),
    notices: (): NoticeView[] => state.notices.map((n) => ({ text: n.text, from: n.source.startsWith("job:") ? titleOf(n.source.slice(4)) : n.source })),
    replies: () => entries().flatMap((e) => (e.kind === "agent" ? [e.text ?? ""] : [])),
    results: unread("results"),
    cards: (): CardView[] =>
      entries().flatMap((e) => {
        const c = e.card as (SlotEntry["card"] & { lines?: string[] }) | undefined;
        return e.kind === "card" && c ? [{ state: c.state, title: c.title, lines: c.lines ?? [], tool: /asks to: (.+)$/.exec(c.title)?.[1]?.replace(/ /g, "_") ?? "" }] : [];
      }),
    async listed(): Promise<ListedJob[]> {
      const r = await read("/app/jobs");
      return ((r.body as { jobs?: Json[] }).jobs ?? []).map((j) => ({ id: String(j.id), title: String(j.title ?? ""), listed: String(j.listed ?? ""), words: String(j.words ?? ""), kind: (j.kind as string | null) ?? null, nextRun: (j.nextRun as number | null) ?? null }));
    },
    dialog: async (title) => page.dialog(idOf(title)),
    groups: () => page.groups(),
    phoneSheet: () => page.phoneSheet(),
    egress: () => state.jobs.flatMap((j) => j.egress),
    calls: () => calls().map((c): ModelCall => ({ side: c.route === "job" ? "job" : "chat", tools: [], handoff: false })),
    jobTools: unread("jobTools"),
    runApprovals: () => state.jobs.reduce((n, j) => n + j.inspection.runs.filter((r) => r.phase === "awaiting_approval").length, 0),
    after: () => trail.map((t) => ({ ...t, upcoming: [...t.upcoming] })),
    get acted(): Array<DialogView & { result: string }> {
      return unread("acted")();
    },
  };

  const slot: P7Slot = {
    async begin(taskId, now) {
      t0 = now;
      refusedBy(await call({ do: "reset", zone: ZONE }), "reset");
      for (const step of p7Seeds(taskId, c1(), now)) refusedBy(await call(step), String((step.def as Json | undefined)?.id ?? step.do));
      await slot.refresh();
      callsBefore = state.calls.length;
    },
    started(t) {
      t0 = t;
    },
    async tick(title) {
      const id = idOf(title);
      const before = slot.runsOf(id).length;
      refusedBy(await call({ do: "tick", id }), `tick ${id}`);
      return { id, before };
    },
    runsOf: (id) => state.jobs.find((j) => j.id === id)?.inspection.runs ?? [],
    async refresh(turn) {
      const r = refusedBy(await call({ do: "state", ids: [...known] }), "state") as unknown as State;
      state = { jobs: r.jobs, notices: r.notices, calls: r.calls };
      for (const j of state.jobs) known.add(j.id);
      if (turn) trail.push({ turn, upcoming: (await readers.listed()).filter((j) => j.listed === "upcoming").map((j) => j.title), runs: readers.runs().length, calls: calls().length });
    },
    readers,
  };
  return slot;
}
