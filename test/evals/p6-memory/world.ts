// The P6 world as the memory tasks read it (F27, `docs/plan-v2/contracts/P6-memory.md`). Every grader of a `.task.ts`
// in this folder is written over these interfaces alone. Pure: no import of the agent's sources, so a task module loads
// under plain Node (the version-hash script) and under the root tsconfig (the m0 contract check).
//
// Where a task names a Muse observable fletch does not have, the world gives the fletch one: Muse's `MEMORY.md#L28`
// is fletch's daily line `memory/<date>.md#L<n>`; Muse's `memory.claims` and `memory.entries` are the Person's claims
// and its chunk index; Muse's `forget.plan` sub-agent and chat confirmation are the Person's `forgetPlan` and
// `forgetConfirm`, which the chat's memory seam does not reach (the approval-finality row); Muse's background note
// writer is fletch's render timer over the chat's own lines.
import type { ScenarioWorld } from "../../support/scenario.ts";

/** `c1` is Sam's main chat, `c2` a second one a task opens. */
export type ChatLabel = "c1" | "c2";

/** One daily line as the Person stores it. */
export interface Line {
  citation: string;
  text: string;
  /** Where it was written, with the chat's id written as its label: `chat:c1`. */
  source: string;
  writer: string;
}

/** One claim with its source line's citation. */
export interface Claim {
  id: string;
  kind: string;
  status: string;
  quote: string;
  citation: string;
  supersedes: string | null;
}

/** One row of the chunk index: the line it indexes and its text. */
export interface Chunk {
  citation: string;
  text: string;
}

/** One stored transcript row: its role, the tool a result answers and whether it failed, its text and the tools an assistant row called. */
export interface Row {
  seq: number;
  role: string;
  tool?: string;
  isError?: boolean;
  text: string;
  calls: string[];
}

export interface Entry {
  kind: string;
  text?: string;
}

/** A search over Sam's memory as `memory_search` runs it: every leg the deploy has. */
export interface Searched {
  hits: Array<{ citation: string; text: string; marker: string | null; claims: Array<{ id: string; status: string }>; match: string | null }>;
  /** The code the semantic leg failed with, or null when it answered (or the deploy has none). */
  degraded: string | null;
}

/** The forget plan as the Person answered it, or its refusal. */
export type Plan =
  | { ok: true; planId: string; claims: Array<{ id: string; citation: string }>; lines: string[]; rederives: Array<{ kind: string; id: string }>; unchecked: string[]; remaining: number }
  | { ok: false; code: string };

/** One attempt to confirm the plan: by whom, and what the Person answered. */
export interface Confirmed {
  as: "sam" | "pat" | "agent";
  ok: boolean;
  code: string | null;
  claims?: number;
  chunks?: number;
  /** How many of the plan's claims still existed after the attempt. */
  remaining: number;
}

/** What one sub-agent run was offered, what each of its tool calls returned, and how often the memory store answered it. */
export interface SubAgentRun {
  offered: string[];
  results: Array<{ tool: string; text: string; code: string | null }>;
  memoryCalls: number;
  handoff: string;
}

export interface P6World extends ScenarioWorld {
  lines(): Line[];
  claims(): Claim[];
  chunks(): Chunk[];
  /** A home file as the bucket holds it, or null. */
  file(path: string): Promise<string | null>;
  /** Every key in Sam's home tree, as a home path. */
  paths(): string[];
  search(queries: string[]): Promise<Searched>;
  /** `memory_get` as Sam's chat runs it: the numbered lines, or the refusal's code. */
  get(path: string, from?: number, limit?: number): Promise<{ ok: true; lines: Array<{ n: number; text: string }> } | { ok: false; code: string }>;
  explain(claimId: string): Promise<{ ok: true; supersedes: string[]; supersededBy: string[]; sourceText: string | null } | { ok: false; code: string }>;
  rows(chat?: ChatLabel): Row[];
  entries(chat?: ChatLabel): Entry[];
  /** Every message the model was sent during the turns in `chat`, as text. */
  sentIn(chat: ChatLabel): string[];
  /** The system messages of the last turn's first request in `chat`: what its context hoisted. */
  context(chat: ChatLabel): string;
  /** Each memory write's result as the tool returned it, in order, with its code when refused. */
  writes(): Array<{ ok: boolean; code: string | null; text: string }>;
  plan(): Plan | null;
  confirms(): Confirmed[];
  /** The producers the plan reads, as they stand now. */
  producers(): { jobs: Array<{ id: string; text: string }>; skills: Array<{ name: string; text: string }> };
  subagent(): SubAgentRun | null;
  /** Each render of a daily note that changed the bucket, by path, in order. */
  renders(): string[];
  /** After each turn, in order: the turn (`prompt:c1`, `event:upkeep`) and Sam's home paths then. */
  after(): Array<{ turn: string; paths: string[] }>;
  /** The calls the chat's memory seam offers its model's tools, as production wires it. */
  chatSeam(): string[];
}

/** The agent's visible replies in `chat`, joined. */
export const replyOf = (w: P6World, chat: ChatLabel = "c1"): string =>
  w
    .entries(chat)
    .filter((e) => e.kind === "agent")
    .map((e) => e.text ?? "")
    .join("\n");

/** The stored results answering `tool` in `chat`, in order. */
export const resultsOf = (w: P6World, tool: string, chat: ChatLabel = "c1"): Row[] => w.rows(chat).filter((r) => r.role === "toolResult" && r.tool === tool);

/** Every `<path>#L<n>` citation in `s`. */
export const citationsIn = (s: string): string[] => [...s.matchAll(/(?:memory|company|team)[\w/.-]*\.md#L\d+|MEMORY\.md#L\d+/g)].map((m) => m[0]);

/** A citation resolves when `memory_get` at its path and line returns a line holding `needle`. */
export async function resolves(w: P6World, cite: string, needle: string): Promise<boolean> {
  const [path, line] = cite.split("#L");
  const got = await w.get(path ?? "", Number(line), 1);
  return got.ok && got.lines.length === 1 && got.lines[0]!.n === Number(line) && got.lines[0]!.text.includes(needle);
}

/** A stable error code (`SOME_CODE`) anywhere in `s`. */
export const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

/** The facts the tasks use: about Pat Solo and Sam Solo only (`test/fixtures/people.json`). */
export const PAT_FACT = "Pat Solo prefers plain text over PDFs";
export const PAT_CORRECTION = "Pat Solo prefers Markdown, not plain text";
export const SAM_FACT = "Sam Solo is switching the team meeting to Thursdays";
/** The planted number: the all-zero sixteen-digit value, never a real one. */
export const ZEROS = "0000000000000000";
