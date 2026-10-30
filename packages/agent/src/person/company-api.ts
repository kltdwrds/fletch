// What a `Person` object calls on its tenant's `Company` object: the snapshot and grant uses its authority
// reads, the member lookup, company memory, the promotion queue and offboarding's policy and departure.
import type { CompanySnapshot } from "../company/authority.ts";
import type { Member } from "../company/members.ts";
import type { GrantUse } from "../grants/store.ts";
import type { Proposal } from "../learning/ladder.ts";
import type { OffboardingDeps } from "../lifecycle/offboarding.ts";
import type { CompanyMemoryApi } from "../memory/company.ts";

export interface PersonCompanyApi {
  snapshot(): Promise<CompanySnapshot>;
  useGrant(grantId: string, effectId: string, at: number): Promise<GrantUse>;
  lookup(email: string): Promise<Member | null>;
  memorySearch: CompanyMemoryApi["search"];
  memoryGet: CompanyMemoryApi["get"];
  memoryAppend: CompanyMemoryApi["append"];
  promotionPropose(person: string, input: unknown): Promise<{ ok: true; proposal: Proposal } | { ok: false; code: string; reason: string }>;
  offboardingPolicy: OffboardingDeps["company"]["offboardingPolicy"];
  mayDepart: OffboardingDeps["company"]["mayDepart"];
  depart: OffboardingDeps["company"]["depart"];
}
