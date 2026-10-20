// Grant creation rules (authority-model.md "Who may grant what"): checked in code where the grant is
// stored, so a malformed or forbidden grant never exists. A person grants over their own agent and
// resources; the company grants over company resources through an admin; the platform grants nothing.
// Purchases never get a lasting grant.
import { validZone } from "../jobs/schedule.ts";
import { minutesOf } from "./constraints.ts";
import { cardGrant, isPurchaseKind, needsFreshCard } from "./engine.ts";
import type { Constraints, CreatedFrom, Grant, GranteeKind, Mode, SubjectKind } from "./types.ts";

export type GrantInput = Omit<Grant, "id" | "tenant" | "created_at" | "revoked_at" | "used_at">;
export type GrantCheck = { ok: true; grant: GrantInput } | { ok: false; code: string; reason: string };

const GRANTEES: GranteeKind[] = ["own-agent", "person", "agent-of-person", "team", "company", "any-member"];
const SUBJECTS: SubjectKind[] = ["action-kind", "connector", "resource", "skill", "memory-scope"];
const MODES: Mode[] = ["auto", "ask", "deny"];
const FROM: CreatedFrom[] = ["approval-card", "chat-confirmation", "admin-ui"];
/** An action kind or reference: an identifier, never text. */
export const REF = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*(\.\*)?$|^[a-z][a-z0-9_-]*:[A-Za-z0-9._@:/-]{1,120}$/;
const EMAIL = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

const bad = (code: string, reason: string): GrantCheck => ({ ok: false, code, reason });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkConstraints(c: unknown): { ok: true; value: Constraints } | { ok: false; reason: string } {
  if (c === undefined) return { ok: true, value: {} };
  if (!isObj(c)) return { ok: false, reason: "constraints must be an object" };
  const out: Constraints = {};
  for (const key of Object.keys(c)) if (!["window", "max_amount", "recipients", "resources", "rate"].includes(key)) return { ok: false, reason: `unknown constraint ${key}` };
  if (c.window !== undefined) {
    const w = c.window as Record<string, unknown>;
    const days = w?.days;
    if (!isObj(w) || !Array.isArray(days) || !days.length || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return { ok: false, reason: "window.days must list weekdays 0 to 6" };
    if (typeof w.from !== "string" || typeof w.to !== "string" || minutesOf(w.from) === null || minutesOf(w.to) === null) return { ok: false, reason: "window.from and window.to must be HH:MM" };
    if (!validZone(w.timeZone)) return { ok: false, reason: "window.timeZone must be an IANA zone" };
    out.window = { days: days as number[], from: w.from, to: w.to, timeZone: w.timeZone };
  }
  if (c.max_amount !== undefined) {
    const m = c.max_amount as Record<string, unknown>;
    if (!isObj(m) || typeof m.value !== "number" || !(m.value >= 0) || typeof m.currency !== "string" || !/^[A-Z]{3}$/.test(m.currency)) return { ok: false, reason: "max_amount needs a value and an ISO currency" };
    out.max_amount = { value: m.value, currency: m.currency };
  }
  if (c.recipients !== undefined) {
    if (!Array.isArray(c.recipients) || !c.recipients.every((r) => typeof r === "string" && EMAIL.test(r))) return { ok: false, reason: "recipients must be addresses" };
    out.recipients = c.recipients as string[];
  }
  if (c.resources !== undefined) {
    if (!Array.isArray(c.resources) || !c.resources.every((r) => typeof r === "string" && REF.test(r))) return { ok: false, reason: "resources must be ids" };
    out.resources = c.resources as string[];
  }
  if (c.rate !== undefined) {
    const r = c.rate as Record<string, unknown>;
    if (!isObj(r) || !Number.isInteger(r.count) || (r.count as number) < 1 || !Number.isInteger(r.perSeconds) || (r.perSeconds as number) < 1) return { ok: false, reason: "rate needs a positive count and perSeconds" };
    out.rate = { count: r.count as number, perSeconds: r.perSeconds as number };
  }
  return { ok: true, value: out };
}

/**
 * Validates a grant as `signer` would sign it: `person` signs as themselves, `company` only through
 * a caller the Company has already checked is an admin.
 */
export function checkGrant(input: unknown, signer: { kind: "person"; id: string } | { kind: "company"; id: string }, now: number): GrantCheck {
  if (!isObj(input)) return bad("GRANT_INVALID", "a grant is an object");
  const grantee = input.grantee as Record<string, unknown> | undefined;
  const subject = input.subject as Record<string, unknown> | undefined;
  if (!isObj(grantee) || !GRANTEES.includes(grantee.kind as GranteeKind)) return bad("GRANT_GRANTEE_INVALID", "unknown grantee kind");
  const needsId = ["person", "agent-of-person", "team"].includes(grantee.kind as string);
  if (needsId !== (typeof grantee.id === "string" && grantee.id.length > 0)) return bad("GRANT_GRANTEE_INVALID", needsId ? "this grantee needs an id" : "this grantee takes no id");
  if (needsId && grantee.kind !== "team" && !EMAIL.test(grantee.id as string)) return bad("GRANT_GRANTEE_INVALID", "a person grantee is named by address");
  if (signer.kind === "person" && grantee.kind !== "own-agent" && grantee.id === signer.id) return bad("GRANT_GRANTEE_INVALID", "a person's own agent is the own-agent grantee");
  if (!isObj(subject) || !SUBJECTS.includes(subject.kind as SubjectKind) || typeof subject.ref !== "string" || !REF.test(subject.ref)) return bad("GRANT_SUBJECT_INVALID", "a subject is a kind and an id");
  if (!MODES.includes(input.mode as Mode)) return bad("GRANT_MODE_INVALID", "mode is auto, ask or deny");
  if (!FROM.includes(input.created_from as CreatedFrom)) return bad("GRANT_SOURCE_INVALID", "created_from names a card, a chat confirmation or the admin UI");
  const constraints = checkConstraints(input.constraints);
  if (!constraints.ok) return bad("GRANT_CONSTRAINT_INVALID", constraints.reason);
  if (input.expires_at !== undefined && (typeof input.expires_at !== "number" || input.expires_at <= now)) return bad("GRANT_EXPIRY_INVALID", "an expiry is a future instant");
  if (input.one_shot !== undefined && typeof input.one_shot !== "boolean") return bad("GRANT_INVALID", "one_shot is a boolean");
  // The signer is who stores the grant, never what the input claims.
  const grantor = input.grantor as Record<string, unknown> | undefined;
  if (!isObj(grantor) || grantor.kind !== signer.kind || grantor.id !== signer.id) return bad("GRANT_GRANTOR_INVALID", "the grantor is the signer; the platform grants nothing");
  if (signer.kind === "company" && grantee.kind === "own-agent") return bad("GRANT_GRANTEE_INVALID", "the company has no agent");
  if (subject.kind === "action-kind" && isPurchaseKind(subject.ref as string) && input.mode === "auto" && input.one_shot !== true) {
    return bad("GRANT_PURCHASE_LASTING", "purchases never get a lasting grant");
  }
  // A public share link (M24.3) runs under the person's fresh approval card every time: no standing grant.
  if (subject.kind === "action-kind" && needsFreshCard(subject.ref as string) && input.mode === "auto" && !cardGrant({ one_shot: input.one_shot === true, created_from: input.created_from as CreatedFrom })) {
    return bad("GRANT_SHARE_LASTING", "a public share link is allowed only on its own approval card, never by a standing grant");
  }
  return {
    ok: true,
    grant: {
      grantor: { kind: signer.kind, id: signer.id },
      grantee: needsId ? { kind: grantee.kind as GranteeKind, id: grantee.id as string } : { kind: grantee.kind as GranteeKind },
      subject: { kind: subject.kind as SubjectKind, ref: subject.ref as string },
      mode: input.mode as Mode,
      constraints: constraints.value,
      ...(input.expires_at !== undefined ? { expires_at: input.expires_at as number } : {}),
      ...(input.one_shot ? { one_shot: true } : {}),
      created_from: input.created_from as CreatedFrom,
    },
  };
}
