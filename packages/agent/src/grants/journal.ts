// Journal rows (authority-model.md "The journal"): timestamp, actor, action kind, subject reference,
// counterpart, the grant id or decision, outcome code, run id and tokens, plus the origin and hop count
// a request carried (the worked scenario's "both journals show the hop"). Nothing else: every field is
// an identifier or a code, checked here before the Ledger stores it, so no message text, query, file
// content or mail body can enter a row. Memory tools are never journaled.
import { REF } from "./validate.ts";
import type { Descriptor, Mode, Party } from "./types.ts";

export interface JournalRow {
  /** The effect or decision id; a row is written once per id. */
  id: string;
  at: number;
  /** `agent:<person>` for an agent acting, `person:<person>` for a person deciding. */
  actor: string;
  principal: string;
  actionKind: string;
  /** `subjectRef(descriptor.subject)`. */
  subjectRef: string;
  /** `own-agent`, `person:<address>` or `agent:<address>`. */
  counterpart: string;
  origin: string;
  hops: number;
  decision: Mode;
  grantId: string | null;
  outcome: string;
  runId: string;
  tokens: number;
}

const EMAIL = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const PART = /^(connector|resource|skill|memory-scope):[A-Za-z0-9._@:/-]{1,120}$/;
export const OUTCOME = /^[A-Z][A-Z0-9_]{1,60}$/;
export const GRANT_ID = /^g_[0-9a-f]{32}$/;
const RUN = /^[A-Za-z0-9:._@-]{1,200}$/;

/** The subject as one content-free reference: its scope and the ids it names. */
export function subjectRef(s: Descriptor["subject"]): string {
  const parts = [s.connector && `connector:${s.connector}`, s.resource && `resource:${s.resource}`, s.skill && `skill:${s.skill}`, s.memoryScope && `memory-scope:${s.memoryScope}`].filter(Boolean);
  return [s.scope, ...parts].join(";");
}

/** The inverse of `subjectRef`; null when the reference is not one. */
export function parseSubjectRef(ref: string): Descriptor["subject"] | null {
  const [scope, ...parts] = ref.split(";");
  if (scope !== "personal" && scope !== "company") return null;
  const subject: Descriptor["subject"] = { scope, ref };
  for (const p of parts) {
    if (!PART.test(p)) return null;
    const i = p.indexOf(":");
    const [k, v] = [p.slice(0, i), p.slice(i + 1)];
    if (k === "connector") subject.connector = v;
    if (k === "resource") subject.resource = v;
    if (k === "skill") subject.skill = v;
    if (k === "memory-scope") subject.memoryScope = v;
  }
  return subject;
}

export function partyRef(p: Party): string {
  return p.kind === "own-agent" ? "own-agent" : p.kind === "person" ? `person:${p.id}` : `agent:${p.id}`;
}

export function parseParty(ref: string): Party | null {
  if (ref === "own-agent") return { kind: "own-agent" };
  const m = /^(person|agent):(.+)$/.exec(ref);
  if (!m || !EMAIL.test(m[2] as string)) return null;
  return m[1] === "person" ? { kind: "person", id: m[2] as string } : { kind: "agent-of-person", id: m[2] as string };
}

/** Every field an identifier or a code; a reason names the first that is not. */
export function checkJournalRow(r: JournalRow): { ok: true } | { ok: false; code: "JOURNAL_ROW_INVALID"; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, code: "JOURNAL_ROW_INVALID" as const, reason });
  if (!RUN.test(r.id)) return fail("id");
  if (!Number.isSafeInteger(r.at)) return fail("at");
  if (!/^(agent|person):/.test(r.actor) || !EMAIL.test(r.actor.slice(r.actor.indexOf(":") + 1))) return fail("actor");
  if (!EMAIL.test(r.principal) && r.principal !== "company") return fail("principal");
  if (!REF.test(r.actionKind)) return fail("actionKind");
  if (!parseSubjectRef(r.subjectRef)) return fail("subjectRef");
  if (!parseParty(r.counterpart)) return fail("counterpart");
  if (!EMAIL.test(r.origin)) return fail("origin");
  if (!Number.isInteger(r.hops) || r.hops < 0 || r.hops > 16) return fail("hops");
  if (!["auto", "ask", "deny"].includes(r.decision)) return fail("decision");
  if (r.grantId !== null && !GRANT_ID.test(r.grantId)) return fail("grantId");
  if (!OUTCOME.test(r.outcome)) return fail("outcome");
  if (!RUN.test(r.runId)) return fail("runId");
  if (!Number.isSafeInteger(r.tokens) || r.tokens < 0) return fail("tokens");
  return { ok: true };
}
