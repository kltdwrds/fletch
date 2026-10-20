// The `onboarding` namespace (M11.2): what the owner's agent may do while it walks a fresh tenant
// through onboarding. It reads the steps; it proposes an invitation and the workspace request as
// actions on company resources, so each becomes the owner's approval card unless a company grant
// covers it, and runs only once an admin decided. Connecting tools, approving the study and reviewing
// its draft are the owner's in person and have no tool here.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";

type Refusal = { ok: false; code: string; reason?: string };

export interface OnboardingApi {
  status(by: string): Promise<{ ok: true; steps: Array<{ step: string; status: string; detail: string | null }>; next: string | null; draft: Array<{ status: string }> } | Refusal>;
  /** The Company's invitation as `by`, then the invitee's `Person` enrolled. */
  invite(by: string, email: string, role: "admin" | "member"): Promise<{ ok: true; member: { email: string; role: string } } | Refusal>;
  requestWorkspace(by: string): Promise<{ ok: true; request: string; status: string; duplicate: boolean } | Refusal>;
}

const text = (body: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: body }], details });

/** A refusal is thrown with its stable code, so the model and the journal read the code. */
function value<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`${(r as unknown as Refusal).code}: ${(r as unknown as Refusal).reason ?? "refused"}`);
  return r as Extract<T, { ok: true }>;
}

/** `principal` names the chat's owner when a call runs. */
export function onboardingNamespace(api: OnboardingApi, principal: () => string): Namespace {
  const status: ToolSpec = {
    name: "onboarding_status",
    kind: "observation",
    label: "Onboarding steps",
    description: "Read where the company's onboarding stands: connect tools, the onboarding study, invite members, request the workspace.",
    parameters: Type.Object({}),
    execute: async () => {
      const s = value(await api.status(principal()));
      const pending = s.draft.filter((d) => d.status === "pending").length;
      const lines = s.steps.map((x) => `- ${x.step}: ${x.status}${x.detail ? ` (${x.detail})` : ""}`);
      return text([...lines, `next: ${s.next ?? "nothing; onboarding is complete"}`, ...(pending ? [`${pending} study lines await the owner's review`] : [])].join("\n"), { next: s.next });
    },
  };
  const invite: ToolSpec = {
    name: "onboarding_invite",
    kind: "action",
    label: "Invite a member",
    description: "Invite someone to the company as a member or an admin. An admin approves the invitation first; the invitee can sign in once the platform has synced access.",
    parameters: Type.Object({
      email: Type.String({ minLength: 3, maxLength: 200, description: "The invitee's work address." }),
      role: Type.Union([Type.Literal("member"), Type.Literal("admin")], { description: "member or admin." }),
    }),
    actionKind: "company.member.invite",
    subject: () => ({ scope: "company", resource: "members" }),
    recipients: (args) => [String(args.email)],
    execute: async (_id, p) => {
      const { email, role } = p as { email: string; role: "admin" | "member" };
      const r = value(await api.invite(principal(), email, role));
      return text(`Invited ${r.member.email} as ${r.member.role}; access follows once the platform syncs it.`, { member: r.member.email });
    },
  };
  const workspace: ToolSpec = {
    name: "onboarding_request_workspace",
    kind: "action",
    label: "Request the company workspace",
    description: "Ask the platform for the company's workspace. The owner approves the request on a card first; the platform then provisions it.",
    parameters: Type.Object({}),
    actionKind: "platform.workspace.request",
    subject: () => ({ scope: "company", resource: "workspace" }),
    execute: async () => {
      const r = value(await api.requestWorkspace(principal()));
      return text(`The workspace is requested (${r.request}, ${r.status}); the platform provisions it.`, { request: r.request });
    },
  };
  return {
    name: "onboarding",
    description: "the company's onboarding: its steps, inviting members and requesting the workspace",
    deferral: "names",
    tools: [status, invite, workspace],
  };
}
