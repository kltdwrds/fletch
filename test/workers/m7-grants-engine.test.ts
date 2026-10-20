// M7.1: the grants engine as a pure module (AD-22). The resolution scenario table of
// authority-model.md is the fixture, row by row, with three opaque principals standing in for the
// table's names: the owner, a colleague, and the two-hop origin. The engine compares principals and
// never reads an address, so no fixture identity is needed. Every step of the ordered resolution has
// its own planted case beside the table.
import { describe, expect, it } from "vitest";
import { inGrantWindow } from "../../packages/agent/src/grants/constraints.ts";
import { resolve } from "../../packages/agent/src/grants/engine.ts";
import type { CompanyView, Descriptor, Grant, Policy } from "../../packages/agent/src/grants/types.ts";
import { checkGrant } from "../../packages/agent/src/grants/validate.ts";

const OWNER = "principal-owner"; // the table's first person
const COLLEAGUE = "principal-colleague"; // the table's second person
const ORIGIN = "principal-origin"; // the table's third person
// Tuesday 13 October 2026, 10:00 UTC, and 23:00 UTC the same day.
const WORK = Date.UTC(2026, 9, 13, 10, 0);
const NIGHT = Date.UTC(2026, 9, 13, 23, 0);

const view = (policies: Policy[] = [], teams: Record<string, string[]> = {}): CompanyView => ({
  roleOf: (p) => (p === OWNER ? "member" : p === COLLEAGUE || p === ORIGIN ? "member" : null),
  teamsOf: (p) => Object.entries(teams).filter(([, m]) => m.includes(p)).map(([t]) => t),
  policies,
  approverRole: "admin",
});

let n = 0;
const grant = (g: Partial<Grant> & Pick<Grant, "grantor" | "grantee" | "subject" | "mode">): Grant => ({
  id: `g_${(++n).toString(16).padStart(32, "0")}`,
  tenant: "solo-sam",
  constraints: {},
  created_from: "approval-card",
  created_at: WORK - 86_400_000,
  ...g,
});
const by = (id: string) => ({ kind: "person" as const, id });
const kind = (ref: string) => ({ kind: "action-kind" as const, ref });
const desc = (d: Partial<Descriptor> & Pick<Descriptor, "principal" | "actionKind" | "counterpart">): Descriptor => ({
  actor: `agent:${d.principal}`,
  subject: { scope: "personal", ref: "personal" },
  origin: d.counterpart.kind === "own-agent" ? d.principal : d.counterpart.id,
  hops: 0,
  at: WORK,
  ...d,
});
const workHours = { window: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", timeZone: "UTC" } };

describe("[M7.1] grants engine: the resolution scenario table", () => {
  it("specific auto beats general deny: tiers are exclusive, the person tier matches first", () => {
    const auto = grant({ grantor: by(OWNER), grantee: { kind: "person", id: COLLEAGUE }, subject: kind("calendar.move"), mode: "auto" });
    const deny = grant({ grantor: by(OWNER), grantee: { kind: "any-member" }, subject: kind("calendar.move"), mode: "deny" });
    const r = resolve(desc({ principal: OWNER, actionKind: "calendar.move", counterpart: { kind: "person", id: COLLEAGUE } }), [deny, auto], view());
    expect(r).toMatchObject({ decision: "auto", grantId: auto.id, step: "match" });
  });

  it("deny in the same tier wins", () => {
    const auto = grant({ grantor: by(OWNER), grantee: { kind: "person", id: COLLEAGUE }, subject: kind("calendar.move"), mode: "auto" });
    const deny = grant({ grantor: by(OWNER), grantee: { kind: "person", id: COLLEAGUE }, subject: kind("calendar.move"), mode: "deny" });
    expect(resolve(desc({ principal: OWNER, actionKind: "calendar.move", counterpart: { kind: "person", id: COLLEAGUE } }), [auto, deny], view())).toMatchObject({ decision: "deny", grantId: deny.id, code: "GRANT_DENIES" });
  });

  it("a failing constraint turns auto into ask: the work-hours grant at 23:00", () => {
    const auto = grant({ grantor: by(OWNER), grantee: { kind: "person", id: COLLEAGUE }, subject: kind("calendar.move"), mode: "auto", constraints: workHours });
    const d = desc({ principal: OWNER, actionKind: "calendar.move", counterpart: { kind: "person", id: COLLEAGUE } });
    expect(resolve(d, [auto], view())).toMatchObject({ decision: "auto", grantId: auto.id });
    expect(resolve({ ...d, at: NIGHT }, [auto], view())).toMatchObject({ decision: "ask", grantId: auto.id, code: "GRANT_CONSTRAINT_FAILED", route: { kind: "principal", id: OWNER } });
  });

  it("company cap: a policy denying payments.refund for members denies the refund", () => {
    const policy: Policy = { id: "p_refunds", kind: "deny-action", actionKind: "payments.refund", role: "member" };
    const companyGrant = grant({ grantor: { kind: "company", id: "solo-sam" }, grantee: { kind: "any-member" }, subject: { kind: "connector", ref: "payments" }, mode: "auto" });
    const d = desc({ principal: OWNER, actionKind: "payments.refund", counterpart: { kind: "person", id: COLLEAGUE }, subject: { scope: "company", connector: "payments", ref: "company;connector:payments" } });
    expect(resolve(d, [companyGrant], view([policy]))).toMatchObject({ decision: "deny", policyId: "p_refunds", step: "policy" });
  });

  it("a company resource with no company grant asks, routed to the admin role", () => {
    const d = desc({ principal: OWNER, actionKind: "books.read", counterpart: { kind: "own-agent" }, subject: { scope: "company", connector: "books", ref: "company;connector:books" } });
    expect(resolve(d, [], view())).toMatchObject({ decision: "ask", step: "policy", code: "COMPANY_RESOURCE_UNGRANTED", route: { kind: "role", role: "admin" } });
  });

  it("one hop: Bo's grant to Ada covers Ada's agent asking Bo's agent", () => {
    const g = grant({ grantor: by(COLLEAGUE), grantee: { kind: "person", id: OWNER }, subject: kind("reports.read"), mode: "auto" });
    const d = desc({ principal: COLLEAGUE, actionKind: "reports.read", counterpart: { kind: "agent-of-person", id: OWNER }, origin: OWNER, hops: 1 });
    expect(resolve(d, [g], view())).toMatchObject({ decision: "auto", grantId: g.id });
  });

  it("two hops: at most ask, and Bo's grant names Ada, not the origin, so no match", () => {
    const boToAda = grant({ grantor: by(COLLEAGUE), grantee: { kind: "person", id: OWNER }, subject: kind("reports.read"), mode: "auto" });
    const adaToSam = grant({ grantor: by(OWNER), grantee: { kind: "person", id: ORIGIN }, subject: kind("reports.read"), mode: "auto" });
    const d = desc({ principal: COLLEAGUE, actionKind: "reports.read", counterpart: { kind: "agent-of-person", id: OWNER }, origin: ORIGIN, hops: 2 });
    expect(resolve(d, [boToAda, adaToSam], view())).toMatchObject({ decision: "ask", step: "none", code: "NO_GRANT" });
  });

  it("purchase: a lasting purchase grant is invalid at creation and never matches; the purchase asks", () => {
    expect(checkGrant({ grantor: by(OWNER), grantee: { kind: "own-agent" }, subject: kind("purchase"), mode: "auto", created_from: "approval-card" }, by(OWNER), WORK)).toMatchObject({ ok: false, code: "GRANT_PURCHASE_LASTING" });
    const stored = grant({ grantor: by(OWNER), grantee: { kind: "own-agent" }, subject: kind("purchase"), mode: "auto" });
    const d = desc({ principal: OWNER, actionKind: "purchase", counterpart: { kind: "own-agent" }, purchase: true });
    expect(resolve(d, [stored], view())).toMatchObject({ decision: "ask", code: "NO_GRANT" });
    // A one-shot purchase grant (allow once) is the only automatic purchase.
    const once = grant({ grantor: by(OWNER), grantee: { kind: "own-agent" }, subject: kind("purchase"), mode: "auto", one_shot: true });
    expect(resolve(d, [stored, once], view())).toMatchObject({ decision: "auto", grantId: once.id, oneShot: true });
  });
});

describe("[M7.1] grants engine: each step planted", () => {
  const boAuto = () => grant({ grantor: by(OWNER), grantee: { kind: "person", id: COLLEAGUE }, subject: kind("calendar.move"), mode: "auto" });
  const fromBo = (extra: Partial<Descriptor> = {}) => desc({ principal: OWNER, actionKind: "calendar.move", counterpart: { kind: "person", id: COLLEAGUE }, ...extra });

  it("no match asks the principal; a person's own task needs an own-agent grant", () => {
    expect(resolve(fromBo(), [], view())).toMatchObject({ decision: "ask", code: "NO_GRANT", route: { kind: "principal", id: OWNER } });
    const own = desc({ principal: OWNER, actionKind: "notes.post", counterpart: { kind: "own-agent" } });
    expect(resolve(own, [boAuto()], view())).toMatchObject({ decision: "ask", code: "NO_GRANT" });
    const ownGrant = grant({ grantor: by(OWNER), grantee: { kind: "own-agent" }, subject: kind("notes.*"), mode: "auto" });
    expect(resolve(own, [ownGrant], view())).toMatchObject({ decision: "auto", grantId: ownGrant.id });
  });

  it("only grants the principal signed decide a personal action", () => {
    const signedByBo = grant({ grantor: by(COLLEAGUE), grantee: { kind: "person", id: COLLEAGUE }, subject: kind("calendar.move"), mode: "auto" });
    expect(resolve(fromBo(), [signedByBo], view())).toMatchObject({ decision: "ask", code: "NO_GRANT" });
  });

  it("past a hop a grant matches the origin, not the last agent", () => {
    const g = grant({ grantor: by(OWNER), grantee: { kind: "agent-of-person", id: COLLEAGUE }, subject: kind("calendar.move"), mode: "auto" });
    // Bo's agent forwards a request whose origin is Sam: Ada's grant to Bo's agent does not reach Sam.
    expect(resolve(fromBo({ counterpart: { kind: "agent-of-person", id: COLLEAGUE }, origin: ORIGIN, hops: 1 }), [g], view())).toMatchObject({ decision: "ask", code: "NO_GRANT" });
    expect(resolve(fromBo({ counterpart: { kind: "agent-of-person", id: COLLEAGUE }, origin: COLLEAGUE, hops: 1 }), [g], view())).toMatchObject({ decision: "auto", grantId: g.id });
  });

  it("two hops with a grant naming the origin is still at most ask", () => {
    const g = grant({ grantor: by(OWNER), grantee: { kind: "any-member" }, subject: kind("calendar.move"), mode: "auto" });
    expect(resolve(fromBo({ counterpart: { kind: "agent-of-person", id: ORIGIN }, origin: COLLEAGUE, hops: 2 }), [g], view())).toMatchObject({ decision: "ask", step: "chain", code: "CHAIN_AT_MOST_ASK", grantId: g.id });
  });

  it("a company policy never caps a person's own resources", () => {
    const policy: Policy = { id: "p_moves", kind: "deny-action", actionKind: "calendar.move" };
    const g = boAuto();
    expect(resolve(fromBo(), [g], view([policy]))).toMatchObject({ decision: "auto", grantId: g.id });
  });

  it("team and company tiers sit below the person tier", () => {
    const team = grant({ grantor: by(OWNER), grantee: { kind: "team", id: "ops" }, subject: kind("calendar.move"), mode: "deny" });
    const company = grant({ grantor: by(OWNER), grantee: { kind: "company" }, subject: kind("calendar.move"), mode: "auto" });
    expect(resolve(fromBo(), [team, company], view([], { ops: [COLLEAGUE] }))).toMatchObject({ decision: "deny", grantId: team.id });
    expect(resolve(fromBo(), [team, company], view())).toMatchObject({ decision: "auto", grantId: company.id });
  });

  it("expired, revoked and spent one-shot grants do not apply", () => {
    const expired = grant({ ...boAuto(), expires_at: WORK - 1 });
    const revoked = grant({ ...boAuto(), id: "g_".padEnd(34, "a"), revoked_at: WORK - 1 });
    const spent = grant({ ...boAuto(), id: "g_".padEnd(34, "b"), one_shot: true, used_at: WORK - 1 });
    expect(resolve(fromBo(), [expired, revoked, spent], view())).toMatchObject({ decision: "ask", code: "NO_GRANT" });
  });

  it("the latch: no grant applies automatically, and nothing is forwarded to another agent", () => {
    const g = boAuto();
    expect(resolve(fromBo({ restricted: true }), [g], view())).toMatchObject({ decision: "ask", step: "latch", code: "LATCH_NO_AUTO" });
    const fwd = grant({ grantor: by(OWNER), grantee: { kind: "own-agent" }, subject: kind("colleagues.request"), mode: "auto" });
    const d = desc({ principal: OWNER, actionKind: "colleagues.request", counterpart: { kind: "own-agent" }, forwardsToAgent: true });
    expect(resolve(d, [fwd], view())).toMatchObject({ decision: "auto" });
    expect(resolve({ ...d, restricted: true }, [fwd], view())).toMatchObject({ decision: "deny", code: "LATCH_NO_FORWARDING" });
  });

  it("amount, recipients, resources and rate constraints each turn auto into ask", () => {
    const g = (constraints: Grant["constraints"]) => grant({ ...boAuto(), constraints });
    const amount = g({ max_amount: { value: 100, currency: "EUR" } });
    expect(resolve(fromBo({ amount: { value: 80, currency: "EUR" } }), [amount], view()).decision).toBe("auto");
    expect(resolve(fromBo({ amount: { value: 120, currency: "EUR" } }), [amount], view()).decision).toBe("ask");
    expect(resolve(fromBo({ amount: { value: 80, currency: "USD" } }), [amount], view()).decision).toBe("ask");
    const recipients = g({ recipients: [COLLEAGUE] });
    expect(resolve(fromBo({ recipients: [COLLEAGUE] }), [recipients], view()).decision).toBe("auto");
    expect(resolve(fromBo({ recipients: [COLLEAGUE, ORIGIN] }), [recipients], view()).decision).toBe("ask");
    const resources = g({ resources: ["evt-1"] });
    expect(resolve(fromBo({ subject: { scope: "personal", resource: "evt-1", ref: "x" } }), [resources], view()).decision).toBe("auto");
    expect(resolve(fromBo({ subject: { scope: "personal", resource: "evt-2", ref: "x" } }), [resources], view()).decision).toBe("ask");
    const rate = g({ rate: { count: 2, perSeconds: 3600 } });
    expect(resolve(fromBo(), [rate], view(), { [rate.id]: [WORK - 60_000] }).decision).toBe("auto");
    expect(resolve(fromBo(), [rate], view(), { [rate.id]: [WORK - 60_000, WORK - 30_000] }).decision).toBe("ask");
  });

  it("a window is read in its own zone", () => {
    const w = { days: [2], from: "09:00", to: "17:00", timeZone: "Pacific/Auckland" };
    // 10:00 UTC Tuesday is 23:00 Tuesday in Auckland: outside; 22:00 UTC Monday is 11:00 Tuesday there.
    expect(inGrantWindow(WORK, w)).toBe(false);
    expect(inGrantWindow(Date.UTC(2026, 9, 12, 22, 0), w)).toBe(true);
  });
});

describe("[M7.1] grant creation rules", () => {
  const base = { grantee: { kind: "person", id: COLLEAGUE }, subject: kind("calendar.move"), mode: "auto", created_from: "approval-card" };

  it("purchases under any action-kind ref are never lasting", () => {
    for (const ref of ["purchase", "purchase.*", "travel.purchase"]) {
      expect(checkGrant({ ...base, grantor: by(OWNER), grantee: { kind: "own-agent" }, subject: kind(ref) }, by(OWNER), WORK)).toMatchObject({ ok: false, code: "GRANT_PURCHASE_LASTING" });
      expect(checkGrant({ ...base, grantor: by(OWNER), grantee: { kind: "own-agent" }, subject: kind(ref), one_shot: true }, by(OWNER), WORK)).toMatchObject({ ok: true });
    }
  });
});
