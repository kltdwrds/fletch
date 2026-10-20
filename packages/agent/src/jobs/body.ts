// Job bodies (M5.1, muse-reference section 6): a Markdown file with YAML frontmatter in the tenant
// bucket, reconciled into the `Job` by its sha256. The frontmatter is flat `key: value` lines; a
// value that is JSON (a flow mapping or sequence, a number) is read as JSON, which YAML accepts.
// The body is the job's instructions. Nothing in a body grants a capability: it names a schedule,
// a gate and steps from the fixed set, and the engine decides everything else.
import type { Gate } from "./gates.ts";
import { checkTiming, type Timing } from "./schedule.ts";

export type StepSpec =
  /** Says what the gate observed, deterministically: the watch's message. */
  | { kind: "diff" }
  /** One model call over the previous step's output and the instructions, on the `job` route. */
  | { kind: "model"; prompt?: string; maxTokens?: number }
  /** Waits for the owner's decision, completed by an event; times out after `timeoutMinutes`. */
  | { kind: "approval"; prompt: string; timeoutMinutes: number }
  /** Queues the previous step's output to the job's chat through the outbox. */
  | { kind: "notify" }
  /** Steps a test registers; a body can never name one. */
  | { kind: `fixture:${string}`; [k: string]: unknown };

/** Whom a job is for (M25.2): the chat it was asked in, or a goal; results still arrive in `chat`. */
export type JobOwner = { kind: "chat"; id: string } | { kind: "goal"; id: string };

/**
 * When a job ends itself (M25.2): after a number of finished runs, at the end of a local date in its
 * zone, after its first reported result, or only when the person turns it off.
 */
export type StopCondition = { kind: "after_runs"; runs: number } | { kind: "until"; date: string } | { kind: "first_report" } | { kind: "turned_off" };

export interface JobDefinition {
  id: string;
  title: string;
  /** The chat results go to: the one the job was asked for in (B17). */
  chat: string;
  owner: JobOwner;
  stop: StopCondition;
  /** A recurring job with no gate says why (M25.2); the enable card shows it. */
  noGateReason?: string;
  /** The request and tool call that created it, from chat: a replayed `jobs_create` finds it by these (M25.2). */
  origin?: { request: string; call: string };
  timing: Timing;
  gate: Gate | null;
  steps: StepSpec[];
  /** Tokens a single run may spend across its model steps. */
  ceilingTokens: number;
  instructions: string;
}

export type BodyCode = "JOB_BODY_INVALID" | "SCHEDULE_ZONE_REQUIRED" | "SCHEDULE_INVALID";
export type ParsedBody = { ok: true; def: JobDefinition } | { ok: false; code: BodyCode; reason: string };

export const DEFAULT_CEILING_TOKENS = 20_000;
export const GOAL_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks a stop condition from a body or a tool call. */
export function checkStop(v: unknown): v is StopCondition {
  const x = v as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return false;
  if (x.kind === "after_runs") return Number.isInteger(x.runs) && (x.runs as number) >= 1 && (x.runs as number) <= 1000;
  if (x.kind === "until") return typeof x.date === "string" && LOCAL_DATE.test(x.date) && !Number.isNaN(Date.parse(x.date));
  return x.kind === "first_report" || x.kind === "turned_off";
}

/** How the stop condition is said on the card and in answers. */
export function describeStop(s: StopCondition): string {
  switch (s.kind) {
    case "after_runs":
      return s.runs === 1 ? "after it runs once" : `after ${s.runs} runs`;
    case "until":
      return `at the end of ${s.date}`;
    case "first_report":
      return "after its first result";
    case "turned_off":
      return "when you turn it off";
  }
}
/** A job id: lowercase letters, digits and dashes. */
export const JOB_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** An `Ingress` source id (M6.1): 32 lowercase hex characters. */
export const SOURCE_ID = /^[0-9a-f]{32}$/;
const BODY_STEPS = new Set(["diff", "model", "approval", "notify"]);

function value(raw: string): unknown {
  const v = raw.trim();
  if (/^[[{0-9-]/.test(v) || v === "true" || v === "false" || v === "null") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v.replace(/^"(.*)"$/, "$1");
}

/** Splits `---` frontmatter from the body; null when the file has none. */
export function frontmatter(text: string): { fields: Record<string, unknown>; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fields: Record<string, unknown> = {};
  for (const line of (m[1] as string).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const at = line.indexOf(":");
    if (at <= 0) continue;
    fields[line.slice(0, at).trim()] = value(line.slice(at + 1));
  }
  return { fields, body: (m[2] as string).trim() };
}

export function checkGate(g: unknown): g is Gate | null {
  if (g === null || g === undefined) return true;
  const x = g as Record<string, unknown>;
  if (x.kind === "window") return typeof x.window === "object" && x.window !== null;
  if (x.kind === "url" || x.kind === "watermark" || x.kind === "threshold") return typeof x.url === "string" && x.url.startsWith("https://");
  if (x.kind === "event") return typeof x.source === "string" && SOURCE_ID.test(x.source) && (x.pointer === undefined || typeof x.pointer === "string");
  return false;
}

function checkSteps(s: unknown): s is StepSpec[] {
  return (
    Array.isArray(s) &&
    s.length > 0 &&
    s.length <= 8 &&
    s.every((x) => {
      const k = (x as { kind?: unknown })?.kind;
      if (typeof k !== "string" || !BODY_STEPS.has(k)) return false;
      if (k === "approval") return typeof (x as { prompt?: unknown }).prompt === "string" && Number.isInteger((x as { timeoutMinutes?: unknown }).timeoutMinutes);
      return true;
    })
  );
}

export function parseJobBody(text: string): ParsedBody {
  const fm = frontmatter(text);
  const bad = (reason: string): ParsedBody => ({ ok: false, code: "JOB_BODY_INVALID", reason });
  if (!fm) return bad("a job body opens with --- frontmatter ---");
  const f = fm.fields;
  if (typeof f.id !== "string" || !JOB_ID.test(f.id)) return bad("id is lowercase letters, digits and dashes");
  if (typeof f.chat !== "string" || !f.chat) return bad("chat names the chat results go to");
  const timing = checkTiming({ schedule: f.schedule, zone: f.zone, jitterSeconds: f.jitter });
  if (!timing.ok) return timing;
  const gate = f.gate ?? null;
  if (!checkGate(gate)) return bad("gate is a window, url, watermark, threshold or event gate; urls are https");
  const steps = f.steps ?? (gate ? [{ kind: "diff" }, { kind: "notify" }] : null);
  if (!checkSteps(steps)) return bad("steps are one to eight of diff, model, approval and notify");
  const ceiling = f.ceiling ?? DEFAULT_CEILING_TOKENS;
  if (!Number.isSafeInteger(ceiling) || (ceiling as number) <= 0) return bad("ceiling is a positive number of tokens");
  const goal = f.goal ?? null;
  if (goal !== null && (typeof goal !== "string" || !GOAL_ID.test(goal))) return bad("goal is a goal id: lowercase letters, digits and dashes");
  const stop = f.stop ?? (timing.timing.schedule.kind === "runonce" ? { kind: "after_runs", runs: 1 } : { kind: "turned_off" });
  if (!checkStop(stop)) return bad("stop is after_runs, until (a date), first_report or turned_off");
  return {
    ok: true,
    def: {
      id: f.id, title: typeof f.title === "string" ? f.title : f.id, chat: f.chat, owner: goal ? { kind: "goal", id: goal } : { kind: "chat", id: f.chat }, stop,
      timing: timing.timing, gate, steps, ceilingTokens: ceiling as number, instructions: fm.body,
    },
  };
}
