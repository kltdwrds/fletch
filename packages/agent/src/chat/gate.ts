// The code gate (M7.1, authority-model.md): every tool call that reaches outside the person's own
// stores, and every read of a company resource, becomes an action descriptor with its origin and
// hops, and the grants engine in the principal's `Person` decides. The model proposes; this decides
// what the model is told and what is queued. Automatic actions are queued to run after the barrier,
// where the commit decides again and the journal row cites the grant. Anything that asks becomes an
// approval card: simulated when the connector can project the call and the task is the person's
// own, otherwise the turn pauses for the decision (`awaitDecision`). A restricted observation sets
// the task's latch, after which no grant applies automatically and nothing is forwarded.
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { CreateResult } from "../grants/store.ts";
import { needsFreshCard } from "../grants/engine.ts";
import { parseSubjectRef, subjectRef } from "../grants/journal.ts";
import type { Decision, Descriptor, Party } from "../grants/types.ts";
import type { Gate, ToolSpec } from "../tools/registry.ts";
import { type EffectBuffer, queuedText } from "./tools.ts";

/** Who the turn works for and who asked: the person's own task, or a colleague's request. */
export interface TurnContext {
  counterpart: Party;
  origin: string;
  hops: number;
  request?: { id: string; from: string; viaAgent: boolean; replyTo?: { person: string; chatId: string } };
}

export const ownTask = (principal: string): TurnContext => ({ counterpart: { kind: "own-agent" }, origin: principal, hops: 0 });

/** The principal's decision point on their `Person` (`grants/authority.ts`), over RPC. */
export interface AuthorityApi {
  decide(d: Descriptor): Promise<Decision>;
  /** `args` are the proposal's, so a credential the action names is granted once with it (M14.2). */
  commit(d: Descriptor, effectId: string, args?: Record<string, unknown>): Promise<Decision>;
  createGrant(by: string, input: unknown): Promise<CreateResult>;
}

/** The chat's view the gate needs: the task's latch, its cards, whether outside content was read. */
export interface GateState {
  latched(): boolean;
  latch(source: string): void;
  /** A card for this proposal is pending, or was denied, in this chat. */
  card(fingerprint: string): "pending" | "denied" | null;
  sawExternal: boolean;
  /** Set when a proposal must wait for its decision: the turn ends after this step. */
  awaiting: boolean;
}

/** A stable, short fingerprint of one proposal, so the same ask is one card and a denial is final. */
export function fingerprint(tool: string, args: Record<string, unknown>): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  let h = 0x811c9dc5;
  for (const ch of `${tool}:${JSON.stringify(canon(args))}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `${tool}:${h.toString(16).padStart(8, "0")}`;
}

const text = (t: string, details: Record<string, unknown> = {}): AgentToolResult<unknown> => ({ content: [{ type: "text", text: t }], details });

export interface GateOptions {
  principal: string;
  context: TurnContext;
  authority?: AuthorityApi;
  effects: EffectBuffer;
  state: GateState;
  now: () => number;
  /** A member's display name for the words the gate writes. */
  nameOf: (email: string) => string;
}

export class ChatGate implements Gate {
  private readonly o: GateOptions;

  constructor(o: GateOptions) {
    this.o = o;
  }

  descriptor(spec: ToolSpec, args: Record<string, unknown>): Descriptor {
    const { principal, context } = this.o;
    const subject = { scope: "personal" as const, ...(spec.subject?.(args) ?? {}) };
    const amount = spec.amount?.(args);
    const recipients = spec.recipients?.(args);
    return {
      actor: `agent:${principal}`,
      principal,
      actionKind: spec.actionKind ?? `tool.${spec.name}`,
      subject: { ...subject, ref: subjectRef({ ...subject, ref: "" }) },
      counterpart: context.counterpart,
      ...(amount ? { amount } : {}),
      ...(recipients ? { recipients } : {}),
      origin: context.origin,
      hops: context.hops,
      ...(this.o.state.latched() ? { restricted: true } : {}),
      ...(spec.forwardsToAgent ? { forwardsToAgent: true } : {}),
      ...(spec.purchase ? { purchase: true } : {}),
      at: this.o.now(),
    };
  }

  async call(spec: ToolSpec, id: string, args: Record<string, unknown>, run: () => Promise<AgentToolResult<unknown>>): Promise<AgentToolResult<unknown>> {
    const { context, state } = this.o;
    const own = context.counterpart.kind === "own-agent";
    if (spec.refuses) {
      // Refused in code, never by a grant: the row records the attempt with identifiers alone, and the
      // tool runs only to show the person where they decide and to tell the model it was refused.
      const d = this.descriptor(spec, args);
      const decision: Decision = { decision: "deny", step: "none", code: spec.refuses };
      if (parseSubjectRef(d.subject.ref)) this.o.effects.push({ kind: "refusal", id, tool: spec.name, descriptor: d, decision, outcome: spec.refuses, code: spec.refuses });
      return run();
    }
    const gated = spec.kind === "action" || spec.subject?.(args).scope === "company";
    if (!gated) {
      if (spec.mutates && !own) return text(`REQUEST_CANNOT_WRITE: ${spec.name} changes ${this.o.nameOf(this.o.principal)}'s own records, which a colleague's request never does`, { code: "REQUEST_CANNOT_WRITE" });
      const result = await run();
      // Words a tool wrote in code for the person (not model text) are delivered once with the step, so
      // a turn that pauses on a card with no reply still says them (M19.2).
      const announce = (result.details as { announce?: unknown } | undefined)?.announce;
      if (typeof announce === "string" && announce) this.o.effects.push({ kind: "deliver", id: `${id}:announce`, text: announce });
      if ((result.details as { sensitivity?: unknown } | undefined)?.sensitivity === "restricted") state.latch(spec.name);
      if (spec.external) state.sawExternal = true;
      return result;
    }
    const authority = this.o.authority;
    if (!authority) return text(`GRANTS_UNAVAILABLE: ${spec.name} needs the grants engine, which this chat does not have`, { code: "GRANTS_UNAVAILABLE" });
    if (spec.kind === "action" && !spec.actionKind) return text(`ACTION_KIND_MISSING: ${spec.name} names no action kind, so no grant can cover it`, { code: "ACTION_KIND_MISSING" });

    const d = this.descriptor(spec, args);
    // The journal holds only identifiers (`grants/journal.ts`). A subject it cannot hold would let the
    // action run with no row to cite its grant, so the call is refused here, before anything is decided
    // or queued, using the journal's own rule rather than a copy of it.
    if (!parseSubjectRef(d.subject.ref)) {
      return text(`SUBJECT_NOT_RECORDABLE: ${spec.name} names a resource that is not a plain identifier (letters, digits and . _ @ : / -, at most 120 characters); nothing was done, so retry with the resource's id`, { code: "SUBJECT_NOT_RECORDABLE" });
    }
    const fp = fingerprint(spec.name, args);
    const earlier = state.card(fp);
    if (earlier === "denied") {
      const decision: Decision = { decision: "deny", step: "match", code: "DECIDED_BEFORE" };
      this.o.effects.push({ kind: "refusal", id, tool: spec.name, descriptor: d, decision, outcome: "DENIED_BEFORE" });
      return text(`ACTION_DENIED: ${this.o.nameOf(this.o.principal)} already declined this; a decision is final`, { code: "ACTION_DENIED", reason: "DENIED_BEFORE" });
    }
    if (earlier === "pending") {
      state.awaiting = true;
      return text(`AWAITING_DECISION: this already waits for ${this.who(d)}'s decision; nothing more happens until then`, { code: "AWAITING_DECISION" });
    }

    let decision = await authority.decide(d);
    // A fresh-card kind (a public share link, M24.3) is never run on a proposal: even a card's one-shot grant
    // left unused from before does not carry it. It always asks, and only its own card's approval runs it.
    if (decision.decision === "auto" && needsFreshCard(d.actionKind)) decision = { decision: "ask", step: "none", code: "FRESH_CARD_REQUIRED", route: { kind: "principal", id: d.principal } };
    if (decision.decision === "deny") {
      this.o.effects.push({ kind: "refusal", id, tool: spec.name, descriptor: d, decision, outcome: "DENIED" });
      return text(`ACTION_DENIED: ${decision.code}; this is not done and not to be tried another way`, { code: "ACTION_DENIED", reason: decision.code });
    }
    if (decision.decision === "auto") {
      if (spec.kind === "action") {
        this.o.effects.push({ kind: "action", id, tool: spec.name, args, descriptor: d, ...(await this.detail(spec, args)) });
        return text(queuedText(id, decision.grantId as string), { queued: id, grant: decision.grantId });
      }
      const result = await run();
      this.o.effects.push({ kind: "journal", id, tool: spec.name, descriptor: d, decision, outcome: "DONE" });
      if (spec.external) state.sawExternal = true;
      return result;
    }
    // Ask: a card the harness renders. Simulated only for the person's own task, unlatched, with
    // the person as approver and a connector that can project the call.
    const simulated = spec.kind === "action" && !!spec.project && own && context.hops === 0 && !d.restricted && decision.route?.kind === "principal";
    const flag = d.restricted ? "RESTRICTED_LATCH" : !own ? "REQUEST_OUTSIDE_GRANTS" : state.sawExternal ? "AFTER_EXTERNAL_INPUT" : null;
    this.o.effects.push({ kind: "card", id, tool: spec.name, args, descriptor: d, decision, simulated, flag, fingerprint: fp, ...(await this.detail(spec, args)) });
    if (simulated) return text((spec.project as NonNullable<ToolSpec["project"]>)(args), { simulated: true });
    state.awaiting = true;
    return text(`AWAITING_DECISION: ${this.who(d)} decides whether this runs; this turn stops here and continues once they decide`, { code: "AWAITING_DECISION" });
  }

  /** The card's own lines for a call, read at the proposal; a tool that cannot say adds none, never fails the proposal. */
  private async detail(spec: ToolSpec, args: Record<string, unknown>): Promise<{ detail?: string[] }> {
    if (!spec.cardLines) return {};
    try {
      const lines = await spec.cardLines(args);
      return lines.length ? { detail: lines } : {};
    } catch {
      return {};
    }
  }

  private who(d: Descriptor): string {
    return d.subject.scope === "company" ? "an admin of the company" : this.o.nameOf(this.o.principal);
  }
}
