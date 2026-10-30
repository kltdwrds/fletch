// A task's steps (F13): its tool calls as the transcript stores them, in seq order, each paired with the result of
// the same call id and named by code from one table, never by the model's words about them. The evidence (what was
// read, written, run) comes from the chat's own owner-only transcript; only the outcome of a gated action comes from
// the journal, joined by call id within the task's turns, because the journal is content-free by design. A message
// to the person (`send_to_user`) and a reaction are the chat itself, drawn there, so they are not steps. The
// transcript is read whole here, unlike `visibleHistory`, whose `textOf` keeps text blocks alone and drops every
// tool call and result: the timeline is exactly what that view leaves out.
import type { Message } from "@earendil-works/pi-ai";
import { unfence } from "../context/fence.ts";
import { isPurchaseKind } from "../grants/engine.ts";
import type { JournalRow } from "../grants/journal.ts";
import { DECISION_WORDS, OUTCOME_WORDS, SUMMARY_WORDS, titleOf, UNKNOWN_OUTCOME } from "../obs/activity-words.ts";
import type { TranscriptRow } from "./history.ts";

export type StepKind = "read" | "edit" | "write" | "delete" | "search" | "code" | "todo" | "memory" | "load" | "launch" | "close" | "action" | "observe" | "other";
export type StepState = "started" | "done" | "failed" | "waiting" | "refused";

/** One block of a step's detail: a labelled text the page shows as code, cut at `BLOCK_CHARS` and saying so. */
export interface StepBlock {
  label: string;
  text: string;
  lang: "js" | "text";
  cut: boolean;
}

/** A file a task wrote or edited, with the first lines of the change. */
export interface FileCard {
  path: string;
  preview: string;
}

/** What a step's detail pane shows (the plan's §(b.4)): code's words, the blocks, the result, the lines and the file cards. */
export interface StepDetail {
  prose: string;
  blocks: StepBlock[];
  /** The tool's answer, its code when it failed and how long it took; null while the call has none. */
  result: { ok: boolean; code: string | null; durationMs: number | null; text: string; cut: boolean } | null;
  lines: string[];
  files: FileCard[];
  /** True when any block or the result was cut at `BLOCK_CHARS`. */
  cut: boolean;
}

export interface StepRecord {
  /** 1-based, in timeline order. */
  n: number;
  turnId: string;
  /** The tool call's id; empty for the marker and the summary. */
  callId: string;
  /** `verdict` is a returned delegation's, synthesized from the parent's rows; `handoff` a sub-agent's final text (F14). */
  kind: StepKind | "marker" | "summary" | "verdict" | "handoff";
  tool: string;
  title: string;
  state: StepState;
  code: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  detail: StepDetail;
}

/** The most steps a task answers with; past it the first `STEPS_PER_TASK - 1`, a marker saying how many are not shown, then the summary. */
export const STEPS_PER_TASK = 200;
/** The most characters of one detail block the route answers; a cut block says so. */
export const BLOCK_CHARS = 20_000;
/** The file cards the summary carries, and the lines of each change it previews. */
export const SUMMARY_FILES = 3;
export const PREVIEW_LINES = 8;
/** Calls that are the chat itself, drawn there already: never steps. */
export const NOT_STEPS: ReadonlySet<string> = new Set(["send_to_user", "react"]);

type Args = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** A title is one line: the data's own characters, its whitespace runs folded. */
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const firstLine = (s: string): string => oneLine(s.split("\n").find((l) => l.trim()) ?? "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const todoItems = (a: Args): Array<{ text: string; done: boolean }> => (Array.isArray(a.items) ? (a.items as Array<{ text?: unknown; done?: unknown }>).map((i) => ({ text: str(i?.text), done: i?.done === true })) : []);
/** A delegation's requests: the main agent's `tasks`, or a coordinator's `briefs`, each a worker's (`subagents/run.ts`, F14). */
const tasksOf = (a: Args): Array<{ role: string; brief: string }> =>
  Array.isArray(a.tasks) ? (a.tasks as Array<{ role?: unknown; brief?: unknown }>).map((t) => ({ role: str(t?.role), brief: str(t?.brief) })) : Array.isArray(a.briefs) ? (a.briefs as unknown[]).map((b) => ({ role: "worker", brief: str(b) })) : [];

/** The page a browse call names: its address, or the link number it was given. */
const pageOf = (a: Args): string => str(a.url) || (typeof a.url_id === "number" ? `link ${a.url_id}` : "");
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Each tool's kind and title in code's words, by tool name; a tool not here is "Called <tool>". */
export const STEP_WORDS: Record<string, { kind: StepKind; title: (a: Args) => string }> = {
  file_read: { kind: "read", title: (a) => `Read \`${str(a.path)}\`` },
  browse_open: { kind: "read", title: (a) => `Read the page \`${pageOf(a)}\`` },
  browse_live: { kind: "read", title: (a) => (pageOf(a) ? `Opened the page \`${pageOf(a)}\` in the live browser` : "Read the live browser's page again") },
  file_list: { kind: "observe", title: (a) => (str(a.prefix) ? `Listed the files under \`${str(a.prefix)}\`` : "Listed your files") },
  file_write: { kind: "write", title: (a) => `Wrote \`${str(a.path)}\`` },
  file_edit: { kind: "edit", title: (a) => `Edited \`${str(a.path)}\`` },
  file_delete: { kind: "delete", title: (a) => `Deleted \`${str(a.path)}\`` },
  file_grep: { kind: "search", title: (a) => `Searched for \`${str(a.pattern)}\`` },
  file_find: { kind: "search", title: (a) => `Looked for files matching \`${str(a.pattern)}\`` },
  code_execute: { kind: "code", title: () => "Ran a script" },
  todo_write: {
    kind: "todo",
    title: (a) => {
      const items = todoItems(a);
      const open = items.filter((i) => !i.done);
      return `Updated the checklist: ${open.length} open, ${items.length - open.length} done${open[0] ? `; next: ${open[0].text}` : ""}`;
    },
  },
  memory_write: { kind: "memory", title: () => "Saved to memory" },
  memory_search: { kind: "search", title: (a) => `Searched memory for \`${str(a.query)}\`` },
  memory_get: { kind: "read", title: (a) => `Read memory \`${str(a.path)}\`` },
  memory_explain: { kind: "observe", title: () => "Looked up where a memory came from" },
  // A job set or changed in place is a write the task names by its subject (F31, T-P5-10); turning one on or off, or
  // removing it, is the person's card, an action.
  jobs_create: { kind: "write", title: (a) => `Set the job \`${str(a.title)}\`` },
  jobs_update: { kind: "edit", title: (a) => `Changed the job \`${str(a.id)}\`` },
  skill_read: { kind: "read", title: (a) => `Read the skill \`${str(a.name) || str(a.path)}\`` },
  skill_search: { kind: "search", title: (a) => `Searched skills for \`${str(a.query)}\`` },
  tool_search: {
    kind: "load",
    title: (a) => {
      const load = Array.isArray(a.load) ? (a.load as unknown[]).map(String) : [];
      return load.length ? `Loaded the ${load.join(", ")} tools` : `Looked for tools: ${str(a.query)}`;
    },
  },
  subagents_delegate: {
    kind: "launch",
    title: (a) => {
      const tasks = tasksOf(a);
      return `Started ${plural(tasks.length, "sub-agent")}: ${firstLine(tasks[0]?.brief ?? "")}`;
    },
  },
  subagents_close: { kind: "close", title: () => "Closed sub-agents" },
  subagents_status: { kind: "observe", title: () => "Checked on sub-agents" },
};

/** A tool's name as words, its underscores as spaces: the label its approval card carries (`ChatEngine.approvals`). */
const spaced = (tool: string) => tool.replaceAll("_", " ");
const capital = (s: string) => (s ? s[0]?.toUpperCase() + s.slice(1) : s);
const CODE = /^([A-Z][A-Z0-9_]{1,60}):/;
/** A failed result's code: its leading `CODE:` token (`tools/registry.ts` throws `CODE: reason`), else `TOOL_FAILED`. */
export const codeOf = (text: string): string => CODE.exec(text.trimStart())?.[1] ?? "TOOL_FAILED";

const cut = (text: string): { text: string; cut: boolean } => (text.length > BLOCK_CHARS ? { text: text.slice(0, BLOCK_CHARS), cut: true } : { text, cut: false });
const block = (label: string, text: string, lang: StepBlock["lang"] = "text"): StepBlock => ({ label, lang, ...cut(text) });

type Call = { id: string; name: string; arguments: Args };
type Result = { text: string; isError: boolean; timestamp: number | null; durationMs: number | null };
/** What `detailOf` builds a step's detail from: the step, the call's arguments, its result and its journal rows. */
export interface StepInput {
  step: Pick<StepRecord, "kind" | "tool" | "title" | "state" | "code">;
  args: Args;
  result: Result | null;
  journal: JournalRow[];
}

/** A result's text as the tool returned it: the text parts, the outer `tool:<name>` fence stripped. */
function resultText(m: Message): string {
  const c = (m as { content?: unknown }).content;
  const parts = typeof c === "string" ? [c] : Array.isArray(c) ? c.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")) : [];
  return parts.filter(Boolean).map((t) => unfence(`tool:${(m as { toolName?: string }).toolName ?? ""}`, t)).join("\n");
}

/** The detail pane's data for one step, every kind, each block cut at `BLOCK_CHARS`. */
export function detailOf(input: StepInput): StepDetail {
  const { step, args, result, journal } = input;
  const blocks: StepBlock[] = [];
  const lines: string[] = [];
  let prose = step.title;
  switch (step.kind) {
    case "edit":
      blocks.push(block("Change", str(args.newText)), block("Before", str(args.oldText)));
      break;
    case "write":
      blocks.push(block("Change", str(args.text)));
      break;
    case "code":
      blocks.push(block("Script", str(args.script), "js"));
      if (args.input !== undefined) blocks.push(block("Input", JSON.stringify(args.input, null, 2)));
      break;
    case "todo":
      lines.push(...todoItems(args).map((i) => `${i.done ? "Done" : "Open"}: ${i.text}`));
      break;
    case "memory":
      if (str(args.text)) blocks.push(block("Saved", str(args.text)));
      else if (Array.isArray(args.edits)) blocks.push(block("Edits", JSON.stringify(args.edits, null, 2)));
      break;
    case "load":
      if (Array.isArray(args.load)) lines.push(...(args.load as unknown[]).map((n) => `Loaded: ${String(n)}`));
      if (str(args.query)) lines.push(`Looked for: ${str(args.query)}`);
      break;
    case "launch": {
      const tasks = tasksOf(args);
      prose = `Started ${plural(tasks.length, "sub-agent")} on parts of this task. Each works on its own brief, and their handoff returns to this chat when all have returned.`;
      blocks.push(...tasks.map((t, i) => block(`Brief ${i + 1} (${t.role || "worker"})`, t.brief)));
      break;
    }
    case "action":
      for (const r of journal) lines.push(DECISION_WORDS[r.decision] ?? r.decision, OUTCOME_WORDS[r.outcome] ?? UNKNOWN_OUTCOME);
      break;
    default:
      break;
  }
  if (!result) lines.push(step.state === "waiting" ? "Waiting for your decision." : "No result yet.");
  // A page read says how much came back; a file the step wrote or edited is its card (T-P5-02).
  if (result && !result.isError && step.tool.startsWith("browse_")) lines.push(`${plural(bytes(result.text), "byte")} came back.`);
  const files: FileCard[] = result && !result.isError && (step.kind === "write" || step.kind === "edit") && str(args.path) ? [{ path: str(args.path), preview: str(step.kind === "edit" ? args.newText : args.text).split("\n").slice(0, PREVIEW_LINES).join("\n") }] : [];
  const answered = result ? { ok: !result.isError, code: result.isError ? step.code : null, durationMs: result.durationMs, ...cut(result.text) } : null;
  return { prose, blocks, result: answered, lines, files, cut: blocks.some((b) => b.cut) || answered?.cut === true };
}

/** The step's state and code from the journal's rows for its call, the latest first: a decision's row comes after the proposal's. */
function joined(rows: JournalRow[]): { state: StepState; code: string | null } | null {
  const last = rows.at(-1);
  if (!last) return null;
  if (last.outcome === "DONE") return { state: "done", code: null };
  if (last.outcome === "PENDING") return { state: "waiting", code: null };
  if (last.decision === "deny" || last.outcome.startsWith("DENIED") || last.outcome === "DECLINED" || last.outcome.endsWith("_REQUIRED")) return { state: "refused", code: last.outcome };
  return { state: "failed", code: last.outcome };
}

/**
 * The journal rows of one call: the Ledger's rows for the person whose `runId` is one of the task's turns, matched by
 * the row's id, which the chat writes as `<chatId>:<callId>` for the call and `<chatId>:<callId>:decision` for the
 * person's decision on its card (`chat/approvals.ts` `row`). An attempt refused to someone else is not the call's outcome.
 */
export function journalOf(journal: readonly JournalRow[], chatId: string, turnIds: ReadonlySet<string>, callId: string): JournalRow[] {
  const ids = new Set([`${chatId}:${callId}`, `${chatId}:${callId}:decision`]);
  return journal.filter((r) => turnIds.has(r.runId) && ids.has(r.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

/**
 * A task's tool calls as steps, in seq order: each `toolCall` part of an assistant message, paired with the
 * `toolResult` of the same call id. `chatId` is the journal ids' prefix. A call with journal rows is a gated action,
 * titled by its card's label and in the state its latest row says, a purchase by its kind's words in `KIND_WORDS`
 * (P12 delta 3: an ask, true whatever the outcome); every other call is titled from `STEP_WORDS`.
 */
export function stepsOf(rows: readonly TranscriptRow[], journal: readonly JournalRow[], o: { chatId: string; child?: boolean }): StepRecord[] {
  const results = new Map<string, Result>();
  for (const { message: m } of rows) {
    if (m.role !== "toolResult") continue;
    results.set(m.toolCallId, { text: resultText(m), isError: m.isError === true, timestamp: typeof m.timestamp === "number" ? m.timestamp : null, durationMs: typeof m.durationMs === "number" ? m.durationMs : null });
  }
  const turnIds = new Set(rows.map((r) => r.turnId));
  const out: StepRecord[] = [];
  for (const { turnId, message: m } of rows) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      // A sub-agent has no chat (F33, T-P3-03): its send or reaction is a call of its own, drawn as a step.
      if (part.type !== "toolCall" || (NOT_STEPS.has(part.name) && !o.child)) continue;
      const call = part as unknown as Call;
      const args = (call.arguments && typeof call.arguments === "object" ? call.arguments : {}) as Args;
      const result = results.get(call.id) ?? null;
      const rowsOfCall = journalOf(journal, o.chatId, turnIds, call.id);
      const words = STEP_WORDS[call.name];
      const action = rowsOfCall.length > 0;
      const kind: StepKind = action ? "action" : (words?.kind ?? "other");
      const kindOf = rowsOfCall[0]?.actionKind ?? "";
      const base = action ? (isPurchaseKind(kindOf) ? titleOf("purchase") : capital(spaced(call.name))) : words ? words.title(args) : `Called ${spaced(call.name)}`;
      const outcome = joined(rowsOfCall);
      let state: StepState = result ? (result.isError ? "failed" : "done") : "started";
      let code: string | null = result?.isError ? codeOf(result.text) : null;
      if (outcome) ({ state, code } = outcome);
      const title = oneLine(state === "failed" ? `${base} failed (${code})` : state === "refused" ? `${base}: not done (${code})` : base);
      const startedAt = typeof m.timestamp === "number" ? m.timestamp : null;
      const endedAt = result?.timestamp ?? null;
      const durationMs = result ? (result.durationMs ?? (startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null)) : null;
      const step = { kind, tool: call.name, title, state, code };
      out.push({ n: out.length + 1, turnId, callId: call.id, ...step, startedAt, endedAt, durationMs, detail: detailOf({ step, args, result, journal: rowsOfCall }) });
    }
  }
  return out;
}

const textOfAssistant = (m: Message): string =>
  m.role === "assistant" && Array.isArray(m.content) ? m.content.flatMap((p) => (p.type === "text" && typeof p.text === "string" ? [p.text] : [])).join("").trim() : "";

/** Each step kind's group in the summary's counts (`SUMMARY_WORDS.groups`); a tool load is counted only when it failed. */
const SUMMARY_GROUP: Record<StepKind, keyof typeof SUMMARY_WORDS.groups | null> = {
  read: "read", observe: "read", search: "read",
  write: "wrote", edit: "wrote", delete: "wrote", memory: "wrote",
  code: "ran", action: "ran", launch: "ran", close: "ran",
  todo: "other", other: "other", load: null,
};
const failedState = (s: Pick<StepRecord, "state">) => s.state === "failed" || s.state === "refused";

/**
 * What a task did, by count, in `SUMMARY_WORDS` (F31, P5 delta 1): read, wrote, ran and other steps, each with how many
 * of it failed, the files written named after "wrote". Computed from the steps' states alone, never from a model's words.
 */
export function countsOf(steps: readonly StepRecord[], args: ReadonlyMap<string, Args>): string {
  const parts: string[] = [];
  for (const g of Object.keys(SUMMARY_WORDS.groups) as Array<keyof typeof SUMMARY_WORDS.groups>) {
    const mine = steps.filter((s) => s.kind in SUMMARY_GROUP && (SUMMARY_GROUP[s.kind as StepKind] ?? (failedState(s) ? "other" : null)) === g);
    if (!mine.length) continue;
    const failed = mine.filter(failedState).length;
    const paths = g === "wrote" ? [...new Set(mine.filter((s) => s.state === "done").map((s) => str(args.get(s.callId)?.path)).filter(Boolean))].slice(0, SUMMARY_FILES) : [];
    parts.push(SUMMARY_WORDS.groups[g].replace("{n}", String(mine.length)) + (failed ? SUMMARY_WORDS.failed.replace("{n}", String(failed)) : "") + (paths.length ? SUMMARY_WORDS.files.replace("{paths}", paths.join(", ")) : ""));
  }
  return capital(parts.join("; ")) || SUMMARY_WORDS.none;
}

/** The arguments of every tool call in `rows`, by call id. */
export function argsOf(rows: readonly TranscriptRow[]): Map<string, Args> {
  const args = new Map<string, Args>();
  for (const { message: m } of rows) if (m.role === "assistant" && Array.isArray(m.content)) for (const p of m.content) if (p.type === "toolCall") args.set(p.id, (p.arguments ?? {}) as Args);
  return args;
}

/**
 * The task's summary, its last step (F13, F31): code's counts of what the task did (`countsOf`) as its words, the last
 * done turn's final assistant text quoted as a block labelled the agent's own words, never paraphrased, then up to
 * `SUMMARY_FILES` file cards for the paths its `edit` and `write` steps changed, newest first, each with the first
 * `PREVIEW_LINES` lines of the change. Null while the task runs or waits, and while no turn of it is done. Never the title.
 */
export function summaryOf(rows: readonly TranscriptRow[], steps: readonly StepRecord[], doneTurnIds: readonly string[], args: ReadonlyMap<string, Args>, finished = true): StepRecord | null {
  const lastDone = doneTurnIds.at(-1);
  if (lastDone === undefined || !finished) return null;
  const said = [...rows].reverse().find((r) => r.turnId === lastDone && textOfAssistant(r.message));
  const text = said ? textOfAssistant(said.message) : "";
  const files: FileCard[] = [];
  for (const s of [...steps].reverse()) {
    if ((s.kind !== "edit" && s.kind !== "write") || s.state !== "done") continue;
    const a = args.get(s.callId) ?? {};
    const path = str(a.path);
    if (!path || files.some((f) => f.path === path) || files.length >= SUMMARY_FILES) continue;
    files.push({ path, preview: str(s.kind === "edit" ? a.newText : a.text).split("\n").slice(0, PREVIEW_LINES).join("\n") });
  }
  const reply = text ? block(SUMMARY_WORDS.reply, text) : null;
  const at = said && typeof said.message.timestamp === "number" ? said.message.timestamp : null;
  return {
    n: steps.length + 1,
    turnId: lastDone,
    callId: "",
    kind: "summary",
    tool: "",
    title: "Summary",
    state: "done",
    code: null,
    startedAt: at,
    endedAt: at,
    durationMs: null,
    detail: { prose: countsOf(steps, args), blocks: reply ? [reply] : [], result: null, lines: reply ? [] : [SUMMARY_WORDS.noReply], files, cut: reply?.cut === true },
  };
}

/** The tool calls a step list counts: every call but those that are the chat itself. */
export const stepCalls = (m: Message): number => (m.role === "assistant" && Array.isArray(m.content) ? m.content.filter((p) => p.type === "toolCall" && !NOT_STEPS.has(p.name)).length : 0);

/** A task's whole timeline: its steps, cut at `STEPS_PER_TASK` with a marker, then the summary once the task is `finished`. */
export function timelineOf(rows: readonly TranscriptRow[], journal: readonly JournalRow[], o: { chatId: string; doneTurnIds: readonly string[]; finished?: boolean }): { steps: StepRecord[]; capped: boolean } {
  const all = stepsOf(rows, journal, o);
  const args = argsOf(rows);
  const capped = all.length > STEPS_PER_TASK;
  const steps = capped ? all.slice(0, STEPS_PER_TASK - 1) : all;
  if (capped) {
    const hidden = all.length - steps.length;
    const title = hidden === 1 ? "1 more step is not shown" : `${hidden} more steps are not shown`;
    steps.push({ n: steps.length + 1, turnId: all.at(-1)?.turnId ?? "", callId: "", kind: "marker", tool: "", title, state: "done", code: null, startedAt: null, endedAt: null, durationMs: null, detail: { prose: title, blocks: [], result: null, lines: [], files: [], cut: false } });
  }
  // The summary's file cards read every change, the hidden ones included.
  const summary = summaryOf(rows, all, o.doneTurnIds, args, o.finished ?? true);
  if (summary) steps.push({ ...summary, n: steps.length + 1 });
  return { steps, capped };
}
