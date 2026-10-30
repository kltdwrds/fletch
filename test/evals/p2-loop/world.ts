// The P2 world as the loop tasks read it (F23, `docs/plan-v2/contracts/P2-loop.md`). Every grader of a `.task.ts`
// in this folder is written over these interfaces alone. Pure: no import of the agent's sources, so a task module
// loads under plain Node (the version-hash script) and under the root tsconfig (the m0 contract check).
//
// Where a task names a Muse observable fletch does not have, the world gives the fletch one: Muse's journal of
// context items is fletch's stored transcript (`rows`: one row per pi message, a tool's result fenced
// `tool:<name>` with its `isError` flag), Muse's `success: false` is `isError`.
import type { ScenarioWorld } from "../../support/scenario.ts";

/** `c1` is Sam's main chat, `c2` a second one a setup opens. */
export type ChatLabel = "c1" | "c2";

/** One stored transcript row: its order, its role, the tool a result answers and whether it failed, its text and the tools an assistant row called. */
export interface Row {
  seq: number;
  role: string;
  tool?: string;
  isError?: boolean;
  text: string;
  calls: string[];
}

/** A history entry as the page draws it, the fields the tasks read. */
export interface Entry {
  kind: string;
  mid?: string;
  text?: string;
  reactions?: Array<{ by: "you" | "agent"; emoji: string }>;
}

export interface TurnInfo {
  status: string;
  code: string | null;
  startedBy: string | undefined;
}

export interface MailInfo {
  ordinal: number;
  kind: string;
  state: string;
  delivery: string | null;
}

export type Frame = { type: string } & Record<string, unknown>;

/** One request the model saw: each message's role, its text and the tools it called, and the tool schemas offered by name. */
export interface ModelRequest {
  messages: Array<{ role: string; text: string; tools: string[] }>;
  schemas: string[];
}

export interface P2World extends ScenarioWorld {
  requests(): ModelRequest[];
  /** The index in `requests()` of each prompt turn's first request, in the order the turns were played. */
  turnStarts(): number[];
  rows(chat?: ChatLabel): Row[];
  entries(chat?: ChatLabel): Entry[];
  /** Every frame the owner's socket on the chat received since it was opened. */
  frames(chat?: ChatLabel): Frame[];
  turns(chat?: ChatLabel): TurnInfo[];
  mailbox(chat?: ChatLabel): MailInfo[];
  /** The deferred namespaces the chat holds loaded. */
  loaded(chat?: ChatLabel): string[];
  /** Sam's home file paths. */
  files(): string[];
  /** Each `steps_lookup` run, in order: its step and how many frames c1's socket had received when it ran. */
  marks(): Array<{ n: number; frames: number }>;
  /** Calls of the fixture `wipe`. */
  wiped(): number;
  /** The file cards the shipped page draws from the chat's stored history (F24): each card's name and the path it opens. */
  fileCards(chat?: ChatLabel): Promise<Array<{ name: string; path: string }>>;
}

/** The stored rows answering `tool`, in order. */
export const resultsOf = (w: P2World, tool: string, chat?: ChatLabel): Row[] => w.rows(chat).filter((r) => r.role === "toolResult" && r.tool === tool);

/** The agent's visible entries' text, joined. */
export const replyOf = (w: P2World, chat?: ChatLabel): string =>
  w
    .entries(chat)
    .filter((e) => e.kind === "agent")
    .map((e) => e.text ?? "")
    .join("\n");

/** The system message right before the last user message of request `i`: that request's envelope. */
export function envelopeOf(r: ModelRequest | undefined): string {
  const msgs = r?.messages ?? [];
  const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
  const env = msgs[lastUser - 1];
  return env?.role === "system" ? env.text : "";
}

/** A markdown link `[text](target)` in `s`, each target. */
export const linkTargets = (s: string): string[] => [...s.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map((m) => m[1] as string);

/** A stable error code (`SOME_CODE`) anywhere in `s`. */
export const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
