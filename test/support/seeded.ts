// The seeded generator (testing-and-evals.md section 4, M7.1): mulberry32, copied from upstream's
// packages/workshop-evals/evals/seeded.ts at 54d4685 (Apache-2.0), and the grant and request sets the
// authority families draw from it. One seed gives one set, so a family's run is reproducible and a
// failure names the seed. Only the fixture identities appear.
import type { Grant, GranteeKind, Mode } from "../../packages/agent/src/grants/types.ts";

export class Seeded {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** `k` distinct integers in [min, max], ascending. */
  distinct(k: number, min: number, max: number): number[] {
    const out = new Set<number>();
    while (out.size < k) out.add(this.int(min, max));
    return [...out].sort((a, b) => a - b);
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(0, xs.length - 1)] as T;
  }

  /** The indices 0..n-1 in a seeded order. */
  shuffle(n: number): number[] {
    const out = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j] as number, out[i] as number];
    }
    return out;
  }
}

/** Action kinds a colleague may ask of another member's agent in the families. */
export const REQUEST_KINDS = ["calendar.move", "reports.read", "docs.share", "notes.post"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** Why an uncovered request is uncovered: each decoy is a grant that must not apply. */
export type Decoy = "none" | "other-kind" | "ask-mode" | "deny-mode" | "expired" | "revoked" | "window-closed" | "one-shot-used";

export interface SeededRequest {
  index: number;
  /** The principal whose agent receives the request, and the colleague who sends it. */
  principal: string;
  requester: string;
  /** Sent by the colleague through their own agent (one hop) or by the colleague directly. */
  viaAgent: boolean;
  kind: RequestKind;
  resource: string;
  covered: boolean;
  decoy: Decoy;
}

export interface RequestSet {
  requests: SeededRequest[];
  /** The grants each principal holds, as `PersonGrants.create` would store them (ids assigned by the store). */
  /**
   * The grants each principal signs, created through the store a day before `at` (so an expiry at `at`
   * is valid when made); `after` is what happened to the grant since: revoked, or a one-shot used.
   */
  grants: Array<{ principal: string; index: number; input: Omit<Grant, "id" | "tenant" | "created_at" | "revoked_at" | "used_at">; after?: "revoke" | "use" }>;
}

const TIERS: GranteeKind[] = ["person", "agent-of-person", "company", "any-member"];

/**
 * `n` requests between two members, exactly half covered by an automatic grant the principal signed,
 * the rest each carrying a decoy grant that must not apply. `at` is the instant the requests are made.
 */
export function seededRequests(rng: Seeded, n: number, members: readonly [string, string], at: number): RequestSet {
  const covered = new Set(rng.shuffle(n).slice(0, Math.floor(n / 2)));
  const decoys: Decoy[] = ["none", "other-kind", "ask-mode", "deny-mode", "expired", "revoked", "window-closed", "one-shot-used"];
  const requests: SeededRequest[] = [];
  const grants: RequestSet["grants"] = [];
  for (let i = 0; i < n; i++) {
    const principalIndex = rng.int(0, 1);
    const principal = members[principalIndex] as string;
    const requester = members[1 - principalIndex] as string;
    const viaAgent = rng.next() < 0.5;
    const kind = rng.pick(REQUEST_KINDS);
    const resource = `res-${i}`;
    const isCovered = covered.has(i);
    const decoy: Decoy = isCovered ? "none" : rng.pick(decoys);
    requests.push({ index: i, principal, requester, viaAgent, kind, resource, covered: isCovered, decoy });
    const tier = rng.pick(viaAgent ? TIERS : TIERS.filter((t) => t !== "agent-of-person"));
    const grantee = tier === "person" || tier === "agent-of-person" ? { kind: tier, id: requester } : { kind: tier };
    // A grant scoped to this request's resource, so no two requests share a grant.
    const base = (mode: Mode) => ({
      grantor: { kind: "person" as const, id: principal },
      grantee,
      subject: { kind: "resource" as const, ref: resource },
      mode,
      constraints: {},
      created_from: "approval-card" as const,
    });
    if (isCovered) {
      const window = rng.next() < 0.3 ? { window: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59", timeZone: "UTC" } } : {};
      grants.push({ principal, index: i, input: { ...base("auto"), constraints: window } });
      continue;
    }
    switch (decoy) {
      case "none":
        break;
      case "other-kind":
        grants.push({ principal, index: i, input: { ...base("auto"), subject: { kind: "resource", ref: `res-other-${i}` } } });
        break;
      case "ask-mode":
        grants.push({ principal, index: i, input: base("ask") });
        break;
      case "deny-mode":
        grants.push({ principal, index: i, input: base("deny") });
        break;
      case "expired":
        grants.push({ principal, index: i, input: { ...base("auto"), expires_at: at - 1 } });
        break;
      case "revoked":
        grants.push({ principal, index: i, input: base("auto"), after: "revoke" });
        break;
      case "window-closed": {
        const day = new Date(at).getUTCDay();
        grants.push({ principal, index: i, input: { ...base("auto"), constraints: { window: { days: [(day + 3) % 7], from: "00:00", to: "23:59", timeZone: "UTC" } } } });
        break;
      }
      case "one-shot-used":
        grants.push({ principal, index: i, input: { ...base("auto"), one_shot: true }, after: "use" });
        break;
    }
  }
  return { requests, grants };
}
