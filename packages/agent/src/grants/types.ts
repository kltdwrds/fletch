// The grant schema and the action descriptor (authority-model.md, AD-22). A grant is a signed record
// the tenant holds; a descriptor is what the runtime builds for one proposed action. Both are data
// the engine reads; neither carries message text.

export type GrantorKind = "person" | "company" | "platform";
export type GranteeKind = "own-agent" | "person" | "agent-of-person" | "team" | "company" | "any-member";
export type SubjectKind = "action-kind" | "connector" | "resource" | "skill" | "memory-scope";
export type Mode = "auto" | "ask" | "deny";
export type CreatedFrom = "approval-card" | "chat-confirmation" | "admin-ui";

/** Weekdays 0 (Sunday) to 6, `HH:MM` wall-clock bounds in an IANA zone. */
export interface WindowConstraint {
  days: number[];
  from: string;
  to: string;
  timeZone: string;
}

export interface Constraints {
  window?: WindowConstraint;
  max_amount?: { value: number; currency: string };
  recipients?: string[];
  resources?: string[];
  /** At most `count` automatic uses of this grant in any `perSeconds`. */
  rate?: { count: number; perSeconds: number };
}

export interface Grant {
  id: string;
  tenant: string;
  grantor: { kind: GrantorKind; id: string };
  grantee: { kind: GranteeKind; id?: string };
  subject: { kind: SubjectKind; ref: string };
  mode: Mode;
  constraints: Constraints;
  expires_at?: number;
  one_shot?: boolean;
  created_from: CreatedFrom;
  created_at: number;
  revoked_at?: number;
  /** Set when a one-shot grant has been used. */
  used_at?: number;
}

/** Who asked: the principal's own agent, a person, or a person's agent. */
export type Party = { kind: "own-agent" } | { kind: "person"; id: string } | { kind: "agent-of-person"; id: string };

export interface Descriptor {
  /** `agent:<principal>`: an agent is never a principal, only its person's proxy. */
  actor: string;
  /** The person whose agent acts, or `company` for a company resource's own approvals. */
  principal: string;
  actionKind: string;
  subject: {
    /** A company resource is the company's; anything else is the principal's own. */
    scope: "personal" | "company";
    connector?: string;
    resource?: string;
    skill?: string;
    memoryScope?: string;
    /** The content-free reference the journal records (an id, never a title or a body). */
    ref: string;
  };
  counterpart: Party;
  amount?: { value: number; currency: string };
  recipients?: string[];
  /** The root principal whose request started the chain. */
  origin: string;
  /** How many agents the request has passed through. */
  hops: number;
  /** The task's restricted-data latch is set: no grant applies automatically, nothing is forwarded. */
  restricted?: boolean;
  /** The action forwards to another agent (a colleague request). */
  forwardsToAgent?: boolean;
  /** Purchases never get a lasting grant and are asked with a card. */
  purchase?: boolean;
  at: number;
}

/** A company policy: a deny for an action kind, for a role or a team, and who approves company resources. */
export interface Policy {
  id: string;
  kind: "deny-action";
  actionKind: string;
  /** Applies to members with this role, or of this team; neither means everyone. */
  role?: "owner" | "admin" | "member";
  team?: string;
}

/** What the engine knows of the company beyond the grants: roles, teams, policies. */
export interface CompanyView {
  roleOf(person: string): "owner" | "admin" | "member" | null;
  teamsOf(person: string): string[];
  policies: Policy[];
  /** The role a company-resource approval routes to; the policy names it, admin by default. */
  approverRole: "admin";
}

export type Step = "policy" | "match" | "chain" | "latch" | "none";
export type Route = { kind: "principal"; id: string } | { kind: "role"; role: "admin" };

export interface Decision {
  decision: Mode;
  /** The grant the decision rests on; every automatic decision has one. */
  grantId?: string;
  /** The policy that capped it, for a policy deny. */
  policyId?: string;
  step: Step;
  /** Stable code naming why. */
  code: string;
  /** Who is asked, when the decision is ask. */
  route?: Route;
  oneShot?: boolean;
}
