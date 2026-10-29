// The P1 world as the reactions tasks read it (F20, `docs/plan-v2/contracts/P1-reactions.md`). Every grader of a
// `.task.ts` in this folder is written over this interface alone, so the tier-1 harness (`harness.ts`, the authority
// world with the scripted fake) and the tier-2 runner (F19, a preview slot with the real model) grade the same code.
// Pure: no import of the agent's sources, so a task module loads under plain Node (the version-hash script) and under
// the root tsconfig (the m0 contract check).
import type { ScenarioWorld } from "../../support/scenario.ts";

/** The reactor the agent's own rows are stored under: `AGENT_REACTOR` in `packages/agent/src/chat/message-actions.ts` (the harness checks). */
export const AGENT = "agent";

/** The chats a task names: `c1` is Sam's main chat, `c2` a second one a setup opens. */
export type ChatLabel = "c1" | "c2";

/** One reaction row: the agent's under `AGENT`, the person's under their email. */
export interface ReactionRow {
  mid: string;
  by: string;
  emoji: string;
}

/** A history entry as the page draws it, the fields the tasks read. */
export interface Entry {
  kind: string;
  mid?: string;
  text?: string;
  reactions?: Array<{ by: "you" | "agent"; emoji: string }>;
}

/** A turn and the mailbox kind that started it (`user`, `reaction`, `internal_handoff`). */
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

/** One request the model saw, flattened: each message's role, its text and the names of the tools it called. */
export interface ModelRequest {
  messages: Array<{ role: string; text: string; tools: string[] }>;
}

/**
 * What a task may ask of the world after its turns. The snapshot (`ScenarioWorld`) holds the append-only rows a
 * turn adds, keyed `message:<chat>:<n>:<kind>` (the n-th visible message and its side; a mid counts tool rows too, so it differs by tier), `turn:<chat>:<ordinal>` and `mail:<chat>:<ordinal>:<kind>`, plus the R2
 * keys; reaction rows are graded, never snapshotted, because the kit's collateral check reads a removed key as
 * collateral and T-P1-07 removes one.
 */
export interface P1World extends ScenarioWorld {
  reactions(chat?: ChatLabel): ReactionRow[];
  /** The history as the page would draw it now. */
  entries(chat?: ChatLabel): Entry[];
  /** The history after the chat object is evicted and rebuilt over its storage: what a reload draws. */
  reload(chat?: ChatLabel): Entry[];
  turns(chat?: ChatLabel): TurnInfo[];
  mailbox(chat?: ChatLabel): MailInfo[];
  /** Every frame the owner's socket on the chat received since it was opened. */
  frames(chat?: ChatLabel): Frame[];
  cards(chat?: ChatLabel): Array<{ state: string }>;
  /** The stored transcript's message bodies, in order. */
  transcript(chat?: ChatLabel): string[];
  requests(): ModelRequest[];
  /** The connector calls the world ran, by name. */
  performed(): string[];
}

/** The last user message of the last model request: the input a reaction-started turn read. */
export const lastInput = (w: P1World): string => w.requests().at(-1)?.messages.filter((m) => m.role === "user").at(-1)?.text ?? "";

/** The system message right before the last user message of the last request: the turn's envelope. */
export function lastEnvelope(w: P1World): string {
  const msgs = w.requests().at(-1)?.messages ?? [];
  const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
  const env = msgs[lastUser - 1];
  return env?.role === "system" ? env.text : "";
}
