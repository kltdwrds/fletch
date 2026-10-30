// The P15 world as the approval tasks read it (F25, `docs/plan-v2/contracts/P15-approvals.md`). Every grader of a
// `.task.ts` in this folder is written over these interfaces alone. Pure: no import of the agent's sources, so a
// task module loads under plain Node (the version-hash script) and under the root tsconfig (the m0 contract check).
//
// Where a task names a Muse observable fletch does not have, the world gives the fletch one: Muse's
// `permissions.history` is fletch's card rows and the Ledger's journal; Muse's egress park is the gate's card effect
// (the turn ends `AWAITING_DECISION`, delta 1); Muse's `exec` running curl is the test host's `share_post`
// (`test/support/p15-fixtures.ts`), every run of which is one entry in the fake egress log.
import type { ScenarioWorld } from "../../support/scenario.ts";

/** `c1` is Sam's main chat, `c2` a second one a setup opens. */
export type ChatLabel = "c1" | "c2";

/** One card as the chat stores and renders it: its row's fields and the view's words. */
export interface CardInfo {
  id: string;
  state: string;
  tool: string;
  /** The descriptor's action kind. */
  kind: string;
  fingerprint: string;
  /** The host a share names (its recipients), when it names one. */
  host: string | null;
  choice: string | null;
  decidedBy: string | null;
  grantId: string | null;
  outcome: string | null;
  createdAt: number;
  decidedAt: number | null;
  /** The card's words as the harness renders them (`renderCard`). */
  view: { title: string; lines: string[]; status: string; choices: string[]; proposed: Record<string, unknown>; dest: string; standing: string | null };
}

/** One answer of the decide path, per card, in the order the task's events asked. */
export interface Decided {
  card: string;
  as: "person" | "agent";
  choice: string;
  ok: boolean;
  state?: string;
  outcome?: string;
  code?: string;
  text?: string;
  again?: boolean;
}

/** One journal row: its id with the chat's id written as the chat's label, and the row itself as stored. */
export interface JournalInfo {
  key: string;
  actor: string;
  actionKind: string;
  decision: string;
  grantId: string | null;
  outcome: string;
  /** The stored row as JSON, every field. */
  raw: string;
}

export interface GrantInfo {
  id: string;
  grantor: { kind: string; id?: string };
  grantee: { kind: string; id?: string };
  subject: { kind: string; ref: string };
  mode: string;
  constraints: Record<string, unknown>;
  created_from: string;
  one_shot?: boolean;
  used_at?: number;
  expires_at?: number;
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
  effects?: string[];
}

export interface TurnInfo {
  status: string;
  code: string | null;
}

export type Frame = { type: string } & Record<string, unknown>;

export interface P15World extends ScenarioWorld {
  cards(chat?: ChatLabel): CardInfo[];
  decisions(): Decided[];
  journal(): Promise<JournalInfo[]>;
  /** Sam's grants as her grant store holds them. */
  grants(): GrantInfo[];
  /** Every request the fake egress received (`share_post`), in order. */
  egress(): Array<{ host: string; text: string }>;
  rows(chat?: ChatLabel): Row[];
  entries(chat?: ChatLabel): Entry[];
  turns(chat?: ChatLabel): TurnInfo[];
  frames(chat?: ChatLabel): Frame[];
  mailbox(chat?: ChatLabel): Array<{ kind: string; state: string }>;
  /** How each turn ended, as the Ledger counts it. */
  turnEnds(): Promise<Array<{ outcome: string }>>;
  /** The clock now, and when the world began. */
  now(): number;
  start(): number;
  /** What the fake browser received: each value typed, with the host of the page it was typed into; each page opened. */
  typed(): Array<{ host: string; value: string }>;
  opened(): string[];
  /** Every request the fake browser received for `host`: each read and each page opened, in order. */
  requestsTo(host: string): number;
  /** The Vault's audit rows (never a value) and its credential grants. */
  audit(): Array<{ ref: string; host: string; outcome: string; grant: string | null }>;
  vaultGrants(): Array<{ nonce: string; hosts: string[]; oneShot: boolean; usedAt: number | null }>;
  /** The value seeded for Sam's credential (T-P15-07), generated per world: the string a leak scan looks for. */
  credentialValue(): string;
  /** Every place a value could leak to, as text: the model's requests, the transcripts, the journal, the notices, Sam's stores. */
  sinks(): Promise<Record<string, string>>;
}

/** A card drawn on a page: its words, its choices' labels, and every word drawn in it. */
export interface DrawnCard {
  id: string;
  title: string;
  status: string;
  choices: string[];
  text: string;
}

/** The pages Sam sees: a chat's thread, the Approvals tab. Each read is a fresh page load, as a reload is. */
export interface P15PageWorld extends P15World {
  thread(chat: ChatLabel): Promise<DrawnCard[]>;
  /** Every word drawn in a chat's thread. */
  threadText(chat: ChatLabel): Promise<string>;
  /** The Approvals tab as drawn: the cards waiting with their choices, each decided row's words and whether it offers Revoke, and every word drawn. */
  approvals(): Promise<{ waiting: DrawnCard[]; history: Array<{ id: string; text: string; revocable: boolean }>; text: string }>;
  /** A grant input as `grants/validate.ts` judges it at write: null when valid, else its code. */
  validateGrant(input: unknown): string | null;
}

/** Sam's cards in `chat` whose share names `host`. */
export const cardsFor = (w: P15World, host: string, chat?: ChatLabel): CardInfo[] => w.cards(chat).filter((c) => c.host === host);

/** The agent's visible entries' text, joined. */
export const replyOf = (w: P15World, chat?: ChatLabel): string =>
  w
    .entries(chat)
    .filter((e) => e.kind === "agent")
    .map((e) => e.text ?? "")
    .join("\n");

/** The stored rows answering `tool`, in order. */
export const resultsOf = (w: P15World, tool: string, chat?: ChatLabel): Row[] => w.rows(chat).filter((r) => r.role === "toolResult" && r.tool === tool);

/** A stable error code (`SOME_CODE`) anywhere in `s`. */
export const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

/** The matrix's choices in the words the card gives them, for Sam's own agent: a share, and a purchase. */
export const SHARE_CHOICES = ["Allow once", "Allow your agent for 30 days", "Always allow this", "Decline"];
export const PURCHASE_CHOICES = ["Allow once", "Decline"];

/** The stored results of every browse tool, in order. */
export const browseResultsOf = (w: P15World, chat?: ChatLabel): Row[] => w.rows(chat).filter((r) => r.role === "toolResult" && (r.tool ?? "").startsWith("browse_"));
