// Types copied from qyvr-co: the Workspace entrypoint (packages/platform/dispatcher/src/index.ts) and its result
// types from workspace.ts; ProvisioningService from provisioning.ts (RequestResult, ProvisioningRequest) and the
// Provisioning entrypoint; MembersSync from members.ts (MembersApi, MembersResult).
export type WorkspaceRefusalCode =
  | "WORKSPACE_NO_TENANT"
  | "WORKSPACE_WRONG_TENANT"
  | "WORKSPACE_NO_WORKSHOP"
  | "WORKSPACE_PERSON_INVALID"
  | "WORKSPACE_BODY_INVALID"
  | "WORKSPACE_KEY_UNAVAILABLE";
export type WorkspaceRefusal = { ok: false; code: WorkspaceRefusalCode; reason: string };
export type WorkspaceAnswer = { status: number; body: string };
export type WorkspaceResult = ({ ok: true } & WorkspaceAnswer) | WorkspaceRefusal | { ok: false; code: "WORKSPACE_UNAVAILABLE"; reason: string };
export type WorkspaceReplayResult =
  | { ok: true; jti: string; first: WorkspaceAnswer; second: WorkspaceAnswer }
  | WorkspaceRefusal
  | { ok: false; code: "WORKSPACE_UNAVAILABLE" | "WORKSPACE_REPLAY_DISABLED"; reason: string };

/** The Workspace entrypoint's shape: one Cap'n Web batch over `call`, or a WebSocket session over `fetch`. */
export interface WorkspaceService {
  call(target: string, person: string, body: string): Promise<WorkspaceResult>;
  replay(target: string, person: string, body: string): Promise<WorkspaceReplayResult>;
  fetch(request: Request): Promise<Response>;
}

export type RequestKind = "workspace" | "convert";
export type RequestStatus = "requested" | "provisioning" | "done" | "failed";
export interface ProvisioningRequest {
  id: string;
  kind: RequestKind;
  from: string;
  person: string;
  name?: string;
  tenant?: string;
  status: RequestStatus;
  code?: string;
  at: number;
  updatedAt: number;
}
export type Refusal = { ok: false; code: string; reason: string };
export type RequestResult = { ok: true; request: ProvisioningRequest; duplicate: boolean } | Refusal;

/** Standalone-tenant conversion of one departing person. */
export type Converter = (input: { person: string; name?: string }) => Promise<RequestResult>;

export interface ProvisioningService {
  requestWorkspace(person: string): Promise<RequestResult>;
  requestConversion: Converter;
  status(id: string): Promise<{ ok: true; request: ProvisioningRequest } | Refusal>;
}

export type MembersCode = "MEMBERS_NO_TENANT" | "MEMBERS_UNAVAILABLE" | "MEMBERS_NOT_PROVISIONED" | "MEMBERS_INVALID" | "MEMBERS_SYNC_FAILED";
export type MembersResult = { ok: true; admitted: number } | { ok: false; code: MembersCode; reason: string };
export interface MembersSync {
  sync(emails: string[]): Promise<MembersResult>;
}
