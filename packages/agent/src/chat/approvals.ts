// What happens to a gated call after its step is committed (M7.1): an automatic action is committed
// again through the principal's grants and performed only with the grant id that answer cites; a
// card is stored and rendered; a refusal is journaled. Every outcome is one content-free journal row.
// Cards are decided here too: only the principal, or an admin for a company resource, and never an
// agent session; an approval becomes a grant first, then the action runs under it.
import { fence } from "../context/fence.ts";
import { needsFreshCard } from "../grants/engine.ts";
import type { CreateResult } from "../grants/store.ts";
import { type JournalRow, partyRef, subjectRef } from "../grants/journal.ts";
import type { Decision, Descriptor } from "../grants/types.ts";
import type { ToolSession } from "../tools/registry.ts";
import { type CardRow, type CardState, type CardStore, type CardView, type Choice, choicesFor, grantFor, renderCard } from "./cards.ts";
import { decideText } from "./decide-words.ts";
import type { AuthorityApi, TurnContext } from "./gate.ts";
import type { CardEffect, Effect } from "./tools.ts";
import { traceApproval } from "../obs/spans.ts";
import { log } from "../obs/log.ts";

/** A company resource's approvals: an admin, checked where membership lives, signs a company grant. */
export interface CompanyApprovals {
  isAdmin(person: string): Promise<boolean>;
  createGrant(by: string, input: unknown): Promise<CreateResult>;
}

export interface Tally {
  done: number;
  pending: number;
  refused: number;
}

export interface ApprovalPorts {
  tenant: string;
  chatId: string;
  cards: CardStore;
  /** Decisions running in this instance, by card id: a second decision on a card awaits the first's answer. */
  inflight: Map<string, Promise<DecideResult>>;
  journal(row: JournalRow): Promise<unknown>;
  frame(frame: Record<string, unknown>): void;
  /** A tool session for a context: the registry the effect's call came from. */
  session(context: TurnContext): ToolSession;
  authority?: (person: string) => AuthorityApi;
  company?: CompanyApprovals;
  /** Appends a system message to the transcript, so the next turn sees what was decided. */
  note(id: string, text: string): void;
  tally(turnId: string, add: Partial<Tally>): void;
  /** Tells a colleague who asked how their request ended. */
  reply?(card: CardRow, text: string): Promise<void>;
  nameOf(email: string): string;
  label(tool: string): string;
  now(): number;
}

/**
 * A decision's answer. `again` marks the answer to a decision the card had already been given; `card` is
 * the card as it now stands, its outcome in words; a refusal carries its code and the sentence for it.
 */
export type DecideResult =
  | { id: string; ok: true; state: CardState; grantId: string | null; outcome: string; card: CardView; again?: true }
  | { id: string; ok: false; code: string; text: string };

export const contextOf = (d: Descriptor): TurnContext => ({ counterpart: d.counterpart, origin: d.origin, hops: d.hops });

export class Approvals {
  private readonly p: ApprovalPorts;

  constructor(p: ApprovalPorts) {
    this.p = p;
  }

  private row(id: string, d: Descriptor, decision: Decision["decision"], grantId: string | null | undefined, outcome: string, runId: string, tokens = 0, actor?: string): JournalRow {
    return {
      id: `${this.p.chatId}:${id}`, at: this.p.now(), actor: actor ?? d.actor, principal: d.principal, actionKind: d.actionKind, subjectRef: subjectRef(d.subject),
      counterpart: partyRef(d.counterpart), origin: d.origin, hops: d.hops, decision, grantId: grantId ?? null, outcome, runId, tokens,
    };
  }

  /** Releases one committed gated effect. */
  async release(turnId: string, e: Exclude<Effect, { kind: "deliver" | "delegate" | "link" | "react" }>): Promise<void> {
    const p = this.p;
    if (e.kind === "card") return this.addCard(turnId, e);
    if (e.kind === "refusal") {
      await p.journal(this.row(e.id, e.descriptor, "deny", e.decision.grantId, e.outcome, turnId, e.tokens));
      p.tally(turnId, { refused: 1 });
      p.frame({ type: "action", turn: turnId, id: e.id, tool: e.tool, status: "failed", code: e.code ?? "ACTION_DENIED" });
      return;
    }
    if (e.kind === "journal") {
      await p.journal(this.row(e.id, e.descriptor, "auto", e.decision.grantId, e.outcome, turnId, e.tokens));
      return;
    }
    // An action: the owning store decides again now, and the use is recorded where the grant lives.
    const d = { ...e.descriptor, at: p.now() };
    const decision: Decision = p.authority ? await p.authority(d.principal).commit(d, `${p.chatId}:${e.id}`, e.args) : { decision: "deny", step: "none", code: "GRANTS_UNAVAILABLE" };
    if (decision.decision === "auto") {
      const r = await p.session(contextOf(d)).perform(e.id, e.tool, e.args, decision.grantId);
      await p.journal(this.row(e.id, d, "auto", decision.grantId, r.ok ? "DONE" : (r.code ?? "ACTION_FAILED"), turnId, e.tokens));
      p.tally(turnId, r.ok ? { done: 1 } : { refused: 1 });
      // The queued call's answer reaches the model as data on its next step, so an id it made or a reply it
      // was given is something it can use; without it the agent could never act on what it just created.
      const said = r.ok ? r.text : r.reason;
      p.note(e.id, `Your queued ${e.tool} (${e.id}) ${r.ok ? "ran" : `failed with ${r.code ?? "ACTION_FAILED"}`}.${said ? `\n${fence(`tool:${e.tool}`, said)}` : ""}`);
      p.frame({ type: "action", turn: turnId, id: e.id, tool: e.tool, status: r.ok ? "done" : "failed", ...(r.ok ? {} : { code: r.code, ...(r.reason ? { reason: r.reason } : {}) }) });
      return;
    }
    if (decision.decision === "ask") return this.addCard(turnId, { kind: "card", id: e.id, tool: e.tool, args: e.args, descriptor: d, decision, simulated: false, flag: null, fingerprint: `${e.tool}:${e.id}`, ...(e.detail ? { detail: e.detail } : {}), ...(e.tokens !== undefined ? { tokens: e.tokens } : {}) });
    await p.journal(this.row(e.id, d, "deny", decision.grantId, "DENIED", turnId, e.tokens));
    p.tally(turnId, { refused: 1 });
    p.frame({ type: "action", turn: turnId, id: e.id, tool: e.tool, status: "failed", code: "ACTION_DENIED" });
  }

  private async addCard(turnId: string, e: CardEffect): Promise<void> {
    const p = this.p;
    if (p.cards.add(turnId, e, p.now())) p.tally(turnId, { pending: 1 });
    await p.journal(this.row(e.id, e.descriptor, "ask", e.decision.grantId, "PENDING", turnId, e.tokens));
    traceApproval({ conversation: p.chatId, tool: e.tool, actionKind: e.descriptor.actionKind, state: "requested" });
    p.frame({ type: "card", turn: turnId, card: this.view(p.cards.get(e.id) as CardRow) });
  }

  view(c: CardRow) {
    return renderCard(c, this.p.nameOf, this.p.label(c.tool));
  }

  /**
   * Decides cards: `by.agent` is an agent session, which never decides. A refused attempt is
   * journaled under the one who tried, so an admin's attempt on a person's action is on record.
   */
  async decide(ids: string[], by: { person: string; agent: boolean }, choice: Choice): Promise<DecideResult[]> {
    const out: DecideResult[] = [];
    for (const id of ids) out.push(await this.decideOne(id, by, choice));
    return out;
  }

  private refuse(id: string, code: string): DecideResult {
    return { id, ok: false, code, text: decideText(code) };
  }

  /** A card already decided: the first decision's outcome, said again. */
  private answer(c: CardRow): DecideResult {
    return { id: c.id, ok: true, state: c.state, grantId: c.grantId, outcome: c.outcome ?? "", card: this.view(c), again: true };
  }

  /**
   * One decision per card (M20.1, QYVR-172): who may decide is checked first, so a refusal never says
   * how a card was decided; then a decision still running here is awaited and its answer given, a card
   * already decided gives its stored outcome, and only the decision that claims the pending card runs.
   */
  private async decideOne(id: string, by: { person: string; agent: boolean }, choice: Choice): Promise<DecideResult> {
    const p = this.p;
    const card = p.cards.get(id);
    if (!card) return this.refuse(id, "CARD_UNKNOWN");
    const d = card.descriptor;
    const company = d.subject.scope === "company";
    const refused = by.agent ? "APPROVAL_AGENT_REFUSED" : company ? ((await p.company?.isAdmin(by.person)) ? null : "APPROVAL_NOT_APPROVER") : by.person === d.principal ? null : "APPROVAL_NOT_PRINCIPAL";
    if (refused) {
      const actor = `${by.agent ? "agent" : "person"}:${by.person}`;
      // Every attempt is its own row: two by one person in the same instant are two attempts.
      await p.journal(this.row(`${id}:attempt:${crypto.randomUUID()}`, d, "deny", null, refused, card.turnId, 0, actor));
      log("approval.refused", { chat: p.chatId, card: id, code: refused });
      return this.refuse(id, refused);
    }
    // From here to the claim nothing is awaited, so no other decision on this card can come between.
    const running = p.inflight.get(id);
    if (running) {
      const first = await running;
      return first.ok ? { ...first, again: true } : first;
    }
    const now = p.cards.get(id) as CardRow;
    if (now.state === "deciding") return this.track(id, this.run(now, now.choice as Choice, now.decidedBy ?? by.person));
    if (now.state !== "pending") return this.answer(now);
    if (!choicesFor(d).includes(choice)) return this.refuse(id, d.purchase ? "PURCHASE_NOT_LASTING" : needsFreshCard(d.actionKind) ? "SHARE_NOT_LASTING" : "CHOICE_INVALID");
    p.cards.claim(id, { choice, by: by.person, at: p.now() });
    p.frame({ type: "card", turn: now.turnId, card: this.view(p.cards.get(id) as CardRow) });
    return this.track(id, this.run(now, choice, by.person));
  }

  private async track(id: string, run: Promise<DecideResult>): Promise<DecideResult> {
    this.p.inflight.set(id, run);
    try {
      return await run;
    } finally {
      this.p.inflight.delete(id);
    }
  }

  /** Runs a claimed card's decision once: the grant (kept on the card, so a decision taken up again reuses it), the commit, the action. */
  private async run(card: CardRow, choice: Choice, person: string): Promise<DecideResult> {
    const p = this.p;
    const { id, descriptor: d } = card;
    const company = d.subject.scope === "company";
    const at = p.now();
    const done = (state: CardState, grantId: string | null, outcome: string): DecideResult => {
      p.cards.decide(id, { state, choice, by: person, at, grantId, outcome });
      const now = p.cards.get(id) as CardRow;
      p.frame({ type: "card", turn: card.turnId, card: this.view(now) });
      return { id, ok: true, state, grantId, outcome, card: this.view(now) };
    };
    if (choice === "deny") {
      const r = done("declined", null, "DECLINED");
      await p.journal(this.row(`${id}:decision`, d, "deny", null, "DECLINED", card.turnId, 0, `person:${person}`));
      traceApproval({ conversation: p.chatId, tool: card.tool, actionKind: d.actionKind, state: "denied" });
      p.note(id, `${p.nameOf(person)} declined the proposal on card ${id} (${d.actionKind}). It did not run, and the decision is final.`);
      await this.finish(card, "declined");
      return r;
    }
    let grantId = card.grantId;
    if (!grantId) {
      const input = grantFor(card, choice, p.tenant, at);
      const created = company ? await p.company?.createGrant(person, input) : await p.authority?.(d.principal).createGrant(person, input);
      if (!created?.ok) {
        // No grant was made, so nothing can have run: the card waits again for a decision.
        p.cards.release(id);
        p.frame({ type: "card", turn: card.turnId, card: this.view(p.cards.get(id) as CardRow) });
        return this.refuse(id, created?.code ?? "GRANTS_UNAVAILABLE");
      }
      grantId = created.grant.id;
      p.cards.setGrant(id, grantId);
    }
    // The approval is a grant; the action runs under it like any other automatic action. The owning store
    // records one use per effect id and refuses a second, so the action cannot run twice for one card.
    const now = { ...d, at: p.now() };
    const decision = (await p.authority?.(d.principal).commit(now, `${p.chatId}:${id}`, card.args)) ?? { decision: "deny" as const, step: "none" as const, code: "GRANTS_UNAVAILABLE" };
    if (decision.decision !== "auto") {
      const r = done("failed", grantId, decision.code);
      await p.journal(this.row(`${id}:decision`, now, decision.decision, decision.grantId, decision.code, card.turnId));
      p.note(id, `${p.nameOf(person)} allowed the proposal on card ${id} (${d.actionKind}); it did not run (${decision.code}).`);
      await this.finish(card, "not done");
      return r;
    }
    const r = await p.session(contextOf(d)).perform(id, card.tool, card.args, decision.grantId);
    const outcome = r.ok ? "DONE" : (r.code ?? "ACTION_FAILED");
    const result = done(r.ok ? "approved" : "failed", decision.grantId as string, outcome);
    await p.journal(this.row(`${id}:decision`, now, "auto", decision.grantId, outcome, card.turnId));
    traceApproval({ conversation: p.chatId, tool: card.tool, actionKind: d.actionKind, state: "approved" });
    p.note(id, `${p.nameOf(person)} allowed the proposal on card ${id} (${d.actionKind}); ${r.ok ? "it ran" : `it failed with ${outcome}`}.${r.text ? `\n${fence(`tool:${card.tool}`, r.text)}` : ""}`);
    p.frame({ type: "action", turn: card.turnId, id, tool: card.tool, status: r.ok ? "done" : "failed", ...(r.ok ? {} : { code: outcome }) });
    await this.finish(card, r.ok ? "done" : "not done");
    return result;
  }

  private async finish(card: CardRow, how: string): Promise<void> {
    const d = card.descriptor;
    if (d.counterpart.kind !== "own-agent" && this.p.reply) {
      await this.p.reply(card, `${agentLabel(this.p.nameOf(d.principal))}: an update on your request: ${how}.`);
    }
  }
}

/** The label every agent message carries (A6): the person's name and that it is an agent. */
export const agentLabel = (name: string) => `${name}'s agent (AI agent acting for ${name})`;

/**
 * The reply to a colleague's request, written by code alone: whether it was done, is pending with the
 * person, or was not done, without saying what was withheld or why (B2). The model's words never reach
 * the colleague; what may be disclosed to them is M10's disclosure gate.
 */
export function requestReply(principalName: string, t: Tally): { status: "done" | "pending" | "partial" | "not_done"; text: string } {
  const label = agentLabel(principalName);
  if (t.done > 0 && t.pending === 0 && t.refused === 0) return { status: "done", text: `${label}: done.` };
  if (t.done > 0) return { status: "partial", text: `${label}: partly done; the rest is pending with ${principalName}.` };
  if (t.pending > 0 || t.refused === 0) return { status: "pending", text: `${label}: your request is pending with ${principalName}.` };
  return { status: "not_done", text: `${label}: this was not done.` };
}
