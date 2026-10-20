// What an admin reaches of each agent (authority-model.md "Roles and teams", A9): its journal and its
// ledger, read through the `Company`, which owns who is an admin; never the person's memory or chats.
// An admin's attempt at either is refused by the person's own store and recorded as a journal row,
// which, like every journal row, names who tried what and carries no content.
import type { JournalRow } from "../grants/journal.ts";
import type { ModelCallRow, RunRow } from "../ledger/types.ts";

export type AdminArea = "memory" | "chats";

export interface AgentLedger {
  modelCalls: Array<ModelCallRow & { costMicros: number }>;
  runs: RunRow[];
}

/** The Ledger as the Company reads it for an admin. */
export interface LedgerReads {
  journalRows(filter: { principal?: string }): Promise<JournalRow[]>;
  modelCalls(filter: { person?: string }): Promise<AgentLedger["modelCalls"]>;
  runs(filter: { person?: string }): Promise<RunRow[]>;
}

type Refusal = { ok: false; code: string; reason: string };

/** An admin's read of one member's journal; the Company checks both roles before the Ledger is asked. */
export async function adminJournal(d: { isAdmin(p: string): boolean; isMember(p: string): boolean; ledger: LedgerReads }, by: string, person: string): Promise<{ ok: true; rows: JournalRow[] } | Refusal> {
  if (!d.isAdmin(by)) return { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin reads an agent's journal" };
  if (!d.isMember(person)) return { ok: false, code: "NOT_A_MEMBER", reason: "no such member" };
  return { ok: true, rows: await d.ledger.journalRows({ principal: person }) };
}

export async function adminLedger(d: { isAdmin(p: string): boolean; isMember(p: string): boolean; ledger: LedgerReads }, by: string, person: string): Promise<({ ok: true } & AgentLedger) | Refusal> {
  if (!d.isAdmin(by)) return { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin reads an agent's ledger" };
  if (!d.isMember(person)) return { ok: false, code: "NOT_A_MEMBER", reason: "no such member" };
  return { ok: true, modelCalls: await d.ledger.modelCalls({ person }), runs: await d.ledger.runs({ person }) };
}

/** A person's chats, listed to the person alone; anyone else, an admin included, is refused (A9). */
export function ownChats(person: string, requester: string, list: () => string[]): { ok: true; chats: string[] } | { ok: false; code: "CHATS_NOT_OWNER"; reason: string } {
  if (requester !== person) return { ok: false, code: "CHATS_NOT_OWNER", reason: "chats are read by their owner only" };
  return { ok: true, chats: list() };
}

export interface PersonalReads {
  person: string;
  /** The person's own store answering for `requester`: a refusal for anyone but the person. */
  read(area: AdminArea, requester: string): Promise<{ ok: boolean; code?: string }>;
  journal(row: JournalRow): Promise<unknown>;
  now(): number;
}

/**
 * An admin's read of a person's memory or chats. The person's store decides, and it refuses anyone
 * but the person; the refusal is journaled under the person with the admin as counterpart. A person
 * reading their own is pointed to their own routes, and nothing is journaled.
 */
export async function adminPersonalRead(d: PersonalReads, by: string, area: AdminArea): Promise<Refusal> {
  if (by === d.person) return { ok: false, code: "ADMIN_READ_SELF", reason: `your own ${area} are on your own routes` };
  const answer = await d.read(area, by);
  const code = answer.ok ? "ADMIN_READ_REFUSED" : (answer.code ?? "ADMIN_READ_REFUSED");
  const at = d.now();
  await d.journal({
    id: `admin-read:${area}:${d.person}:${at}:${by}`, at, actor: `person:${by}`, principal: d.person, actionKind: `admin.${area}.read`,
    subjectRef: area === "memory" ? "personal;memory-scope:personal" : "personal;resource:chats", counterpart: `person:${by}`, origin: by, hops: 0,
    decision: "deny", grantId: null, outcome: code, runId: `admin:${at}`, tokens: 0,
  });
  return { ok: false, code, reason: `an admin cannot read a person's ${area}` };
}
