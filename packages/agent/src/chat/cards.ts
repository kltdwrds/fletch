// Approval cards (M7.1, authority-model.md "Approvals"): a proposal the grants did not allow waits
// here, in the chat it came from, for its approver: the principal for their own resources, an admin
// for a company resource. The card's words are written by this code from the descriptor; the model's
// arguments are shown as data, labelled as proposed. The choices are allow once, allow for this
// person for 30 days, always for this action kind, or decline; a purchase is allow once or decline.
// A decision is final: a declined proposal is refused again if proposed again.
//
// From M20.1 (QYVR-172, 173) a decision claims its card here before anything else happens: the card
// moves from pending to deciding in one conditional write, so a second click, a retry or the other
// surface finds it taken and is answered with the first decision's outcome, never a second run. A
// decided card says its outcome in words (`status`), on the chat page and the Approvals page alike.
import { needsFreshCard } from "../grants/engine.ts";
import type { CardEffect, Effect } from "./tools.ts";
import type { Decision, Descriptor, Grant } from "../grants/types.ts";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  descriptor TEXT NOT NULL,
  decision TEXT NOT NULL,
  simulated INTEGER NOT NULL,
  flag TEXT,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  choice TEXT,
  decided_by TEXT,
  decided_at INTEGER,
  grant_id TEXT,
  outcome TEXT,
  created_at INTEGER NOT NULL,
  detail TEXT
);`;

export type Choice = "once" | "period" | "always" | "deny";
export type CardState = "pending" | "deciding" | "approved" | "declined" | "failed";
export const PERIOD_MS = 30 * 86_400_000;

export interface CardRow {
  id: string;
  turnId: string;
  tool: string;
  args: Record<string, unknown>;
  descriptor: Descriptor;
  decision: Decision;
  simulated: boolean;
  flag: string | null;
  fingerprint: string;
  state: CardState;
  choice: Choice | null;
  decidedBy: string | null;
  grantId: string | null;
  outcome: string | null;
  createdAt: number;
  /** When it was decided, null while it waits. */
  decidedAt: number | null;
  /** Words the tool added for the person's decision (the job's time); the descriptor stays identifiers only. */
  detail: string[];
}

/** What the app shows; every word but `proposed` is the harness's. */
export interface CardView {
  id: string;
  state: CardState;
  title: string;
  lines: string[];
  /** The arguments the agent proposed, as data. */
  proposed: Record<string, unknown>;
  choices: Array<{ choice: Choice; label: string }>;
  flag: string | null;
  /** What happened to the card, in words: waiting, being decided, or the decision and what it did. */
  status: string;
  /** When it was decided, else when it was asked (M23.3: the Approvals history says when). */
  at: number;
  /** Where the action goes, in words (M27.4: the Approvals history's Destination). */
  dest: string;
  /** The standing grant a 30-day or always decision signed, which the person may revoke; null for any other. */
  standing: string | null;
}

type Row = { id: string; turn_id: string; tool: string; args: string; descriptor: string; decision: string; simulated: number; flag: string | null; fingerprint: string; state: CardState; choice: Choice | null; decided_by: string | null; grant_id: string | null; outcome: string | null; created_at: number; decided_at: number | null; detail: string | null };
const toCard = (r: Row): CardRow => ({
  id: r.id, turnId: r.turn_id, tool: r.tool, args: JSON.parse(r.args), descriptor: JSON.parse(r.descriptor), decision: JSON.parse(r.decision), simulated: r.simulated === 1,
  flag: r.flag, fingerprint: r.fingerprint, state: r.state, choice: r.choice, decidedBy: r.decided_by, grantId: r.grant_id, outcome: r.outcome, createdAt: r.created_at, decidedAt: r.decided_at ?? null,
  detail: r.detail ? (JSON.parse(r.detail) as string[]) : [],
});

export class CardStore {
  private readonly storage: Pick<DurableObjectStorage, "sql">;

  constructor(storage: Pick<DurableObjectStorage, "sql">) {
    this.storage = storage;
  }

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  /** Records a card once per effect id; false when it was already here. */
  add(turnId: string, e: CardEffect, at: number): boolean {
    if (this.get(e.id)) return false;
    this.sql.exec(
      "INSERT INTO cards (id, turn_id, tool, args, descriptor, decision, simulated, flag, fingerprint, state, created_at, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      e.id, turnId, e.tool, JSON.stringify(e.args), JSON.stringify(e.descriptor), JSON.stringify(e.decision), e.simulated ? 1 : 0, e.flag, e.fingerprint, at, e.detail?.length ? JSON.stringify(e.detail) : null,
    );
    return true;
  }

  get(id: string): CardRow | null {
    const r = this.sql.exec<Row>("SELECT * FROM cards WHERE id = ?", id).toArray()[0];
    return r ? toCard(r) : null;
  }

  list(): CardRow[] {
    return this.sql.exec<Row>("SELECT * FROM cards ORDER BY created_at, id").toArray().map(toCard);
  }

  /** The state of the latest card for one proposal: pending, declined (final) or none. */
  byFingerprint(fp: string): "pending" | "denied" | null {
    const states = this.sql.exec<{ state: CardState }>("SELECT state FROM cards WHERE fingerprint = ?", fp).toArray().map((r) => r.state);
    if (states.includes("declined")) return "denied";
    return states.includes("pending") || states.includes("deciding") ? "pending" : null;
  }

  /**
   * Takes a pending card for one decision. The read and the write run with no await between them, which
   * the object runs alone, so of two decisions on the same card exactly one is told true, whichever
   * surface or retry it came from.
   */
  claim(id: string, d: { choice: Choice; by: string; at: number }): boolean {
    if (this.get(id)?.state !== "pending") return false;
    this.sql.exec("UPDATE cards SET state = 'deciding', choice = ?, decided_by = ?, decided_at = ? WHERE id = ? AND state = 'pending'", d.choice, d.by, d.at, id);
    return true;
  }

  /** The grant a deciding card's approval created, kept so a decision taken up again reuses it. */
  setGrant(id: string, grantId: string): void {
    this.sql.exec("UPDATE cards SET grant_id = ? WHERE id = ? AND state = 'deciding'", grantId, id);
  }

  /** A claimed card whose approval could not be made into a grant waits again; nothing ran. */
  release(id: string): void {
    this.sql.exec("UPDATE cards SET state = 'pending', choice = NULL, decided_by = NULL, decided_at = NULL WHERE id = ? AND state = 'deciding'", id);
  }

  /** The cards of one turn still waiting for, or in, a decision. */
  openFor(turnId: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM cards WHERE turn_id = ? AND state IN ('pending', 'deciding')", turnId).toArray()[0]?.n ?? 0;
  }

  /** Pending simulated proposals: what a projecting connector shows as applied. */
  simulatedPending(): Array<{ tool: string; args: Record<string, unknown> }> {
    return this.list().filter((c) => c.state === "pending" && c.simulated).map((c) => ({ tool: c.tool, args: c.args }));
  }

  decide(id: string, d: { state: CardState; choice: Choice; by: string; at: number; grantId: string | null; outcome: string }): void {
    this.sql.exec("UPDATE cards SET state = ?, choice = ?, decided_by = ?, decided_at = ?, grant_id = ?, outcome = ? WHERE id = ? AND state IN ('pending', 'deciding')", d.state, d.choice, d.by, d.at, d.grantId, d.outcome, id);
  }
}

/** The choices a card offers: a purchase, or a fresh-card kind such as a public share link, never gets a lasting one. */
export function choicesFor(d: Descriptor): Choice[] {
  return d.purchase || needsFreshCard(d.actionKind) ? ["once", "deny"] : ["once", "period", "always", "deny"];
}

const FLAGS: Record<string, string> = {
  REQUEST_OUTSIDE_GRANTS: "Flagged: a colleague's request led to this, and no grant of yours covers it.",
  RESTRICTED_LATCH: "Flagged: this task read restricted data, so nothing runs without you.",
  AFTER_EXTERNAL_INPUT: "Flagged: this follows content from outside your own records (a page, a connector or a tool result).",
};

export function renderCard(c: CardRow, nameOf: (email: string) => string, label: string): CardView {
  const d = c.descriptor;
  const asker = d.hops > 0 ? d.origin : d.counterpart.kind === "own-agent" ? null : d.counterpart.id;
  const title = asker ? `${nameOf(asker)} asked your agent${d.hops > 0 ? " (through their agent)" : ""} to: ${label}` : `Your agent asks to: ${label}`;
  // Words only (M23.2): the action's id and the resource's are identifiers, and the arguments stay data.
  const lines = [
    ...(d.subject.scope === "company" ? ["This touches a company resource; an admin decides."] : []),
    ...(d.subject.connector ? [`Connector: ${d.subject.connector}`] : []),
    ...(d.amount ? [`Amount: ${d.amount.value} ${d.amount.currency}`] : []),
    ...(d.recipients?.length ? [`Recipients: ${d.recipients.join(", ")}`] : []),
    ...c.detail,
    ...(c.simulated ? ["Your agent carried on as if this were done; nothing has happened yet."] : []),
    ...(c.flag ? [FLAGS[c.flag] ?? `Flagged: ${c.flag}`] : []),
  ];
  const person = asker ? nameOf(asker) : "your agent";
  const labels: Record<Choice, string> = { once: "Allow once", period: `Allow ${person} for 30 days`, always: `Always allow this${asker ? ` for ${person}` : ""}`, deny: "Decline" };
  const standing = (c.choice === "period" || c.choice === "always") && c.grantId ? c.grantId : null;
  return { id: c.id, state: c.state, title, lines, proposed: c.args, choices: choicesFor(d).map((choice) => ({ choice, label: labels[choice] })), flag: c.flag, status: cardStatus(c, labels), at: c.decidedAt ?? c.createdAt, dest: destOf(d), standing };
}

/** Where an action goes, in words: the connected app, the people it reaches, or whose records it stays in. */
export function destOf(d: Descriptor): string {
  if (d.subject.connector) return d.subject.connector;
  if (d.recipients?.length) return d.recipients.join(", ");
  return d.subject.scope === "company" ? "Your company" : "Your own account";
}

/** What the decision was, in the words of the button that made it. */
const DECIDED: Record<Choice, string> = { once: "Allowed once", period: "Allowed for 30 days", always: "Always allowed", deny: "Declined" };

/** The card's state in words; never a code. A failed approval says it was allowed and did not run. */
export function cardStatus(c: Pick<CardRow, "state" | "choice" | "outcome">, labels?: Record<Choice, string>): string {
  if (c.state === "pending") return "Waiting for your decision.";
  if (c.state === "deciding") return "Being decided now.";
  const said = c.choice ? (c.choice === "period" && labels ? labels.period.replace(/^Allow/, "Allowed") : DECIDED[c.choice]) : "Decided";
  // A decision taken up again after its first run had committed (the object restarted mid-decision): it
  // may have run then, and it is never run twice, so neither "ran" nor "did not run" is said.
  if (c.outcome === "EFFECT_ALREADY_COMMITTED") return `${said}; it had already been started once, so it was not run again.`;
  if (c.state === "failed") return `${said}, but it did not run.`;
  return c.state === "approved" ? `${said}; it ran.` : `${said}.`;
}

/** The grant an approval creates: signed by the principal, or by the company for a company resource. */
export function grantFor(c: CardRow, choice: Exclude<Choice, "deny">, tenant: string, now: number): Omit<Grant, "id" | "tenant" | "created_at"> {
  const d = c.descriptor;
  const company = d.subject.scope === "company";
  const asker = d.hops > 0 ? d.origin : d.counterpart.kind === "own-agent" ? d.principal : d.counterpart.id;
  const grantee: Grant["grantee"] = !company && d.counterpart.kind === "own-agent" && d.hops === 0 ? { kind: "own-agent" } : { kind: "person", id: asker };
  return {
    grantor: company ? { kind: "company", id: tenant } : { kind: "person", id: d.principal },
    grantee,
    subject: { kind: "action-kind", ref: d.actionKind },
    mode: "auto",
    constraints: {},
    ...(choice === "once" ? { one_shot: true } : {}),
    ...(choice === "period" ? { expires_at: now + PERIOD_MS } : {}),
    created_from: "approval-card",
  };
}

/**
 * The words a step that paused on cards owes the person (F26, B-P15-06, after M19.2's rule for a tool's own words): when
 * neither the model nor a tool wrote any beside its calls, code says that each card's action waits for their decision and
 * has not run, delivered once beside the call. A step with words adds nothing; a projected card never paused.
 */
export function pauseWords(said: boolean, effects: readonly Effect[], label: (tool: string) => string): Effect[] {
  if (said || effects.some((e) => e.kind === "deliver")) return [];
  return effects.flatMap((e) => (e.kind === "card" && !e.simulated ? [{ kind: "deliver" as const, id: `${e.id}:announce`, text: `Waiting for your decision: ${label(e.tool)}. It has not run yet.` }] : []));
}
