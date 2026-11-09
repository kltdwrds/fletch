// The P11 world as the files tasks read it (F100, `docs/plan-v2/contracts/P11-files-documents.md`): the hermetic test
// host with the scripted fake model, the owner Sam Solo and the member Pat Solo of Solo Sam from
// `test/fixtures/people.json`, Sam's `Person` (`PersonFiles`, `PersonLinks`) and a recording Renderer port that answers
// the formats it is told to. A tier-1 run records what it observed into this shape; every grader of a `.task.ts` in this
// folder is written over it alone. Pure: no import of the agent's sources, so a task module loads under plain Node (the
// version-hash script) and under the root tsconfig (the m0 contract check).
//
// Where a task names a Muse observable fletch does not have (a builder's "Done" turn, an xlsx formula, a disabled
// composer), the world gives the fletch one: the tool result that precedes the reply, a CSV's total cell read back, the
// chat page's `live` expression read from its source.
import type { ScenarioWorld } from "../../support/scenario.ts";

/** One row of Sam's `files` table. */
export interface FileRow {
  path: string;
  size: number;
  sha256: string;
  mediaType: string | null;
  updatedAt: number;
  /** The text of a text file, or null for a binary document. */
  text: string | null;
}

/** One transcript entry of chat c1, in order: Sam's message, a tool call, a tool's result, or the agent's words. */
export interface Entry {
  role: "user" | "call" | "tool" | "agent";
  text: string;
  /** The tool's name for a `call` or `tool` entry. */
  tool?: string;
}

/** One approval card as the chat holds it. */
export interface CardSeen {
  state: string;
  title: string;
  lines: string[];
  choices: string[];
}

/** One link effect the chat drew (a share card). */
export interface LinkSeen {
  kind: string;
  title: string;
  text: string;
  href: string;
}

/** One HTTP answer a probe got: who asked (`sam`, `pat`, `none`), its status, its code and its body's text. */
export interface Answer {
  who: "sam" | "pat" | "none";
  status: number;
  code: string | null;
  body: string;
}

/** One render the world was asked for, and what the tool answered, in a named world. */
export interface RenderRun {
  world: string;
  /** The formats the Renderer port was asked for, in order. */
  asked: string[];
  /** The tool results the turn's `render_document` calls gave. */
  results: string[];
  /** Sam's files after the turn. */
  files: FileRow[];
}

export interface P11World extends ScenarioWorld {
  /** Sam's files when the turns began and now. */
  readonly before: FileRow[];
  files(): FileRow[];
  /** Chat c1's entries in order. */
  entries(): Entry[];
  /** Sam's chat cards and the links drawn in c1. */
  cards(): CardSeen[];
  links(): LinkSeen[];
  /** Sam's `shares` rows (id, path, sha256, expires_at). */
  shares(): Array<{ id: string; path: string; sha256: string; expiresAt: number }>;
  /** R2 keys under `shares/`. */
  pointers(): string[];
  /** Every Ledger journal row as `<actionKind> <subject>`, and each row's whole text. */
  journal(): Promise<string[]>;
  journalText(): Promise<string>;
  /** Named observations taken during the turns: the probes' answers, counts at a stage, read-backs. */
  readonly answers: Record<string, Answer>;
  readonly at: Record<string, { shares: number; pointers: number; pending: number; links: number }>;
  /** Every render in every world the task ran (T-P11-02 runs two). */
  readonly renders: RenderRun[];
  /** Every request the egress recorder saw leave the deploy. */
  readonly egress: string[];
  /** The chat page's `live` expression, as `packages/agent/src/http/app/chat.ts` writes it. */
  readonly liveExpr: string;
  /** The `file_list` tool's text and the Library route's JSON items. */
  readonly listing: { tool: string; library: Array<{ path: string; size: number; updated_at: number; mediaType?: string; versions?: number }> };
}

/** The probe files' names (every probe is `p11-*`). */
export const MEMO_DOCX = "documents/p11-memo.docx";
export const MEMO_MD = "notes/p11-memo.md";
export const BUDGET_CSV = "sheets/p11-budget.csv";
export const BUDGET_HTML = "documents/p11-budget.html";
export const DECK = "documents/p11-memo-deck.pptx";
export const PROBE_TXT = "p11-probe.txt";
/** `file_write`'s words over an existing home file (`REPLACED_WORDS`, P11 delta 1; the planted test holds them to the tool). */
export const REPLACED = "REPLACED:";
export const NOT_KEPT = "its earlier content was not kept";
/** The same words when the store kept the replaced bytes as a version (F103, D-0028 proposed; `keptWords`). */
export const KEPT = /its earlier content was kept as version (\d+)/;
/** Whether a write's result says what became of the earlier content, either way, in the tool's words. */
export const saysKept = (t: string): boolean => t.includes(NOT_KEPT) || KEPT.test(t);

/** The agent's words after the `n`th message of Sam's (1-based). */
export const replyTo = (w: P11World, n: number): string => {
  const out: string[] = [];
  let seen = 0;
  for (const e of w.entries()) {
    if (e.role === "user") seen++;
    else if (e.role === "agent" && seen === n) out.push(e.text);
  }
  return out.join("\n");
};
/** Rows that are new since the turns began (by path). */
export const newRows = (w: P11World): FileRow[] => w.files().filter((f) => !w.before.some((b) => b.path === f.path));
/** A row by path, now. */
export const row = (w: P11World, path: string): FileRow | undefined => w.files().find((f) => f.path === path);
/** The sha a path had when the turns began. */
export const shaBefore = (w: P11World, path: string): string | undefined => w.before.find((f) => f.path === path)?.sha256;
/** The index of the first entry matching. */
export const indexOf = (w: P11World, p: (e: Entry) => boolean): number => w.entries().findIndex(p);
/** The total row's value of a CSV: the second cell of the row whose first cell is `total`. */
export const totalOf = (csv: string | null): number | null => {
  const line = (csv ?? "").split("\n").find((l) => /^total\s*,/i.test(l.trim()));
  return line ? Number(line.split(",")[1]) : null;
};
/** The sum of a CSV's data rows (every row but the header and the total). */
export const sumOf = (csv: string | null): number => (csv ?? "").split("\n").slice(1).filter((l) => l.trim() && !/^total\s*,/i.test(l.trim())).reduce((s, l) => s + Number(l.split(",")[1]), 0);
/** A task's three word lists, each its graders' names by kind. */
export const named = <W>(graders: Array<{ name: string; kind: string; check: (w: W) => unknown }>) => ({
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
});
/** Sam's R2 key for a home file. */
export const homeR2 = (path: string) => `person/sam%40solo-sam.example/files/${path}`;
/** The tool results a tool gave, in order. */
export const results = (w: P11World, tool: string): string[] => w.entries().filter((e) => e.role === "tool" && e.tool === tool).map((e) => e.text);
