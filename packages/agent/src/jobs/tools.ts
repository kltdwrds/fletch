// The `jobs` namespace (M15.7): the agent's way to register a job from chat. Creating registers it
// off (`needs_enable`, as cloudflare-os's scheduler does for a job an agent wrote); the person turns
// it on from one approval card, which is `jobs_enable` as an action the grants engine decides, or
// from the Jobs page. Every tool acts for the chat's owner alone: the object's name carries the
// owner, and the `Job` checks it again. Results go to the chat the job was asked for in (B17), as
// `requested` through the owner's delivery (M14.1); nothing here sends them.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import { checkHost } from "../vault/hosts.ts";
import { checkGate, checkStop, DEFAULT_CEILING_TOKENS, describeStop, GOAL_ID, type JobDefinition, type StopCondition } from "./body.ts";
import type { Registered } from "./engine.ts";
import type { Gate } from "./gates.ts";
import { checkTiming, describeCadence, fromZoned, type Schedule, validZone, zoned } from "./schedule.ts";
import { actionKey, asksForAnother, timeLine } from "./reuse.ts";
import { statusWords } from "./status-words.ts";
import type { JobRow, JobRun } from "./store.ts";

/** The most jobs one person's agent may have on, waiting or off at once, so a loop of `jobs_create` ends in a code. A removed or finished job does not count. */
export const MAX_JOBS = 25;
const MIN = 60_000;

export interface JobsApi {
  /** The person's own job ids, from their `Person`. */
  ids(person: string): Promise<string[]>;
  /** The owner's view of one job; a refusal code when it is unknown or not theirs. */
  inspect(person: string, id: string): Promise<{ ok: true; job: (JobRow & { cadence: string }) | null; runs: JobRun[] } | { ok: false; code: string; reason?: string }>;
  /** Registers the job as the agent did, so it starts off. */
  define(person: string, def: JobDefinition): Promise<Registered>;
  /** Changes the job in place as the agent did (delta 7): the same id, the earlier definition kept on its record. */
  update(person: string, def: JobDefinition): Promise<Registered>;
  enable(person: string, id: string): Promise<{ ok: true } | { ok: false; code: string; reason?: string }>;
  disable(person: string, id: string): Promise<{ ok: true } | { ok: false; code: string; reason?: string }>;
  /** Removes the person's job (M25.6): archived, gone from their list, its runs kept. */
  remove(person: string, id: string): Promise<{ ok: true } | { ok: false; code: string; reason?: string }>;
  /**
   * The person's saved home zone, from their `Person` (M25.2): the first zone a client reported is
   * saved and kept, so a later travelling zone never moves a job.
   */
  homeZone(person: string, seen: string | undefined): Promise<string>;
}

export interface JobsOptions {
  principal: string;
  /** The chat the call came from: where the job's results go. */
  chatId: string;
  /** The zone the chat's client last reported (it travels): offered to the `Person` only as a first home zone. */
  zone: () => string | undefined;
  /** The person's typed message the turn answers: with the tool call id, what a replayed `jobs_create` is found by. */
  request: () => string | undefined;
  now: () => number;
  /**
   * What `separate` is checked against, from the chat's store: the person's latest own typed message, and
   * whether that message's one allowance for a second identical job is already spent.
   */
  separate: { text: () => string | undefined; spent: () => boolean; spend: () => void };
}

const ok = (text: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text }], details });
const fail = (code: string, reason: string): never => {
  throw new Error(`${code}: ${reason}`);
};
/**
 * Whether a url gate's host is one a job can read (M25.6): the platform policy cap, checked here with no
 * fetch, so a host the run would refuse is refused when the job is made and not on its first tick.
 */
export function gateHostRefusal(gate: Gate | null): string | null {
  if (!gate || gate.kind === "window" || gate.kind === "event") return null;
  let url: URL;
  try {
    url = new URL(gate.url);
  } catch {
    return `${gate.url} is not an address`;
  }
  if (url.username || url.password || url.port) return `${gate.url} carries a login or a port`;
  const host = checkHost(url.hostname);
  return host.ok ? null : host.reason;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The spoken form of a job's cadence in its zone, as the tool answers and the approval card say it. */
const whenOf = (timing: JobDefinition["timing"]) => describeCadence(timing);

/** What the answer says of a job it registered; a replay says the same of the job the first call made. */
const registeredText = (id: string, when: string, status: JobRow["status"]) =>
  `Registered job ${id} (${when}), currently ${statusWords(status)}: it does not run until the person turns it on. Call jobs_enable with id ${id} to ask them. Resolved time: ${when}. The person has been told this time by the harness, so do not repeat it as news; offer to change it if you chose it.`;

/** What a gate checks, in words. */
function describeGate(g: Gate): string {
  switch (g.kind) {
    case "url":
      return `runs only when ${g.url} changes`;
    case "watermark":
      return `runs only when the number at ${g.pointer || "/"} in ${g.url} rises`;
    case "threshold":
      return `runs only when the number at ${g.pointer || "/"} in ${g.url} crosses ${[g.above !== undefined ? `above ${g.above}` : "", g.below !== undefined ? `below ${g.below}` : ""].filter(Boolean).join(" and ")}`;
    case "window":
      return `runs only between ${g.window.start} and ${g.window.end}`;
    case "event":
      return "runs only on an event from its source";
  }
}

/** The approval card's lines: the job, its time, its gate or the stated reason it has none, and when it stops (M25.2). */
export function cardLinesOf(def: JobDefinition): string[] {
  const gate = def.gate ? `Gate: ${describeGate(def.gate)}` : def.timing.schedule.kind === "runonce" ? null : `No gate: ${def.noGateReason ?? "no reason given"}`;
  return [`Job: ${def.title}`, `When: ${whenOf(def.timing)}`, ...(gate ? [gate] : []), `Stops: ${describeStop(def.stop)}`, ...(def.owner?.kind === "goal" ? [`For goal: ${def.owner.id}`] : [])];
}

/** The id a proposal gets: its title's slug and a hash of everything that makes it this job. */
export function jobIdFor(title: string, chatId: string, schedule: unknown, instructions: string, copy = 0): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(copy ? [chatId, schedule, instructions, copy] : [chatId, schedule, instructions])) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return `${slug || "job"}-${h.toString(16).padStart(8, "0")}`;
}

const Schedule_ = Type.Object(
  {
    kind: Type.Union([Type.Literal("runonce"), Type.Literal("interval"), Type.Literal("daily"), Type.Literal("weekly"), Type.Literal("monthly"), Type.Literal("yearly")], { description: "runonce, interval, daily, weekly, monthly or yearly." }),
    in_minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_080, description: "runonce: run once this many minutes from now." })),
    at: Type.Optional(Type.String({ description: "runonce: local date and time YYYY-MM-DDTHH:MM in the job's zone. daily, weekly, monthly and yearly: HH:MM." })),
    every_minutes: Type.Optional(Type.Integer({ minimum: 5, maximum: 10_080, description: "interval: whole minutes between runs, at least 5." })),
    days: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { description: "weekly: days of the week, 0 is Sunday." })),
    day_of_month: Type.Optional(Type.Integer({ minimum: 1, maximum: 31, description: "monthly and yearly: the day of the month; a shorter month runs on its last day." })),
    month: Type.Optional(Type.Integer({ minimum: 1, maximum: 12, description: "yearly: the month, 1 is January." })),
  },
  { additionalProperties: false },
);

const Gate_ = Type.Object(
  {
    kind: Type.Union([Type.Literal("url"), Type.Literal("watermark"), Type.Literal("threshold")], { description: "url: runs when the page's ETag or content changes. watermark: when a number in a JSON document rises. threshold: when a number crosses into a condition." }),
    url: Type.String({ description: "The https page or JSON document the gate reads, in code, before any run." }),
    pointer: Type.Optional(Type.String({ description: "watermark and threshold: a JSON pointer to the number, e.g. /count." })),
    above: Type.Optional(Type.Number({ description: "threshold: open when the number is above this." })),
    below: Type.Optional(Type.Number({ description: "threshold: open when the number is below this." })),
  },
  { additionalProperties: false },
);

const Stop_ = Type.Object(
  {
    kind: Type.Union([Type.Literal("after_runs"), Type.Literal("until"), Type.Literal("first_report"), Type.Literal("turned_off")], { description: "after_runs, until a date, first_report, or turned_off (runs until the person turns it off)." }),
    runs: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, description: "after_runs: how many runs." })),
    date: Type.Optional(Type.String({ description: "until: the last local date it runs, YYYY-MM-DD." })),
  },
  { additionalProperties: false },
);

type ScheduleInput = { kind: string; in_minutes?: number; at?: string; every_minutes?: number; days?: number[]; day_of_month?: number; month?: number };

/** The schedule the engine reads, from the tool's input; a runonce "in N minutes" is read off the clock here. */
export function scheduleOf(input: ScheduleInput, zone: string, now: number): { ok: true; schedule: Schedule } | { ok: false; code: string; reason: string } {
  const bad = (reason: string) => ({ ok: false as const, code: "SCHEDULE_INVALID", reason });
  switch (input.kind) {
    case "runonce": {
      if ((input.in_minutes === undefined) === (input.at === undefined)) return bad("runonce takes in_minutes or at, one of them");
      if (input.in_minutes !== undefined) {
        const p = zoned(now + input.in_minutes * MIN, zone);
        return { ok: true, schedule: { kind: "runonce", at: `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}` } };
      }
      return { ok: true, schedule: { kind: "runonce", at: input.at as string } };
    }
    case "interval":
      return input.every_minutes === undefined ? bad("interval takes every_minutes") : { ok: true, schedule: { kind: "interval", every: input.every_minutes } };
    case "daily":
      return input.at === undefined ? bad("daily takes at, HH:MM") : { ok: true, schedule: { kind: "daily", at: input.at } };
    case "weekly":
      return input.at === undefined || !input.days ? bad("weekly takes days and at") : { ok: true, schedule: { kind: "weekly", days: input.days, at: input.at } };
    case "monthly":
      return input.at === undefined || input.day_of_month === undefined ? bad("monthly takes day_of_month and at") : { ok: true, schedule: { kind: "monthly", day: input.day_of_month, at: input.at } };
    case "yearly":
      return input.at === undefined || input.day_of_month === undefined || input.month === undefined ? bad("yearly takes month, day_of_month and at") : { ok: true, schedule: { kind: "yearly", month: input.month, day: input.day_of_month, at: input.at } };
    default:
      return bad("kind is runonce, interval, daily, weekly, monthly or yearly");
  }
}

/** The instant a runonce schedule names, to refuse one already past. */
function runonceAt(s: Schedule, zone: string): number | null {
  if (s.kind !== "runonce") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s.at);
  return m ? fromZoned(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), zone) : null;
}

export function jobsNamespace(api: JobsApi, o: JobsOptions): Namespace {
  const create: ToolSpec = {
    name: "jobs_create",
    kind: "observation",
    label: "Create a job",
    description:
      "Register a job that runs later or on a schedule: a title, what to do (Markdown), and a runonce, interval, daily, weekly, monthly or yearly schedule in the person's home zone. A recurring job takes a gate (url, watermark or threshold) that code checks before any run, so a tick with no change costs nothing; without one, say why in no_gate_reason. Each run reads with read-only tools (page_read, memory_search, docs_read, the read connectors) and ends with report or nothing_to_report. It is registered OFF and nothing runs until the person turns it on: after this, call jobs_enable with the id so they get one approval card. The result is delivered into this chat. Asking for the same thing again in this chat (the same instructions and kind, whatever the title and whatever time it resolves to) reuses a job that is on or waiting to be turned on; a one-shot that already ran is not reused and this makes another. The harness tells the person the resolved local time itself, whether they named it or you picked it. When the person asks for a second identical job in words (\"another one\"), pass separate: true; it is honoured only when their latest message says so.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 80, description: "A short name." }),
      instructions: Type.String({ minLength: 1, maxLength: 4000, description: "What each run should do and report, in Markdown." }),
      schedule: Schedule_,
      zone: Type.Optional(Type.String({ description: "An IANA zone such as Europe/London; the person's saved home zone by default, never where they are travelling." })),
      gate: Type.Optional(Gate_),
      no_gate_reason: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "A recurring job with no gate: why it must run on every tick. The person sees it on the approval card." })),
      stop: Type.Optional(Stop_),
      goal: Type.Optional(Type.String({ description: "The goal this job serves, by id, when it is for a goal rather than this chat." })),
      separate: Type.Optional(Type.Boolean({ description: "true only when the person's latest message asks for a second, identical job (\"another one\"); code checks their words and ignores it otherwise." })),
    }),
    mutates: true,
    execute: async (callId, p) => {
      const a = p as { title: string; instructions: string; schedule: ScheduleInput; zone?: string; separate?: boolean; gate?: Gate; no_gate_reason?: string; stop?: StopCondition; goal?: string };
      const zone = a.zone?.trim() || (await api.homeZone(o.principal, o.zone()));
      if (!validZone(zone)) return fail("SCHEDULE_ZONE_REQUIRED", `${zone} is not an IANA time zone, e.g. Europe/London`);
      const s = scheduleOf(a.schedule, zone, o.now());
      if (!s.ok) return fail(s.code, s.reason);
      const timing = checkTiming({ schedule: s.schedule, zone });
      if (!timing.ok) return fail(timing.code, timing.reason);
      const at = runonceAt(s.schedule, zone);
      if (at !== null && at <= o.now()) return fail("SCHEDULE_PAST", `${(s.schedule as { at: string }).at} (${zone}) is not after now`);
      const gate = a.gate ?? null;
      if (!checkGate(gate)) return fail("JOB_GATE_INVALID", "a gate is url, watermark or threshold over an https url");
      const denied = gateHostRefusal(gate);
      if (denied) return fail("JOB_GATE_HOST_DENIED", `a job can watch any public https website by its name, not an IP address, a private name, a platform host or an address with a port or login: ${denied}`);
      const reason = a.no_gate_reason?.trim() || undefined;
      // A recurring job without a gate would wake the model on every tick (AD-3): it needs a stated reason.
      if (s.schedule.kind !== "runonce" && !gate && !reason) return fail("JOB_GATE_REQUIRED", "a recurring job takes a gate (url, watermark or threshold), or no_gate_reason saying why it must run every time");
      const stop: StopCondition = s.schedule.kind === "runonce" ? { kind: "after_runs", runs: 1 } : (a.stop ?? { kind: "turned_off" });
      if (!checkStop(stop)) return fail("JOB_STOP_INVALID", "stop is after_runs with runs, until with a YYYY-MM-DD date, first_report or turned_off");
      if (a.goal !== undefined && !GOAL_ID.test(a.goal)) return fail("JOB_OWNER_INVALID", "goal is a goal id: lowercase letters, digits and dashes");
      const request = o.request();
      const seenJobs: Array<{ id: string; job: JobRow & { cadence: string } }> = [];
      for (const other of await api.ids(o.principal)) {
        const seen = await api.inspect(o.principal, other);
        if (seen.ok && seen.job) seenJobs.push({ id: other, job: seen.job });
      }
      // A resumed step calls this again with the same request and tool call (M25.2): the job it made is the answer.
      const replayed = request ? seenJobs.find((j) => j.job.def.origin?.request === request && j.job.def.origin.call === callId) : undefined;
      if (replayed) return ok(registeredText(replayed.id, whenOf(replayed.job.def.timing), replayed.job.status), { id: replayed.id, status: replayed.job.status, cadence: replayed.job.cadence, when: whenOf(replayed.job.def.timing), replayed: true });
      // The same request twice is one job (QYVR-162, QYVR-171, QYVR-178): an active or pending job of this
      // chat with this action (kind and normalized instructions) is the answer, whatever title the model
      // gave it and whatever absolute time a relative schedule resolved to. A one-shot that already ran is
      // not "asked for": this makes another, and the answer says so. A second identical job is made only
      // when `separate` is passed and the person's own latest message asks for one, decided here from the
      // stored message. Only the person's own jobs are read, so another's is never matched or reused.
      const key = actionKey(s.schedule.kind, a.instructions);
      // One "another" is one more job, not as many as the model likes: the message's allowance is spent when used.
      const separate = a.separate === true && asksForAnother(o.separate.text()) && !o.separate.spent();
      let ranBefore: { id: string; title: string } | null = null;
      let copies = 0;
      for (const { id: other, job: seenJob } of seenJobs) {
        const d = seenJob.def;
        if (d.chat !== o.chatId || actionKey(d.timing.schedule.kind, d.instructions) !== key) continue;
        copies += 1;
        if (seenJob.status === "finished" && d.timing.schedule.kind === "runonce") ranBefore ??= { id: other, title: d.title };
        if (seenJob.status !== "active" && seenJob.status !== "needs_enable") continue;
        if (separate) continue;
        const words = statusWords(seenJob.status);
        const refused = a.separate === true ? "You passed separate, but the person's latest message does not ask for another one, so no second job was made. " : "";
        return ok(`${refused}The job ${other} (${d.title}) already existed (${words}, ${whenOf(d.timing)}); nothing was changed and no second job was made. ${seenJob.status === "needs_enable" ? `Call jobs_enable with id ${other} to ask for it to be turned on.` : "It is on."} If the person asks in words for another identical job, call jobs_create again with separate: true.`.trim(), { id: other, status: seenJob.status, existing: true, when: whenOf(d.timing), ...(a.separate === true ? { code: "SEPARATE_NOT_ASKED" } : {}) });
      }
      const id = jobIdFor(a.title, o.chatId, s.schedule, a.instructions, separate ? copies : 0);
      const known = await api.inspect(o.principal, id);
      if (known.ok && known.job && known.job.status !== "archived") return ok(`The job ${id} already exists (${statusWords(known.job.status)}); nothing was changed. ${known.job.status === "needs_enable" ? "Call jobs_enable to ask for it to be turned on." : ""}`.trim(), { id, status: known.job.status, existing: true });
      // A finished or removed job frees its place (M25.6); the refusal names the verb that frees one.
      const live = (await api.ids(o.principal)).length - seenJobs.filter((j) => j.job.status === "finished" || j.job.status === "archived").length;
      if (live >= MAX_JOBS) return fail("JOBS_LIMIT", `at most ${MAX_JOBS} jobs that are not finished or removed; call jobs_remove on one the person no longer wants (it asks them first)`);
      const def: JobDefinition = {
        id,
        title: a.title.trim(),
        chat: o.chatId,
        owner: a.goal ? { kind: "goal", id: a.goal } : { kind: "chat", id: o.chatId },
        stop,
        ...(reason && !gate ? { noGateReason: reason } : {}),
        ...(request ? { origin: { request, call: callId } } : {}),
        timing: timing.timing,
        gate,
        steps: [{ kind: "model" }, { kind: "notify" }],
        ceilingTokens: DEFAULT_CEILING_TOKENS,
        instructions: a.instructions.trim(),
      };
      const r = await api.define(o.principal, def);
      if (!r.ok) return fail(r.code, r.reason);
      if (separate) o.separate.spend();
      // The resolved time is the person's to know (QYVR-165): a time the agent picked for "sometime
      // tomorrow" is told to them in words, with the offer to change it, before they approve.
      const when = whenOf(def.timing);
      const earlier = ranBefore ? `The earlier job ${ranBefore.id} (${ranBefore.title}) already ran and is finished; this creates another, so tell the person the earlier one already ran. ` : "";
      // The time is said by the harness for every job it registers, named or picked: the turn may pause
      // on the approval card with no text at all (QYVR-165). The gate delivers `announce` after the step.
      const announce = timeLine(def.timing, o.now());
      return ok(`${earlier}${registeredText(id, when, r.status)}`, { id, status: r.status, cadence: r.cadence, when, ...(ranBefore ? { earlierRan: ranBefore.id } : {}), announce });
    },
  };

  const update: ToolSpec = {
    name: "jobs_update",
    kind: "observation",
    label: "Change a job",
    description:
      "Change one of the person's jobs in place: its title, instructions, schedule, zone, gate or stop. It keeps its id and its past runs, and the definition before the change is kept on the job's record, which the person can read in its run history. Pass only what changes. A change to what the job reads or does (instructions or gate) turns a job that is on off until the person turns it on again: call jobs_enable with the id after. To pause a job, use jobs_disable; to stop it for good, jobs_remove.",
    parameters: Type.Object({
      id: Type.String({ description: "The job id." }),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
      instructions: Type.Optional(Type.String({ minLength: 1, maxLength: 4000, description: "What each run should do and report, in Markdown." })),
      schedule: Type.Optional(Schedule_),
      zone: Type.Optional(Type.String({ description: "An IANA zone such as Europe/London." })),
      gate: Type.Optional(Gate_),
      no_gate_reason: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      stop: Type.Optional(Stop_),
    }),
    mutates: true,
    execute: async (_callId, p) => {
      const a = p as { id: string; title?: string; instructions?: string; schedule?: ScheduleInput; zone?: string; gate?: Gate; no_gate_reason?: string; stop?: StopCondition };
      const seen = await api.inspect(o.principal, String(a.id));
      if (!seen.ok || !seen.job || seen.job.status === "archived") return fail(seen.ok ? "JOB_UNKNOWN" : seen.code, `no job ${a.id} of the person's to change`);
      const old = seen.job.def;
      const zone = a.zone?.trim() || old.timing.zone;
      if (!validZone(zone)) return fail("SCHEDULE_ZONE_REQUIRED", `${zone} is not an IANA time zone, e.g. Europe/London`);
      const s = a.schedule ? scheduleOf(a.schedule, zone, o.now()) : { ok: true as const, schedule: old.timing.schedule };
      if (!s.ok) return fail(s.code, s.reason);
      const timing = checkTiming({ schedule: s.schedule, zone, ...(old.timing.jitterSeconds !== undefined ? { jitterSeconds: old.timing.jitterSeconds } : {}) });
      if (!timing.ok) return fail(timing.code, timing.reason);
      const at = runonceAt(s.schedule, zone);
      if (at !== null && at <= o.now()) return fail("SCHEDULE_PAST", `${(s.schedule as { at: string }).at} (${zone}) is not after now`);
      const gate = a.gate ?? old.gate;
      if (!checkGate(gate)) return fail("JOB_GATE_INVALID", "a gate is url, watermark or threshold over an https url");
      const denied = gateHostRefusal(gate);
      if (denied) return fail("JOB_GATE_HOST_DENIED", `a job can watch any public https website by its name, not an IP address, a private name, a platform host or an address with a port or login: ${denied}`);
      const reason = a.no_gate_reason?.trim() || old.noGateReason;
      if (s.schedule.kind !== "runonce" && !gate && !reason) return fail("JOB_GATE_REQUIRED", "a recurring job takes a gate (url, watermark or threshold), or no_gate_reason saying why it must run every time");
      const stop: StopCondition = s.schedule.kind === "runonce" ? { kind: "after_runs", runs: 1 } : (a.stop ?? (old.timing.schedule.kind === "runonce" ? { kind: "turned_off" } : old.stop));
      if (!checkStop(stop)) return fail("JOB_STOP_INVALID", "stop is after_runs with runs, until with a YYYY-MM-DD date, first_report or turned_off");
      const { noGateReason: _, ...rest } = old;
      const def: JobDefinition = { ...rest, title: a.title?.trim() || old.title, instructions: a.instructions?.trim() || old.instructions, timing: timing.timing, gate, stop, ...(reason && !gate ? { noGateReason: reason } : {}) };
      const r = await api.update(o.principal, def);
      if (!r.ok) return fail(r.code, r.reason);
      const when = whenOf(def.timing);
      const off = r.status === "needs_enable" && seen.job.status === "active" ? ` What it reads or does changed, so it is off until the person turns it on: call jobs_enable with id ${def.id}.` : "";
      return ok(`Changed job ${def.id} in place (${when}), currently ${statusWords(r.status)}. Its earlier definition is kept on its record.${off}`, { id: def.id, status: r.status, when });
    },
  };

  const list: ToolSpec = {
    name: "jobs_list",
    kind: "observation",
    label: "List jobs",
    description: "List the person's jobs with their status, cadence and latest run.",
    parameters: Type.Object({}),
    execute: async () => {
      const lines: string[] = [];
      for (const id of await api.ids(o.principal)) {
        const s = await api.inspect(o.principal, id);
        if (!s.ok || !s.job) {
          lines.push(`- ${id}: could not be read (${s.ok ? "JOB_UNKNOWN" : s.code})`);
          continue;
        }
        const last = s.runs.at(-1);
        lines.push(`- ${id}: ${s.job.def.title}; ${statusWords(s.job.status)}; ${s.job.cadence}${last ? `; latest run ${last.phase}${last.code ? ` (${last.code})` : ""}` : "; no run yet"}`);
      }
      return ok(lines.join("\n") || "(no jobs)", { count: lines.length });
    },
  };

  const enable: ToolSpec = {
    name: "jobs_enable",
    kind: "action",
    label: "Turn a job on",
    description: "Ask the person to turn on a job you registered. They decide on one approval card; until they do, the job never runs.",
    parameters: Type.Object({ id: Type.String({ description: "The job id jobs_create returned." }) }),
    actionKind: "jobs.enable",
    subject: (args) => ({ scope: "personal", resource: `job:${String(args.id)}` }),
    // The approval card names the job and the time it will run, so the person decides on both (QYVR-165).
    cardLines: async (args) => {
      const seen = await api.inspect(o.principal, String(args.id));
      return seen.ok && seen.job ? cardLinesOf(seen.job.def) : [];
    },
    execute: async (_id, p) => {
      const id = String((p as { id: string }).id);
      const r = await api.enable(o.principal, id);
      if (!r.ok) return fail(r.code, r.reason ?? "refused");
      return ok(`Job ${id} is on.`, { id });
    },
  };

  const disable: ToolSpec = {
    name: "jobs_disable",
    kind: "observation",
    label: "Turn a job off",
    description: "Turn one of the person's jobs off. It stays listed and the person can turn it on again.",
    parameters: Type.Object({ id: Type.String({ description: "The job id." }) }),
    mutates: true,
    execute: async (_id, p) => {
      const id = String((p as { id: string }).id);
      const r = await api.disable(o.principal, id);
      if (!r.ok) return fail(r.code, r.reason ?? "refused");
      return ok(`Job ${id} is off.`, { id });
    },
  };

  const remove: ToolSpec = {
    name: "jobs_remove",
    kind: "action",
    label: "Remove a job",
    description: "Ask the person to remove a job. They decide on one approval card; a removed job stops, leaves the list and frees its place, and its past runs are kept.",
    parameters: Type.Object({ id: Type.String({ description: "The job id." }) }),
    actionKind: "jobs.remove",
    subject: (args) => ({ scope: "personal", resource: `job:${String(args.id)}` }),
    cardLines: async (args) => {
      const seen = await api.inspect(o.principal, String(args.id));
      return seen.ok && seen.job ? [`Remove job: ${seen.job.def.title}`, `When: ${whenOf(seen.job.def.timing)}`, "It stops, leaves your list and cannot be turned back on; its past runs are kept."] : [];
    },
    execute: async (_id, p) => {
      const id = String((p as { id: string }).id);
      const r = await api.remove(o.principal, id);
      if (!r.ok) return fail(r.code, r.reason ?? "refused");
      return ok(`Job ${id} is removed.`, { id });
    },
  };

  return { name: "jobs", description: "jobs: register a job that runs later or on a schedule, list, change in place, turn on (the person approves) and off, remove (the person approves)", deferral: "names", tools: [create, list, update, enable, disable, remove] };
}
