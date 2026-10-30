// The P5 world as the activity tasks read it (F31, `docs/plan-v2/contracts/P5-activity.md`). Every grader of a
// `.task.ts` in this folder is written over these interfaces alone. Pure: no import of the agent's sources, so a task
// module loads under plain Node (the version-hash script) and under the root tsconfig (the m0 contract check).
//
// Where a task names a Muse observable fletch does not have, the world gives the fletch one: Muse's
// `activity_monitor_threads` row is a task read from the chat's own transcript (`GET /app/activity`), its detail dialog
// is the task drawer (`GET /app/activity/<chat>/<turn>` and the page's `#task-dialog`); the Browser card is the
// `browse_open` step, whose detail is the page's own text; the unresolvable `example.invalid` is the fake browser's
// unreachable site (`BROWSE_UNREACHABLE`, fletch's code for a page no engine could fetch); the row's hover stop is the
// composer's Stop on the running turn (`STOP_TEXT.button`); the panel's usage line is the person's usage route
// (`/app/usage.json`, the rollup Settings draws).
import type { ScenarioWorld } from "../../support/scenario.ts";

/** `c1` is Sam's chat; `c2` her second chat (T-P5-01). */
export type ChatLabel = "c1" | "c2";

/** One task as `GET /app/activity` lists it. */
export interface TaskView {
  id: string;
  /** The chat's label, or its raw id when it is none of the world's. */
  chat: string;
  title: string;
  origin: string;
  status: string;
  code: string | null;
  startedAt: number;
  turnIds: string[];
  stepCount: number;
  failed: number;
  /** The status and failed count in the one table's words. */
  words: string;
  summary: string | null;
  groups: string[];
}

/** One step as the drawer route answers it. */
export interface StepView {
  n: number;
  kind: string;
  tool: string;
  title: string;
  state: string;
  code: string | null;
  callId: string;
  turnId: string;
  detail: { prose: string; blocks: Array<{ label: string; text: string }>; result: { ok: boolean; code: string | null; text: string } | null; lines: string[]; files: Array<{ path: string; preview: string }> };
}

export interface SectionView {
  n: string;
  rows: Array<{ id: string; status: string; code: string | null; steps: StepView[] | { code: string } }>;
}

/** The drawer route's answer for one task. */
export interface TaskDetail {
  ok: boolean;
  code?: string;
  task?: TaskView;
  steps: StepView[];
  subagents: SectionView[];
  usage: { ok: boolean; calls?: number; tokens?: number; costMicros?: number; models?: string[]; code?: string } | null;
}

/** One Activity row as Sam's page draws it. */
export interface RowView {
  kind: "task" | "run";
  title: string;
  desc: string;
  /** The row's glyph by name (`glyph-<name>`). */
  glyph: string;
}

/** The task drawer as Sam's page draws it, after selecting each step in turn. */
export interface DrawerView {
  pill: string;
  title: string;
  usage: string;
  /** Each drawn step's title, in drawing order. */
  steps: string[];
  /** Each step's detail pane as text, by its title, and whether every node in it is text (no markup was parsed). */
  details: Record<string, { text: string; plain: boolean }>;
  /** At phone width: whether the chosen step's detail took the list's place (one column). */
  stacked: boolean;
}

/** One entry of the thread's visible history. */
export interface ThreadEntry {
  kind: string;
  text: string;
}

export interface ModelRow {
  runId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costMicros: number;
}

/** A job run as the Activity route lists it. */
export interface RunRow {
  title: string;
  word: string;
  code: string | null;
}

export interface P5World extends ScenarioWorld {
  /** The id of the chat behind a label. */
  chatId(chat?: ChatLabel): string;
  /** `GET /app/activity` as Sam. */
  activity(): Promise<{ tasks: TaskView[]; unread: Array<{ chat: string; code: string }>; runs: RunRow[] }>;
  /** `GET /app/activity/<chat>/<turn>` as Sam, or as Pat, the second member. */
  task(chat: ChatLabel, id: string, as?: "sam" | "pat"): Promise<TaskDetail>;
  /** The Activity tab's rows in Sam's page. */
  rows(): Promise<RowView[]>;
  /** The task's drawer opened from its row in Sam's page, at desktop or phone width. */
  drawer(chat: ChatLabel, id: string, phone?: boolean): Promise<DrawerView | null>;
  /** The chat's visible history now. */
  thread(chat?: ChatLabel): ThreadEntry[];
  /**
   * The first held or launched turn as it stood while it ran: the visible history, whether the composer offered Stop,
   * the task's status and one-line summary, and whether its drawer drew a summary step.
   */
  readonly during: { thread: ThreadEntry[]; stop: boolean; status: string; summary: string | null; summaryStep: boolean } | null;
  /** The agent's visible replies, in order. */
  replies(chat?: ChatLabel): string[];
  /** Each tool result the model was shown in the chat, in order. */
  results(chat?: ChatLabel): Array<{ tool: string; text: string; isError: boolean }>;
  /** The system prompt of every chat model request. */
  prompts(): string[];
  /** The instruction lines that tell the chat model how to word a launch and a failed read (delta 4). */
  instructions(): string[];
  /** Sam's Ledger rows for model calls, each with its model and money. */
  ledgerRows(): Promise<ModelRow[]>;
  /** The usage route's totals for the day (`/app/usage.json?days=1`), the rollup Settings' Usage group draws. */
  dayUsage(): Promise<{ calls: number; tokens: number; costMicros: number }>;
  /** The money one row costs at the Ledger's price for its model, in millionths of a dollar. */
  priceOf(row: ModelRow): number;
  /** The job dialog's Run history lines for the job titled `title`. */
  runHistory(title: string): Promise<string[]>;
  /** Every job's outbox rows, by job title. */
  outbox(): Array<{ job: string; state: string }>;
  /** The notices drawn in a chat. */
  notices(chat?: ChatLabel): string[];
  /** Sam's stored file keys, memory notes left out. */
  files(): Promise<string[]>;
  /** What each memory write saved, as its tool answered (the citation of the line). */
  memoryLines(): string[];
  /** Sam's jobs by title. */
  jobTitles(): string[];
  /** The sub-agent rows of `chat`: id, status and code. */
  subagents(chat?: ChatLabel): Array<{ id: string; status: string; code: string | null }>;
  /** The journal rows of Sam's chats: kind, subject reference, outcome, and every other field's name. */
  journal(): Promise<Array<{ kind: string; outcome: string; fields: string[] }>>;
  /** Every table of every Durable Object the world built, with its row count, as `<object>/<table>`. */
  tables(): Record<string, number>;
  /** The tables as they stood when the turns began. */
  readonly before: Record<string, number>;
  /** The page's url table of the fake browser: each url it was asked for. */
  pagesRead(): string[];
}

/** Sam's replies joined. */
export const replyOf = (w: P5World, chat: ChatLabel = "c1"): string => w.replies(chat).join("\n");

/** The page the fake browser serves, with one link. */
export const PROBE = "https://example.com/p5-probe";
/** The address no engine can reach. */
export const DEAD = "https://example.invalid/p5-probe";
/** The probe page's title and its one link. */
export const PROBE_TITLE = "The p5 probe page";
export const PROBE_LINK = "https://example.com/p5-elsewhere";

/** A stable error code (`SOME_CODE`) anywhere in `s`. */
export const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
/** Words that tell the person how to recover from a failure instead of what happened (B-P5-05's deny-list). */
export const RECOVERY = /\b(retry|try again later|check your (connection|network)|clear (your )?cache|contact support)\b/i;
/** Words that say a delegation is finished (T-P5-08's deny-list). */
export const DONE_WORDS = /\b(done|finished|complete[d]?)\b/i;

/** The newest task of a chat, by label. */
export const newest = async (w: P5World, chat: ChatLabel = "c1"): Promise<TaskView | undefined> => (await w.activity()).tasks.find((t) => t.chat === chat);
/** The steps of a task with the summary left out. */
export const work = (d: TaskDetail): StepView[] => d.steps.filter((s) => s.kind !== "summary");
/** The summary step of a task, if one is drawn. */
export const summaryOf = (d: TaskDetail): StepView | undefined => d.steps.find((s) => s.kind === "summary");
