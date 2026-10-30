// The grants engine (authority-model.md "Grants", AD-22): a pure function from one action descriptor
// and the grants and policies in force to deny, ask or auto, with the grant id it rests on. No model
// is involved and nothing a message says reaches it. The steps run in the model's order:
//   1. policy cap, 2. match at the most specific tier, 3. decide within the tier,
//   4. chains are at most ask, 5. no match asks the principal.
// The latch (a restricted observation in the task) turns any automatic answer into ask and refuses
// forwarding; a lasting purchase grant is invalid and never matches. A fresh-card kind (a public share
// link, M24.3) is honoured only under the one-shot grant an approval card mints, never a standing one.
import { failingConstraints } from "./constraints.ts";
import type { CompanyView, Decision, Descriptor, Grant, GranteeKind, Mode } from "./types.ts";

/** Tiers, most specific first; only the first tier with a match is considered. */
const TIERS: GranteeKind[][] = [["own-agent", "agent-of-person"], ["person"], ["team"], ["company"], ["any-member"]];
const RANK: Record<Mode, number> = { deny: 2, ask: 1, auto: 0 };

/** Whether an action kind names a purchase; purchases never get a lasting grant. */
export function isPurchaseKind(kind: string): boolean {
  return kind === "purchase" || kind.startsWith("purchase.") || kind.endsWith(".purchase");
}

/**
 * Kinds that run only under the person's fresh approval card, every time: a public share link (M24.3), a host the agent
 * proposed for a credential (M25.1), a disconnect asked in chat and a mailed code used once (F36, P9 deltas 6 and 8).
 */
export const FRESH_CARD_KINDS: readonly string[] = ["files.share", "credentials.host", "credentials.revoke", "credentials.otp"];
export function needsFreshCard(kind: string): boolean {
  return FRESH_CARD_KINDS.includes(kind);
}
/** The only grant a fresh-card kind runs under: the one-shot grant an approval card mints. */
export function cardGrant(g: Pick<Grant, "one_shot" | "created_from">): boolean {
  return g.one_shot === true && g.created_from === "approval-card";
}

/** `calendar.*` covers `calendar.move`; anything else must be equal. */
export function kindCovers(ref: string, kind: string): boolean {
  return ref === kind || (ref.endsWith(".*") && kind.startsWith(ref.slice(0, -1)));
}

export function subjectCovers(g: Grant, d: Descriptor): boolean {
  switch (g.subject.kind) {
    case "action-kind":
      return kindCovers(g.subject.ref, d.actionKind);
    case "connector":
      return d.subject.connector === g.subject.ref;
    case "resource":
      return d.subject.resource === g.subject.ref;
    case "skill":
      return d.subject.skill === g.subject.ref;
    case "memory-scope":
      return d.subject.memoryScope === g.subject.ref;
  }
}

/** A grant that could ever apply: live, unexpired, unused if one-shot, and not a lasting purchase. */
export function inForce(g: Grant, at: number): boolean {
  if (g.revoked_at !== undefined && g.revoked_at <= at) return false;
  if (g.expires_at !== undefined && g.expires_at <= at) return false;
  if (g.one_shot && g.used_at !== undefined) return false;
  if (g.subject.kind === "action-kind" && isPurchaseKind(g.subject.ref) && g.mode === "auto" && !g.one_shot) return false;
  if (g.subject.kind === "action-kind" && needsFreshCard(g.subject.ref) && g.mode === "auto" && !cardGrant(g)) return false;
  return true;
}

/** Whose grants decide: the company's for a company resource, otherwise the principal's own. */
function signedByOwner(g: Grant, d: Descriptor): boolean {
  return d.subject.scope === "company" ? g.grantor.kind === "company" : g.grantor.kind === "person" && g.grantor.id === d.principal;
}

/**
 * Whether the grantee names who is asking. With no hop it is the counterpart; past one hop only the
 * origin principal, their agent, or a team or company containing the origin match (grants never chain).
 */
function granteeMatches(g: Grant, d: Descriptor, c: CompanyView): boolean {
  const ownTask = d.hops === 0 && d.counterpart.kind === "own-agent";
  // A person's own task on their own resources is matched by their own-agent grants alone; on a
  // company resource the company's grants name the person (or their team) whose agent acts.
  if (g.grantee.kind === "own-agent") return ownTask && d.subject.scope === "personal";
  if (ownTask && d.subject.scope === "personal") return false;
  const asker = d.hops > 0 ? d.origin : d.counterpart.kind === "own-agent" ? d.principal : d.counterpart.id;
  switch (g.grantee.kind) {
    case "agent-of-person":
      return g.grantee.id === asker && (ownTask || d.hops > 0 || d.counterpart.kind === "agent-of-person");
    case "person":
      return g.grantee.id === asker;
    case "team":
      return g.grantee.id !== undefined && c.teamsOf(asker).includes(g.grantee.id);
    case "company":
    case "any-member":
      return c.roleOf(asker) !== null;
  }
}

const policyApplies = (d: Descriptor, c: CompanyView) => (p: CompanyView["policies"][number]) => {
  if (p.kind !== "deny-action" || !kindCovers(p.actionKind, d.actionKind)) return false;
  if (!p.role && !p.team) return true;
  return (p.role !== undefined && c.roleOf(d.principal) === p.role) || (p.team !== undefined && c.teamsOf(d.principal).includes(p.team));
};

/**
 * Resolves one descriptor. `uses` are the earlier automatic uses per grant id, for rate constraints.
 */
export function resolve(d: Descriptor, grants: readonly Grant[], c: CompanyView, uses: Readonly<Record<string, number[]>> = {}): Decision {
  // Step 1, the policy cap: company policy caps company resources only, never a person's own.
  if (d.subject.scope === "company") {
    const capped = c.policies.find(policyApplies(d, c));
    if (capped) return { decision: "deny", policyId: capped.id, step: "policy", code: "POLICY_DENIES" };
    const companyCover = grants.some((g) => inForce(g, d.at) && g.grantor.kind === "company" && subjectCovers(g, d));
    if (!companyCover) return { decision: "ask", step: "policy", code: "COMPANY_RESOURCE_UNGRANTED", route: { kind: "role", role: c.approverRole } };
  }
  if (d.restricted && d.forwardsToAgent) return { decision: "deny", step: "latch", code: "LATCH_NO_FORWARDING" };

  // Step 2, match at the most specific tier present.
  // A purchase is never automatic under a lasting grant, whatever its subject names.
  const lastingPurchase = (g: Grant) => (d.purchase || isPurchaseKind(d.actionKind)) && g.mode === "auto" && !g.one_shot;
  // Nor is a fresh-card kind under anything but a card's one-shot grant, whatever subject covers it (`files.*`).
  const lastingFresh = (g: Grant) => needsFreshCard(d.actionKind) && g.mode === "auto" && !cardGrant(g);
  const candidates = grants.filter((g) => inForce(g, d.at) && !lastingPurchase(g) && !lastingFresh(g) && signedByOwner(g, d) && subjectCovers(g, d) && granteeMatches(g, d, c));
  const tier = TIERS.map((kinds) => candidates.filter((g) => kinds.includes(g.grantee.kind))).find((t) => t.length > 0);
  const route = d.subject.scope === "company" ? ({ kind: "role", role: c.approverRole } as const) : ({ kind: "principal", id: d.principal } as const);
  if (!tier) return { decision: "ask", step: "none", code: "NO_GRANT", route };

  // Step 3, within the tier: deny beats ask beats auto; a failing constraint turns auto into ask.
  const effective = tier
    .map((g) => ({ g, mode: g.mode === "auto" && failingConstraints(g.constraints, d, uses[g.id] ?? []).length ? ("ask" as Mode) : g.mode }))
    .sort((a, b) => RANK[b.mode] - RANK[a.mode] || a.g.id.localeCompare(b.g.id));
  const top = effective[0] as { g: Grant; mode: Mode };
  if (top.mode === "deny") return { decision: "deny", grantId: top.g.id, step: "match", code: "GRANT_DENIES" };
  if (top.mode === "ask") {
    const code = top.g.mode === "auto" ? "GRANT_CONSTRAINT_FAILED" : "GRANT_ASKS";
    return { decision: "ask", grantId: top.g.id, step: "match", code, route };
  }

  // Step 4, chains: past one hop the answer is at most ask.
  if (d.hops > 1) return { decision: "ask", grantId: top.g.id, step: "chain", code: "CHAIN_AT_MOST_ASK", route };
  if (d.restricted) return { decision: "ask", grantId: top.g.id, step: "latch", code: "LATCH_NO_AUTO", route };
  return { decision: "auto", grantId: top.g.id, step: "match", code: "GRANT_AUTO", ...(top.g.one_shot ? { oneShot: true } : {}) };
}
