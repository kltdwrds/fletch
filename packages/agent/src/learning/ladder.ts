// The promotion ladder's merge queue for team and company scope (memory-and-learning.md "Promotion
// ladder", M4, M5), in the `Company` object's SQLite, where the target scopes live. A proposal is made
// by a person's agent (the weekly review, a conversation, or the offboarding handover) and waits for
// that person's own consent; nothing moves upward without it (M4). On consent, skills pass the
// narrowing check against every member of the target scope, then the fresh-context referee; a
// survivor waits for its merge key, a human: one member of the team for team scope, an admin for
// company scope. The narrowing check runs again at the merge, since membership may have changed.
// Agents never consent, merge or decline: those take a person acting in person.
import { oneLine } from "../memory/home.ts";
import { MAX_LINE_CHARS } from "../memory/store.ts";
import { parseSkillFile } from "../skills/catalog.ts";
import { type Holding, narrowingCheck } from "./narrowing.ts";
import type { RefereeVerdict } from "./referee.ts";
import type { SkillWrite } from "./skill-files.ts";

export const SCHEMA = `CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, proposer TEXT NOT NULL, origin TEXT NOT NULL,
  name TEXT, artifact TEXT NOT NULL, status TEXT NOT NULL, code TEXT, reason TEXT,
  decided_by TEXT, merged_as TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);`;

export type PromotionKind = "skill" | "memory";
export type PromotionStatus = "awaiting_consent" | "rejected" | "ready" | "merged" | "declined";
export type PromotionOrigin = "review" | "conversation" | "handover";
/** Who acts: a person in person, or a person's agent. Only a person consents, merges or declines. */
export type Actor = { kind: "person" | "agent"; email: string };

export interface Proposal {
  id: string;
  kind: PromotionKind;
  /** `company` or `team:<id>`. */
  target: string;
  proposer: string;
  origin: PromotionOrigin;
  name: string | null;
  /** The whole SKILL.md for a skill, the one line for memory. */
  artifact: string;
  status: PromotionStatus;
  code: string | null;
  reason: string | null;
  decidedBy: string | null;
  mergedAs: string | null;
  createdAt: number;
}

type Row = { id: string; kind: PromotionKind; target: string; proposer: string; origin: PromotionOrigin; name: string | null; artifact: string; status: PromotionStatus; code: string | null; reason: string | null; decided_by: string | null; merged_as: string | null; created_at: number };
const toProposal = (r: Row): Proposal => ({ id: r.id, kind: r.kind, target: r.target, proposer: r.proposer, origin: r.origin, name: r.name, artifact: r.artifact, status: r.status, code: r.code, reason: r.reason, decidedBy: r.decided_by, mergedAs: r.merged_as, createdAt: r.created_at });

type Refusal = { ok: false; code: string; reason: string };
const refuse = (code: string, reason: string): Refusal => ({ ok: false, code, reason });
export type ProposalResult = { ok: true; proposal: Proposal } | Refusal;

export interface LadderDeps {
  storage: Pick<DurableObjectStorage, "sql">;
  isMember(email: string): boolean;
  isAdmin(email: string): boolean;
  teamMembers(team: string): string[] | null;
  members(): string[];
  /** The connectors one member holds, for the narrowing check. */
  holding(member: string): Holding;
  referee(input: { id: string; person: string; target: string; proposal: string }): Promise<RefereeVerdict>;
  writeSkill(target: string, name: string, text: string, writer: string): Promise<SkillWrite>;
  appendMemory(target: string, text: string, writer: string): Promise<{ ok: true; citation: string } | Refusal>;
  now(): number;
}

/** A skill file as a promotion carries it: the frontmatter declares its tools and connectors. */
export function skillText(i: { name: string; description: string; body: string; tools?: string[]; connectors?: string[] }, scope: string): string {
  const csv = (xs?: string[]) => (xs ?? []).join(", ");
  return `---\nname: ${i.name}\ndescription: ${JSON.stringify(oneLine(i.description))}\ntools: ${csv(i.tools)}\nconnectors: ${csv(i.connectors)}\nmetadata:\n  scope: ${scope}\n---\n${i.body}`;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export class PromotionLadder {
  private readonly d: LadderDeps;

  constructor(deps: LadderDeps) {
    this.d = deps;
  }

  private get sql(): SqlStorage {
    return this.d.storage.sql;
  }

  get(id: string): Proposal | null {
    const r = this.sql.exec<Row>("SELECT * FROM promotions WHERE id = ?", id).toArray()[0];
    return r ? toProposal(r) : null;
  }

  /** Who reads a target scope: every member for company scope, the team's members for a team. */
  readers(target: string): string[] | null {
    if (target === "company") return this.d.members();
    return target.startsWith("team:") ? this.d.teamMembers(target.slice(5)) : null;
  }

  /** The merge key: an admin for company scope, a member of the team for team scope. */
  holdsKey(email: string, target: string): boolean {
    if (target === "company") return this.d.isAdmin(email);
    return !!this.readers(target)?.includes(email);
  }

  /** A person's agent proposes; the proposal waits for the person's consent. */
  propose(person: string, input: unknown): ProposalResult {
    if (!this.d.isMember(person)) return refuse("NOT_A_MEMBER", "only a member's agent proposes");
    const i = (input ?? {}) as Record<string, unknown>;
    const target = typeof i.target === "string" ? i.target : "";
    const readers = this.readers(target);
    if (!readers) return refuse("PROMOTION_TARGET_INVALID", "a promotion goes to company scope or to a team");
    if (target !== "company" && !readers.includes(person)) return refuse("PROMOTION_NOT_IN_TEAM", "only a member of the team promotes into it");
    const origin: PromotionOrigin = i.origin === "review" || i.origin === "handover" ? i.origin : "conversation";
    let name: string | null = null;
    let artifact: string;
    if (i.kind === "skill") {
      const scope = target === "company" ? "company" : target;
      artifact = skillText({ name: String(i.name ?? ""), description: String(i.description ?? ""), body: String(i.body ?? ""), tools: strings(i.tools), connectors: strings(i.connectors) }, scope);
      const parsed = parseSkillFile(artifact);
      if (!parsed || parsed.name !== i.name || artifact.length > 32_000) return refuse("SKILL_INVALID", "a skill has a lower-case name, a one-line description and at most 32000 characters");
      name = parsed.name;
    } else if (i.kind === "memory") {
      artifact = oneLine(String(i.text ?? ""));
      if (!artifact || artifact.length > MAX_LINE_CHARS) return refuse("MEMORY_EMPTY", `a memory promotion is one line of at most ${MAX_LINE_CHARS} characters`);
    } else return refuse("PROMOTION_KIND_INVALID", "a promotion is a skill or a memory line");
    const id = `pr-${crypto.randomUUID()}`;
    const at = this.d.now();
    this.sql.exec(
      "INSERT INTO promotions (id, kind, target, proposer, origin, name, artifact, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_consent', ?, ?)",
      id, i.kind as string, target, person, origin, name, artifact, at, at,
    );
    return { ok: true, proposal: this.get(id) as Proposal };
  }

  /**
   * The company skill review's proposal (M12): company scope from company scope, so no person's
   * consent is asked (nothing moves up from anyone's personal scope), but the narrowing check and
   * the referee run now, as at consent, and a survivor waits in the admins' queue. Never merged here.
   */
  async reviewProposal(loop: string, input: { name: string; description: string; body: string; tools: string[]; connectors: string[] }): Promise<ProposalResult> {
    if (!loop.startsWith("loop:")) return refuse("PROMOTION_KIND_INVALID", "only a company loop proposes without a proposer");
    const artifact = skillText(input, "company");
    const parsed = parseSkillFile(artifact);
    if (!parsed || parsed.name !== input.name || artifact.length > 32_000) return refuse("SKILL_INVALID", "a skill has a lower-case name, a one-line description and at most 32000 characters");
    const id = `pr-${crypto.randomUUID()}`;
    const at = this.d.now();
    this.sql.exec(
      "INSERT INTO promotions (id, kind, target, proposer, origin, name, artifact, status, created_at, updated_at) VALUES (?, 'skill', 'company', ?, 'review', ?, ?, 'awaiting_consent', ?, ?)",
      id, loop, parsed.name, artifact, at, at,
    );
    const p = this.get(id) as Proposal;
    const narrowed = this.narrow(p);
    if (!narrowed.ok) return { ok: true, proposal: this.settle(id, "rejected", narrowed.code, narrowed.reason) };
    // The company owns the loop, so its referee call is the company's row in the Ledger.
    const v = await this.d.referee({ id, person: "company", target: "company", proposal: artifact });
    if (v.verdict === "reject") return { ok: true, proposal: this.settle(id, "rejected", v.code, v.reason) };
    return { ok: true, proposal: this.settle(id, "ready", null, v.reason) };
  }

  /** The proposer, in person, consents; the narrowing check and the referee run now. */
  async consent(actor: Actor, id: string): Promise<ProposalResult> {
    const p = this.get(id);
    if (!p) return refuse("PROMOTION_NOT_FOUND", `no proposal ${id}`);
    if (actor.kind !== "person") return refuse("PROMOTION_PERSON_ONLY", "only the person consents to a promotion, never an agent");
    if (actor.email !== p.proposer) return refuse("PROMOTION_NOT_PROPOSER", "only the person whose agent proposed it consents");
    if (p.status !== "awaiting_consent") return refuse("PROMOTION_NOT_AWAITING", `the proposal is ${p.status}`);
    const narrowed = this.narrow(p);
    if (!narrowed.ok) return { ok: true, proposal: this.settle(p.id, "rejected", narrowed.code, narrowed.reason) };
    const v = await this.d.referee({ id: p.id, person: p.proposer, target: p.target, proposal: p.artifact });
    if (v.verdict === "reject") return { ok: true, proposal: this.settle(p.id, "rejected", v.code, v.reason) };
    return { ok: true, proposal: this.settle(p.id, "ready", null, v.reason) };
  }

  /** The merge key's holder, in person, merges a refereed proposal into its scope. */
  async merge(actor: Actor, id: string): Promise<ProposalResult> {
    const p = this.get(id);
    const refused = this.keyCheck(actor, p);
    if (refused) return refused;
    const proposal = p as Proposal;
    const narrowed = this.narrow(proposal);
    if (!narrowed.ok) return { ok: true, proposal: this.settle(proposal.id, "rejected", narrowed.code, narrowed.reason, actor.email) };
    const writer = `promotion:${proposal.id}`;
    let mergedAs: string;
    if (proposal.kind === "skill") {
      const w = await this.d.writeSkill(proposal.target, proposal.name as string, proposal.artifact, writer);
      mergedAs = w.key;
    } else {
      const w = await this.d.appendMemory(proposal.target, proposal.artifact, writer);
      if (!w.ok) return w;
      mergedAs = w.citation;
    }
    this.sql.exec("UPDATE promotions SET merged_as = ? WHERE id = ?", mergedAs, proposal.id);
    return { ok: true, proposal: this.settle(proposal.id, "merged", null, proposal.reason, actor.email) };
  }

  async decline(actor: Actor, id: string): Promise<ProposalResult> {
    const p = this.get(id);
    const refused = this.keyCheck(actor, p);
    if (refused) return refused;
    return { ok: true, proposal: this.settle((p as Proposal).id, "declined", null, null, actor.email) };
  }

  /** What a person may see of the queue: their own proposals, and those whose merge key they hold. */
  list(email: string): Proposal[] {
    return this.sql.exec<Row>("SELECT * FROM promotions ORDER BY created_at, id").toArray().map(toProposal).filter((p) => p.proposer === email || this.holdsKey(email, p.target));
  }

  /** At a departure: proposals that never became the company's go with the person's scope. */
  dropUnapproved(email: string): number {
    return this.sql.exec("DELETE FROM promotions WHERE proposer = ? AND status IN ('awaiting_consent', 'rejected', 'declined')", email).rowsWritten;
  }

  private keyCheck(actor: Actor, p: Proposal | null): Refusal | null {
    if (!p) return refuse("PROMOTION_NOT_FOUND", "no such proposal");
    if (actor.kind !== "person") return refuse("PROMOTION_PERSON_ONLY", "only a person merges or declines, never an agent");
    if (!this.holdsKey(actor.email, p.target)) return refuse("PROMOTION_NOT_KEY_HOLDER", p.target === "company" ? "a company admin merges into company scope" : "a member of the team merges into it");
    if (p.status !== "ready") return refuse("PROMOTION_NOT_READY", `the proposal is ${p.status}`);
    return null;
  }

  private narrow(p: Proposal) {
    if (p.kind !== "skill") return { ok: true as const };
    return narrowingCheck(p.artifact, (this.readers(p.target) ?? []).map((m) => this.d.holding(m)));
  }

  private settle(id: string, status: PromotionStatus, code: string | null, reason: string | null, by?: string): Proposal {
    this.sql.exec("UPDATE promotions SET status = ?, code = ?, reason = ?, decided_by = COALESCE(?, decided_by), updated_at = ? WHERE id = ?", status, code, reason, by ?? null, this.d.now(), id);
    return this.get(id) as Proposal;
  }
}
