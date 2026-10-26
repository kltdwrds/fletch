// A task is a record (F12): what the agent did for one request, read from the chat's own turns, so work that wrote no
// journal row (a file written, a page read) is still listed. A turn begun by the person's own words (the `typed:` meta,
// or a mailbox start of kind `user`) or by a colleague's request (`requestText:` meta) is an anchor and a task; every
// other turn (a decision's continuation, a delegation's handoff, a reaction's answer) attaches to the latest anchor
// before it, so one request's work is one titled task however many turns it took. A turn before any anchor names no
// one's words and is not listed. The title is the anchor's own words under F8's cap; the steps themselves are F13.
import type { Message } from "@earendil-works/pi-ai";
import { type TranscriptRow, TYPED_WITHOUT_ID } from "./history.ts";
import type { Mailbox } from "./mailbox.ts";
import { promptTitle } from "./prompt-title.ts";
import type { ChatStore, TurnRow } from "./store.ts";

export type TaskStatus = "running" | "waiting" | "done" | "failed" | "stopped";

export interface TaskRecord {
  /** The anchor turn's id: the task's address within its chat. */
  id: string;
  chatId: string;
  title: string;
  origin: "typed" | "request";
  status: TaskStatus;
  /** The last turn's failure or stop code; null while it runs or when it ended well. */
  code: string | null;
  startedAt: number;
  /** Null while a turn runs or a card waits on the person. */
  endedAt: number | null;
  turnIds: string[];
  /** The model's tool calls across the task's turns, compacted ones included. */
  stepCount: number;
  /** Sub-agent sections (F14). */
  groups: never[];
  /** The task's summary (F16). */
  summary: null;
  /** Whether the steps were cut (F13). */
  capped: false;
}

/** Tasks one chat answers, its newest; `/app/activity` merges every chat's. */
export const TASKS_PER_CHAT = 50;

/** The reads a task list needs: the chat's store, its mailbox, and how many cards a turn left open. */
export interface TaskReads {
  owner: string | null;
  chatId: string;
  store: ChatStore;
  mailbox: Pick<Mailbox, "startedBy">;
  cards: { openFor(turnId: string): number };
}

export type TasksAnswer = { ok: true; tasks: TaskRecord[] } | { ok: false; code: "CHAT_NOT_OWNER" };
export type TaskAnswer = { ok: true; task: TaskRecord } | { ok: false; code: "CHAT_NOT_OWNER" | "TASK_NOT_FOUND" };

/** The text of a message's content: a string, or its text parts joined. */
function textOf(message: Message): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join(" ");
}

const toolCalls = (rows: TranscriptRow[]) =>
  rows.reduce((n, r) => n + (r.message.role === "assistant" && Array.isArray(r.message.content) ? (r.message.content as Array<{ type?: string }>).filter((p) => p.type === "toolCall").length : 0), 0);

/** The words that began an anchor turn, as the person wrote them (a reply's quote is not theirs, M29.4), or its request's. */
function anchorWords(r: TaskReads, anchor: TurnRow, rows: TranscriptRow[]): { origin: TaskRecord["origin"]; text: string } {
  const request = r.store.meta(`requestText:${anchor.id}`);
  if (request !== undefined) return { origin: "request", text: request };
  const first = rows.find((x) => x.turnId === anchor.id && x.message.role === "user");
  const id = r.store.meta(`typed:${anchor.id}`);
  return { origin: "typed", text: r.store.actions.shown(id === undefined || id === TYPED_WITHOUT_ID ? undefined : id, first ? textOf(first.message) : "") };
}

const isAnchor = (r: TaskReads, t: TurnRow) => r.store.meta(`typed:${t.id}`) !== undefined || r.store.meta(`requestText:${t.id}`) !== undefined || r.mailbox.startedBy(t.id) === "user";

/** The chat's turns grouped into tasks by the anchor rule, oldest first. */
function grouped(r: TaskReads): TurnRow[][] {
  const out: TurnRow[][] = [];
  for (const t of r.store.turns()) {
    if (isAnchor(r, t)) out.push([t]);
    else out.at(-1)?.push(t);
  }
  return out;
}

function record(r: TaskReads, turns: TurnRow[]): TaskRecord {
  const anchor = turns[0] as TurnRow;
  const last = turns.at(-1) as TurnRow;
  const turnIds = turns.map((t) => t.id);
  const rows = r.store.rowsOfTurns(turnIds);
  const words = anchorWords(r, anchor, rows);
  const running = turns.some((t) => t.status === "running");
  const waiting = !running && turns.some((t) => r.cards.openFor(t.id) > 0);
  const status: TaskStatus = running ? "running" : waiting ? "waiting" : last.status;
  const open = status === "running" || status === "waiting";
  return {
    id: anchor.id,
    chatId: r.chatId,
    title: promptTitle(words.text),
    origin: words.origin,
    status,
    code: open ? null : last.code,
    startedAt: anchor.started_at,
    endedAt: open ? null : last.ended_at,
    turnIds,
    stepCount: toolCalls(rows),
    groups: [],
    summary: null,
    capped: false,
  };
}

/** Every task of the chat, oldest first. */
export function tasksOf(r: TaskReads): TaskRecord[] {
  return grouped(r).map((turns) => record(r, turns));
}

/** The task whose anchor turn is `id`, or undefined. */
export function taskOf(r: TaskReads, id: string): TaskRecord | undefined {
  const turns = grouped(r).find((g) => g[0]?.id === id);
  return turns ? record(r, turns) : undefined;
}

/** The chat's newest tasks, newest first, for its owner alone; anyone else is refused with a code (as `lastAt`). */
export function tasksFor(r: TaskReads, person: string): TasksAnswer {
  if (r.owner !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
  return { ok: true, tasks: tasksOf(r).slice(-TASKS_PER_CHAT).reverse() };
}

/** One task by its anchor turn, for the chat's owner alone. */
export function taskFor(r: TaskReads, person: string, id: string): TaskAnswer {
  if (r.owner !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
  const task = taskOf(r, id);
  return task ? { ok: true, task } : { ok: false, code: "TASK_NOT_FOUND" };
}
