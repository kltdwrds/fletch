// A job's model step (M5.1, M25.2): calls on the `job` route through the adapter, so each is admitted
// by the Ledger first (the run's hard ceiling, the person's and tenant's budgets, staging's cap),
// gatewayed and recorded like every other call. The step may read with the job's read-only tools and
// ends with exactly one terminal tool: `report`, or `nothing_to_report` checked in code
// (`silence.ts`). The input, every tool result and the job's instructions reach the model as data.
import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { assemble } from "../context/assemble.ts";
import { fence } from "../context/fence.ts";
import { PLATFORM_INSTRUCTIONS } from "../chat/instructions.ts";
import { scrubSurrogates, scrubValue } from "../egress/surrogate.ts";
import type { LedgerSink } from "../ledger/types.ts";
import { createStreamFn } from "../model/adapter.ts";
import { type ModelConfig, modelFor } from "../model/routes.ts";
import type { ToolSpec } from "../tools/registry.ts";
import { readOnlyForJob, TERMINAL_SPECS, TERMINAL_TOOLS } from "./job-tools.ts";
import { type CallRecord, certifySilence, type SilenceClaim } from "./silence.ts";

export const JOB_TASK =
  "You are running one step of a scheduled job for the person. Follow the job's instructions over the input, reading with your tools where the instructions need it; you cannot change anything. End with exactly one terminal tool, alone: report with the text to tell the person, or nothing_to_report when the work ran and found nothing material.";

/** Model calls one step may make before it must have ended; the run's token ceiling usually ends it first. */
export const MAX_JOB_CALLS = 8;
/** Rejected silences before the run fails: the first comes back to the model with its codes. */
const MAX_REJECTED_SILENCE = 2;

export type JobModelResult =
  | { ok: true; kind: "report"; text: string; calls: CallRecord[] }
  | { ok: true; kind: "silent"; claim: SilenceClaim; calls: CallRecord[] }
  | { ok: false; code: string; reason: string; calls: CallRecord[] };

export interface JobModelInput {
  person: string;
  runId: string;
  ceiling: number;
  instructions: string;
  input: string;
  maxTokens?: number;
  /** What the host offers; only the read-only ones run (`readOnlyForJob`). */
  tools?: ToolSpec[];
  /** Whether the gate opened on an observation this run: "gate" is then fresh evidence. */
  gateObserved?: boolean;
}

export interface JobModelDeps {
  ai: Ai;
  /** The deploy's model configuration (`modelConfig(env)`). */
  models?: ModelConfig;
  ledger: LedgerSink;
  tenant: string;
  now: () => number;
  wait: (ms: number) => Promise<void>;
}

const resultText = (r: unknown) => ((r as { content?: Array<{ type: string; text?: string }> })?.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");

function failure(message: AssistantMessage): { code: string; reason: string } {
  const text = message.errorMessage ?? "MODEL_CALL_FAILED: no detail";
  const at = text.indexOf(":");
  return { code: at > 0 ? text.slice(0, at) : "MODEL_CALL_FAILED", reason: at > 0 ? text.slice(at + 1).trim() : text };
}

/**
 * The step's loop over one model: each message either ends the run with one terminal tool alone, or
 * calls read tools whose results go back to it. No tool call, two terminal tools, or a terminal tool
 * beside other calls ends the run as failed with its code.
 */
export async function jobLoop(call: (messages: Message[]) => Promise<AssistantMessage>, first: Message[], a: JobModelInput, now: () => number): Promise<JobModelResult> {
  const offered = new Map((a.tools ?? []).map((t) => [t.name, t]));
  const calls: CallRecord[] = [];
  const messages = [...first];
  let rejected = 0;
  const fail = (code: string, reason: string): JobModelResult => ({ ok: false, code, reason, calls });
  for (let i = 0; i < MAX_JOB_CALLS; i++) {
    const message = await call(messages);
    if (message.stopReason === "error" || message.stopReason === "aborted") return { ok: false, ...failure(message), calls };
    const toolCalls = message.content.filter((c): c is ToolCall => c.type === "toolCall");
    if (!toolCalls.length) return fail("JOB_TERMINAL_MISSING", "the model answered without a terminal tool (report or nothing_to_report)");
    const terminals = toolCalls.filter((c) => TERMINAL_TOOLS.has(c.name));
    if (terminals.length > 1) return fail("JOB_TERMINAL_MULTIPLE", `${terminals.length} terminal tools in one answer; a run ends with exactly one`);
    if (terminals.length === 1 && toolCalls.length > 1) return fail("JOB_TERMINAL_NOT_ALONE", "a terminal tool was called beside other tools; it ends the run alone");
    messages.push(message);
    const terminal = terminals[0];
    if (terminal?.name === "report") {
      const t = (terminal.arguments as { text?: unknown }).text;
      return typeof t === "string" && t.trim() ? { ok: true, kind: "report", text: scrubSurrogates(t.trim()), calls } : fail("JOB_REPORT_INVALID", "report takes the text to deliver");
    }
    if (terminal) {
      const verdict = certifySilence(terminal.arguments, calls, a.gateObserved === true);
      if (verdict.ok) return { ok: true, kind: "silent", claim: verdict.claim, calls };
      const why = verdict.codes.map((c) => `${c.code}: ${c.reason}`).join("; ");
      if (++rejected >= MAX_REJECTED_SILENCE) return fail("SILENCE_UNCERTIFIED", why);
      messages.push({ role: "toolResult", toolCallId: terminal.id, toolName: terminal.name, content: [{ type: "text", text: `Silence refused, the run goes on. ${why}` }], isError: true, timestamp: now() });
      continue;
    }
    for (const c of toolCalls) {
      const spec = offered.get(c.name);
      let out: { text: string; isError: boolean };
      if (!spec) {
        calls.push({ id: c.id, tool: c.name, ok: false, refused: "JOB_TOOL_UNKNOWN" });
        out = { text: `JOB_TOOL_UNKNOWN: a job has no tool ${c.name}; its tools read only`, isError: true };
      } else if (!readOnlyForJob(spec)) {
        calls.push({ id: c.id, tool: c.name, ok: false, refused: "JOB_WRITE_REFUSED" });
        out = { text: `JOB_WRITE_REFUSED: ${c.name} is not a read tool, and a job never writes; nothing was done`, isError: true };
      } else {
        try {
          const r = scrubValue(await spec.execute(c.id, c.arguments as never, undefined, undefined));
          calls.push({ id: c.id, tool: c.name, ok: true });
          out = { text: resultText(r) || "(empty)", isError: false };
        } catch (err) {
          const m = scrubSurrogates(String(err instanceof Error ? err.message : err));
          const code = /^[A-Z][A-Z0-9_]+(?=:)/.exec(m)?.[0] ?? "TOOL_FAILED";
          calls.push({ id: c.id, tool: c.name, ok: false, code });
          out = { text: m, isError: true };
        }
      }
      messages.push({ role: "toolResult", toolCallId: c.id, toolName: c.name, content: [{ type: "text", text: `[call ${c.id}]\n${out.text}` }], isError: out.isError, timestamp: now() });
    }
  }
  return fail("JOB_TERMINAL_MISSING", `no terminal tool after ${MAX_JOB_CALLS} model calls`);
}

export async function completeForJob(deps: JobModelDeps, a: JobModelInput): Promise<JobModelResult> {
  const model = modelFor("job");
  const streamFn = createStreamFn(
    { ai: deps.ai, ledger: deps.ledger, now: deps.now, wait: deps.wait, models: deps.models },
    { tenant: deps.tenant, person: a.person, runId: a.runId, route: "job", ceiling: a.ceiling },
  );
  const offered = (a.tools ?? []).filter(readOnlyForJob);
  const first = assemble({
    platform: PLATFORM_INSTRUCTIONS,
    task: JOB_TASK,
    standingFiles: [],
    memory: [],
    skills: [],
    envelope: { now: deps.now(), timeZone: "UTC", surface: "job", modelId: model.id, owner: a.person },
    tools: [...offered.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })), ...TERMINAL_SPECS],
    transcript: [{ role: "user", content: `${a.instructions}\n\n${fence("job:input", a.input)}`, timestamp: deps.now() }],
  });
  const call = async (messages: Message[]) => (await streamFn(model, normalizeContext({ messages }), a.maxTokens ? { maxTokens: a.maxTokens } : {})).result();
  return jobLoop(call, first, a, deps.now);
}
