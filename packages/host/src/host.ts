import type { BudgetService } from "./budget.ts";
import type { Identity } from "./identity.ts";
import type { KeyService } from "./keys.ts";
import type { MailService } from "./mail.ts";
import type { Reporter } from "./reporter.ts";
import type { MembersSync, ProvisioningService, WorkspaceService } from "./workspace.ts";

export type HostFeature = "keys" | "budget" | "identity" | "mail" | "workspace" | "provisioning" | "members" | "reporter" | "render" | "code" | "images";
export type HostFailureCode = `HOST_${Uppercase<HostFeature>}_UNAVAILABLE`;
export type HostFailure = { ok: false; code: HostFailureCode; reason: string };

/** A refused host feature: a code the UI shows with its reason, never an empty success. */
export const unavailable = (feature: HostFeature, reason: string): HostFailure => ({
  ok: false,
  code: `HOST_${feature.toUpperCase() as Uppercase<HostFeature>}_UNAVAILABLE`,
  reason,
});

export interface RenderService {
  render(input: unknown): Promise<{ ok: boolean; code?: string }>;
  toMarkdown(input: unknown): Promise<unknown>;
}

export interface Host {
  tenant: { id: string; shape: "standalone" | "company"; env: "self-host" | "staging" | "prod" };
  keys: KeyService;
  /** null = no cross-tenant cap */
  budget: BudgetService | null;
  identity: Identity;
  mail: MailService | HostFailure;
  workspace: WorkspaceService | HostFailure;
  provisioning: ProvisioningService | HostFailure;
  /** Access member sync; refused on self-host. */
  members: MembersSync | HostFailure;
  /** console on self-host */
  reporter: Reporter;
  render: RenderService | HostFailure;
  /** the MEMBERS JSON the Company seeds from */
  memberSeed: string;
}
