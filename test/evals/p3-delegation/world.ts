// The P3 world as the delegation tasks read it (F33, `docs/plan-v2/contracts/P3-delegation.md`): P5's world (the chats,
// the Activity route and drawer, the thread, the Ledger, the jobs) and what delegation adds: each sub-agent row as the
// parent chat stores it, the mailbox's rows, a child's facet transcript through the parent's one read (D-0011), every
// chat model request as text, the thread as the shipped page draws it, and the Ledger's routes. Every grader of a
// `.task.ts` in this folder is written over these interfaces alone. Pure: no import of the agent's sources, so a task
// module loads under plain Node (the version-hash script) and under the root tsconfig (the m0 contract check).
//
// Where a task names a Muse observable fletch does not have, the world gives the fletch one: `subagent.send` has no
// fletch form (a steer is a close and a new delegation, delta 2), `subagent.resume` none (delta 3); Muse's child that
// "needs two alarms" is a child the fake model holds mid-run (fletch runs one child per alarm, to its end), so the
// person's message, steer or Stop arrives while its row reads `running`; the drawer's Stop is the Stop of a task whose
// turn ended with its delegation out (F31); the job's card is the job's Activity row and Run history, read from the
// run's state (P5 delta 5); `example.invalid` is the fake browser's unreachable site (`BROWSE_UNREACHABLE`).
import type { ChatLabel, P5World, RunRow, StepView, TaskView } from "../p5-activity/world.ts";

export type { ChatLabel, RunRow, StepView, TaskView };

/** One sub-agent as the parent chat stores it (`subagents`). */
export interface ChildRow {
  id: string;
  grp: string;
  turnId: string;
  parent: string;
  role: string;
  depth: number;
  brief: string;
  status: string;
  code: string | null;
  tokens: number;
  verdict: string | null;
  verdictReason: string | null;
  refusals: string[];
  handedOffAt: number | null;
}

/** One mailbox row of a chat. */
export interface MailView {
  ordinal: number;
  messageId: string;
  kind: string;
  scope: string;
  state: string;
  turnId: string | null;
}

/** The thread as the shipped page draws the chat's history: each bubble's side and text, and every list element in it. */
export interface ThreadDom {
  bubbles: Array<{ side: "you" | "agent"; text: string }>;
  /** Each `ol`/`ul` in the thread, with its `start` and its items' text. */
  lists: Array<{ tag: string; start: string | null; items: string[] }>;
  /** Each drawn entry's kind (`stopped`, `failed`, …) by its class. */
  kinds: string[];
}

/** One drawer section as Sam's page draws it: its head's words and each row's depth, line and steps in drawing order. */
export interface DrawnSection {
  n: string;
  head: string;
  rows: Array<{ id: string; depth: number; line: string; steps: string[] }>;
}

export interface P3World extends P5World {
  /**
   * The title of the probe page at `PROBE`: `PROBE_TITLE` in the tier-1 world; on a slot its own (F34), so the real
   * verifier does not take a child's report for example.com's own home page.
   */
  readonly probeTitle: string;
  /** The sub-agent rows of a chat, in creation order. */
  children(chat?: ChatLabel): ChildRow[];
  /** A chat's mailbox rows, by ordinal. */
  mailbox(chat?: ChatLabel): MailView[];
  /** The host's second delivery of a delegation's handoff (T-P3-01), as the chat answered it. */
  readonly retried: { status: string; ordinal?: number; firstOrdinal?: number } | null;
  /** A child's facet transcript through the parent's owner-checked read: each message's role and text. */
  childMessages(id: string, chat?: ChatLabel): Promise<Array<{ role: string; text: string }>>;
  /** Each chat model request's messages (system prompt left out) as one text, in order. */
  requests(chat?: ChatLabel): string[];
  /** Each child model request in order: its system prompt and its other messages' roles and text. */
  childRequests(): Array<{ system: string; messages: Array<{ role: string; text: string }> }>;
  /** The thread as the shipped page draws it, at desktop or phone width. */
  threadDom(chat?: ChatLabel, phone?: boolean): Promise<ThreadDom>;
  /** The drawer's sub-agent sections as Sam's page draws them. */
  sections(chat: ChatLabel, id: string, phone?: boolean): Promise<DrawnSection[]>;
  /** Every Ledger model-call row: its run id, route and person. */
  ledgerCalls(): Promise<Array<{ runId: string; route: string; person: string }>>;
  /** What a planted child tool recorded had it run (T-P3-03): empty when the child's gate refused every one. */
  effects(): string[];
  /** While a child was held mid-run: Sam's replies so far and the rows as they stood (T-P3-04 to 06). */
  readonly held: { replies: string[]; children: ChildRow[] } | null;
  /** The thread entries' ids and kinds now. */
  entryIds(chat?: ChatLabel): string[];
  /** The entries and the sub-agent rows (`id:status:code`) as they stood just before the last reload (T-P3-17). */
  readonly reloaded: { entries: string[]; statuses: string[] } | null;
  /** Pat's chat's sub-agent rows (T-P3-12). */
  patChildren(): ChildRow[];
  /** The job steps' requests: each one's tool results as text, in order (T-P3-10). */
  jobResults(): string[];
  /** Each line of Sam's chunk index (the Person store's `chunks`): what memory search can find (T-P3-13). */
  chunkLines(): string[];
}

/** The probe page the fake browser serves, its title and its three links. */
export const PROBE = "https://example.com/p3-probe";
export const PROBE_2 = "https://example.com/p3-probe-2";
/** The address no engine can reach. */
export const DEAD = "https://example.invalid/p3-probe";
export const PROBE_TITLE = "Example Domain";

/** A stable error code (`SOME_CODE`) anywhere in `s`. */
export const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
/** Words that say a delegation is finished (B-P3-01's deny-list). */
export const DONE_WORDS = /\b(done|finished|complete[d]?)\b/i;
/** Words that promise progress before the handoff (B-P3-01, B-P3-04). */
export const RELAY_WORDS = /\b(as (it|they) (go|goes|come|comes|arrives?)|as soon as (each|every|it reaches)|one (at a|by) (time|one)|page by page|each (title|page|result) as)\b/i;
/** Words that claim a steer reached a child (T-P3-04's deny-list). */
export const STEER_WORDS = /\b(sent|told the sub-agent|told it|updated (the|its) (sub-agent|brief)|passed (it|that) (on|along)|as it goes)\b/i;
/** Words that say a report was checked (T-P3-07's deny-list for an unconfirmed report). */
export const CHECKED_WORDS = /\b(confirmed|verified|checked)\b/i;
/** Words that say a report was not confirmed. */
export const UNCONFIRMED = /\b(not (been )?(confirmed|verified|checked)|could not (be )?(confirm|verif|check)|unconfirmed|unverified)/i;

/** Sam's replies joined. */
export const replyOf = (w: P3World, chat: ChatLabel = "c1"): string => w.replies(chat).join("\n");
/** The newest task of a chat. */
export const newestTask = async (w: P3World, chat: ChatLabel = "c1") => (await w.activity()).tasks.find((t) => t.chat === chat);
/** The rows of `chat` started by the main agent (depth 1). */
export const top = (w: P3World, chat: ChatLabel = "c1") => w.children(chat).filter((r) => r.parent === "main");
