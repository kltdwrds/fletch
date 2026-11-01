// A task is a record (F12): the work of one request, read from the chat's own turns and transcript, never from the
// journal, so a turn whose work gated nothing still lists. A turn begun by the person's own words (the `typed:` meta,
// or a mailbox start of kind `user`) or by a colleague's request (the `requestText:` meta) anchors a task; every other
// turn (the continuation after a decision, a delegation's handoff, a reaction's answer) continues the latest anchor
// before it, because a request's work outruns one turn's step cap and a handoff is its own turn. A chat's first turn
// anchors whatever began it, since it has nothing to continue. The title is the anchor's own words under F8's cap.
// The join keys are the turn ids (the journal's `runId`) and the delegation groups the task's turns launched or
// received. Its steps (F13) are the turns' tool calls, read by `activity-steps.ts` with the journal's outcomes.
import type { Message } from "@earendil-works/pi-ai";
import type { JournalRow } from "../grants/journal.ts";
import { statusWords } from "../obs/activity-words.ts";
import { argsOf, countsOf, type StepRecord, STEPS_PER_TASK, stepCalls, stepsOf, timelineOf } from "./activity-steps.ts";
import { type SubAgentRows, type SubAgentSection, subagentSections } from "./activity-subagents.ts";
import { type TranscriptRow, TYPED_WITHOUT_ID } from "./history.ts";
import type { Mailbox } from "./mailbox.ts";
import { groupIdOf } from "./outbox.ts";
import { promptTitle } from "./prompt-title.ts";
import type { ChatStore, TurnRow } from "./store.ts";
import { stopKey } from "./stop.ts";
import type { Effect } from "./tools.ts";

export type TaskStatus = "running" | "waiting" | "done" | "failed" | "stopped";

export interface TaskRecord {
  /** The anchor turn's id: with the chat's id, the task's address. */
  id: string;
  chatId: string;
  title: string;
  origin: "typed" | "request";
  /** The latest turn's: `waiting` while it paused on the person's decision. */
  status: TaskStatus;
  /** The latest turn's code when it did not simply finish (`AWAITING_DECISION`, a failure's code), else null. */
  code: string | null;
  startedAt: number;
  /** When the latest turn ended, once the task is no longer running or waiting; null until then. */
  endedAt: number | null;
  turnIds: string[];
  /** The steps across the task's turns, compacted ones included: every tool call but `send_to_user` and `react` (F13). */
  stepCount: number;
  /** The delegation groups its turns launched or received (M7.2): the sub-agent sections' join key (F14). */
  groups: string[];
  /** Its steps that failed or were refused (F31, P5 delta 2): said beside the status, never failing the task by itself. */
  failed: number;
  /** The status and the failed count in `ACTIVITY_TEXT`'s words (`statusWords`): the row and the drawer's pill say this. */
  words: string;
  /** Code's one line (B-P5-01): the latest step's title while it runs or waits, the summary step's counts once it ended. */
  summary: string | null;
  /** Whether its steps are cut at `STEPS_PER_TASK` (F13): the timeline then says how many are not shown. */
  capped: boolean;
}

/** The newest tasks one chat answers with: the Activity tab merges them across the person's chats. */
export const TASKS_PER_CHAT = 50;

type Group = { origin: TaskRecord["origin"]; request?: string; typedId?: string; turns: TurnRow[] };

/** The chat's turns as tasks, oldest first: each anchor with the turns that continue it. */
function groups(store: ChatStore, mailbox: Mailbox): Group[] {
  const typed = store.metaPrefixed("typed:");
  const requested = store.metaPrefixed("requestText:");
  const started = new Map(mailbox.taken().flatMap((r) => (r.delivery === "start" && r.turnId ? [[r.turnId, r.kind] as const] : [])));
  const out: Group[] = [];
  for (const turn of store.turns()) {
    const request = requested.get(turn.id);
    const anchor = request !== undefined || typed.has(turn.id) || started.get(turn.id) === "user";
    const last = out.at(-1);
    if (last && !anchor) last.turns.push(turn);
    else out.push({ origin: request !== undefined ? "request" : "typed", ...(request !== undefined ? { request } : {}), ...(typed.has(turn.id) && typed.get(turn.id) !== TYPED_WITHOUT_ID ? { typedId: typed.get(turn.id) } : {}), turns: [turn] });
  }
  return out;
}

const textOf = (m: Message): string => {
  const c = (m as { content?: unknown }).content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).join(" ") : "";
};
function statusOf(t: TurnRow): TaskStatus {
  if (t.status === "done" && t.code === "AWAITING_DECISION") return "waiting";
  return t.status;
}

function record(store: ChatStore, mailbox: Mailbox, chatId: string, g: Group, rows: TranscriptRow[]): TaskRecord {
  const anchor = g.turns[0] as TurnRow;
  const last = g.turns.at(-1) as TurnRow;
  const ids = new Set(g.turns.map((t) => t.id));
  const own = rows.filter((r) => ids.has(r.turnId));
  const first = own.find((r) => r.turnId === anchor.id && r.message.role === "user");
  // A reply's quote is not the person's words (M29.4): the title is what they typed after it.
  const words = g.request ?? (first ? store.actions.shown(g.typedId, textOf(first.message)) : "");
  const stepCount = own.reduce((n, r) => n + stepCalls(r.message), 0);
  const delegations = g.turns.flatMap((t) => store.committed(t.id).flatMap((o) => ((e: Effect) => (e.kind === "delegate" ? [{ grp: groupIdOf(t.id, e.id), callId: e.id }] : []))(JSON.parse(o.payload) as Effect)));
  const launched = delegations.map((d) => d.grp);
  const handed = mailbox.taken().flatMap((r) => (r.kind === "internal_handoff" && r.turnId && r.scope.startsWith("delegation:") ? [{ grp: r.scope.slice("delegation:".length), turnId: r.turnId }] : []));
  const received = handed.filter((h) => ids.has(h.turnId)).map((h) => h.grp);
  // Work it handed to sub-agents is still its work (B-P5-08): a task whose turn finished while a delegation it launched
  // has not handed off is running, so it never reads done before the result; a delegation the host refused never starts.
  // A handoff a later task's turn took settles it too (Q28): a steer that closed its child wakes a turn of the steer's.
  const refused = new Set(store.rowsOfTurns(delegations.map((d) => `subagents:${d.callId}`)).map((r) => r.turnId.slice("subagents:".length)));
  const settled = new Set(handed.map((h) => h.grp));
  const out = delegations.some((d) => !settled.has(d.grp) && !refused.has(d.callId));
  // Stopped by the person once its turn ended (F31): the delegation still out was closed and the task says Stopped.
  const status = statusOf(last) === "done" && out ? (store.meta(stopKey(last.id)) ? "stopped" : "running") : statusOf(last);
  const steps = stepsOf(own, [], { chatId });
  const failed = steps.filter((s) => s.state === "failed" || s.state === "refused").length;
  const code = status === "done" || status === "running" ? null : last.code;
  const summary = status === "running" || status === "waiting" ? (steps.at(-1)?.title ?? null) : steps.length ? countsOf(steps, argsOf(own)) : null;
  return {
    id: anchor.id,
    chatId,
    title: promptTitle(words),
    origin: g.origin,
    status,
    code,
    startedAt: anchor.started_at,
    endedAt: status === "running" || status === "waiting" ? null : last.ended_at,
    turnIds: g.turns.map((t) => t.id),
    stepCount,
    groups: [...new Set([...launched, ...received])],
    failed,
    words: statusWords({ status, code, failed }),
    summary,
    capped: stepCount > STEPS_PER_TASK,
  };
}

/** The chat's tasks, newest first, at most `limit`. */
export function tasksOf(store: ChatStore, mailbox: Mailbox, chatId: string, limit = TASKS_PER_CHAT): TaskRecord[] {
  const picked = groups(store, mailbox).reverse().slice(0, limit);
  const rows = store.rowsOfTurns(picked.flatMap((g) => g.turns.map((t) => t.id)));
  return picked.map((g) => record(store, mailbox, chatId, g, rows));
}

/** One task by its anchor turn's id; undefined when no task begins there. */
export function taskOf(store: ChatStore, mailbox: Mailbox, chatId: string, id: string): TaskRecord | undefined {
  const g = groups(store, mailbox).find((x) => x.turns[0]?.id === id);
  return g ? record(store, mailbox, chatId, g, store.rowsOfTurns(g.turns.map((t) => t.id))) : undefined;
}

/**
 * A task's timeline (F13): its turns' tool calls in seq order, compacted rows included, joined to the journal rows of
 * the task's own turns, cut at `STEPS_PER_TASK`, then its summary from the last turn that finished.
 */
export function taskSteps(store: ChatStore, task: TaskRecord, journal: readonly JournalRow[]): StepRecord[] {
  const turnIds = new Set(task.turnIds);
  const done = task.turnIds.filter((id) => ((t) => t?.status === "done" && t.code !== "AWAITING_DECISION")(store.turn(id)));
  return timelineOf(store.rowsOfTurns(task.turnIds), journal.filter((r) => turnIds.has(r.runId)), { chatId: task.chatId, doneTurnIds: done, finished: task.status !== "running" && task.status !== "waiting" }).steps;
}

/**
 * A task's model calls, tokens and money (F31, P5 delta 7): the Ledger's rows of the task's own turns, by run id, and
 * of the sub-agents its delegations started and their verifier calls (`subagent:<id>`, `verifier:<id>`, F33), so the
 * head counts a child's calls in the task's.
 */
export type TaskUsage = { ok: true; calls: number; tokens: number; costMicros: number; models: string[] } | { ok: false; code: "USAGE_UNREAD" };

/** Sums the Ledger rows keyed by the task's turn ids; a Ledger that cannot be read is said by code, never as zero. */
export async function taskUsage(rows: () => Promise<Array<{ runId: string; model: string; inputTokens: number; outputTokens: number; costMicros?: number }>>, task: TaskRecord, children: readonly string[] = []): Promise<TaskUsage> {
  const turns = new Set([...task.turnIds, ...children.flatMap((id) => [`subagent:${id}`, `verifier:${id}`])]);
  let all: Awaited<ReturnType<typeof rows>>;
  try {
    all = await rows();
  } catch {
    return { ok: false, code: "USAGE_UNREAD" };
  }
  const mine = all.filter((r) => turns.has(r.runId));
  return { ok: true, calls: mine.length, tokens: mine.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0), costMicros: mine.reduce((n, r) => n + (r.costMicros ?? 0), 0), models: [...new Set(mine.map((r) => r.model))] };
}

/** The ids of the sub-agents a task's delegations started, from the chat's stored rows (`<grp>.<n>`, and below). */
export const childIds = (rows: ReadonlyArray<{ id: string }>, task: Pick<TaskRecord, "groups">): string[] => rows.map((r) => r.id).filter((id) => task.groups.some((g) => id.startsWith(`${g}.`)));

type Owned = {
  owner(): string | null;
  tasksFor(person: string): TaskRecord[] | null;
  taskFor(person: string, id: string): TaskRecord | null;
  stepsFor(person: string, task: TaskRecord): Promise<StepRecord[] | null>;
  usageFor(person: string, task: TaskRecord): Promise<TaskUsage>;
};
export type TasksResult = { ok: true; tasks: TaskRecord[] } | { ok: false; code: "CHAT_NOT_OWNER" };
export type TaskResult = { ok: true; task: TaskRecord; steps: StepRecord[]; subagents: SubAgentSection[]; usage: TaskUsage } | { ok: false; code: "CHAT_NOT_OWNER" | "TASK_NOT_FOUND" };

/** A chat's tasks for its owner, as the `Chat` object answers them; anyone else is refused by code, never answered empty. */
export function chatTasks(chat: Owned, person: string): TasksResult {
  const tasks = chat.tasksFor(person);
  return tasks ? { ok: true, tasks } : { ok: false, code: "CHAT_NOT_OWNER" };
}

/**
 * One task, its steps, its sub-agent sections (F14) and its usage (F31) for the chat's owner, the sections read from the chat's own
 * `subagents` rows and, for the owner's rows, their facets' transcripts (D-0011), only after the owner check; anyone else is `CHAT_NOT_OWNER`, a task that does not begin there
 * `TASK_NOT_FOUND`.
 */
export async function chatTask(chat: Owned, person: string, id: string, subagents: SubAgentRows): Promise<TaskResult> {
  if (chat.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
  const task = chat.taskFor(person, id);
  if (!task) return { ok: false, code: "TASK_NOT_FOUND" };
  const steps = await chat.stepsFor(person, task);
  return steps ? { ok: true, task, ...(await subagentSections(subagents, person, task, steps)), usage: await chat.usageFor(person, task) } : { ok: false, code: "CHAT_NOT_OWNER" };
}

/**
 * What stopping a task means (F31): a task that is not the owner's is `CHAT_NOT_OWNER`, one that does not begin there
 * `TASK_NOT_FOUND`, one no longer running `TASK_NOT_RUNNING`; a task whose last turn is the one running stops that turn
 * as the composer's Stop does; a task whose turn ended with a delegation still out halts that turn's delegations.
 */
export function taskStop(task: TaskRecord | null, owned: boolean, running: string | undefined): { halt: string } | { turn: string } | { ok: false; code: "CHAT_NOT_OWNER" | "TASK_NOT_FOUND" | "TASK_NOT_RUNNING" } {
  if (!task) return { ok: false, code: owned ? "TASK_NOT_FOUND" : "CHAT_NOT_OWNER" };
  const last = task.turnIds.at(-1) as string;
  if (task.status !== "running") return { ok: false, code: "TASK_NOT_RUNNING" };
  return running === last ? { turn: last } : { halt: last };
}
