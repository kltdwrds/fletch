// The agent core's only view of a company workspace (AD-17). These three interfaces are ours,
// implemented by the fake (tests); fletch ships no workspace adapter yet, so the Company runs
// without one (a host may provide it later).
//
// There is no `decide` on any of them (A8, B23): approving, rejecting, sharing and connecting are
// people's, so the agent core has no way to ask for them, and the workshop refuses an agent session
// that tries (patch 1).

/** Who a call acts for. `agent` marks a session the agent runs for its person (AD-17). */
export interface ActingAs {
  tenant: string;
  /** The person's email, as the identity assertion's `sub` will carry it. */
  person: string;
  agent: boolean;
}

/** Stable refusal codes; callers branch on these, never on `reason` text. */
export type AdapterErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "WRONG_TENANT"
  | "AGENT_SESSION_REFUSED"
  | "INVALID"
  /** The person has no language model in the workshop, so no build agent can answer them. */
  | "NO_MODEL"
  | "UNAVAILABLE";

export type AdapterResult<T> = { ok: true; value: T } | { ok: false; code: AdapterErrorCode; reason: string };

export interface WorkspaceRef {
  id: string;
  name: string;
  owner: string;
}

export interface AppRef {
  id: string;
  workspace: string;
  /** The title as the workspace shows it, carrying the agent label (B22). */
  name: string;
}

export interface ContextDocument {
  collection: string;
  path: string;
  text: string;
}

/**
 * The build agent asked the person to connect an account (upstream's `connectionRequest` chat message).
 * Only the person accepts or denies it, in the workspace's chat (AD-24); the agent shows a link card.
 */
export interface ConnectionRequestRef {
  id: string;
  /** The workspace chat the request sits in. */
  chat: string;
  vendor: string;
  vendorName: string;
  resource?: string;
}

export interface BuildAgentTurn {
  reply: string;
  /** The workspace chat the turn ran in, when the workspace names one. */
  chat?: string;
  /** Connection requests the build agent raised in that chat that still wait for the person. */
  connectionRequests?: ConnectionRequestRef[];
}

export interface HookRef {
  id: string;
  title: string;
  enabled: boolean;
}

export interface ApprovalRef {
  id: string;
  workspace: string;
  action: string;
  state: "pending" | "approved" | "rejected";
}

/** A connected account of the person, as the workspace lists it: what a binding can be made from. */
export interface Capability {
  /** The account's id in the workspace. */
  account: string;
  vendor: string;
  name: string;
  resources: string[];
}

/** The label every contribution carries: who made it, and for whom (B22, A6). */
export function agentLabel(person: string): string {
  return `AI agent for ${person}`;
}

/** A title the agent gives a thing it creates, so a colleague opening the workspace sees whose it is. */
export function labeledTitle(name: string, person: string): string {
  return `${name} (${agentLabel(person)})`;
}

export interface WorkspaceAdapter {
  listWorkspaces(as: ActingAs): Promise<AdapterResult<WorkspaceRef[]>>;
  openWorkspace(as: ActingAs, workspace: string): Promise<AdapterResult<WorkspaceRef>>;
  /** The documents of a context collection the person may read (account-wide, not per workspace). */
  readContextCollection(as: ActingAs, collection: string): Promise<AdapterResult<ContextDocument[]>>;
  /** One turn with the workspace's build agent, as a labeled message; its edits are the build agent's. */
  converse(as: ActingAs, workspace: string, message: string): Promise<AdapterResult<BuildAgentTurn>>;
  createWorkspace(as: ActingAs, name: string): Promise<AdapterResult<WorkspaceRef>>;
  createApp(as: ActingAs, workspace: string, name: string): Promise<AdapterResult<AppRef>>;
  /** Bind one of the person's own connected accounts to the workspace, for a resource it supports. */
  bindConnector(as: ActingAs, workspace: string, account: string, resource: string): Promise<AdapterResult<{ account: string; resource: string }>>;
  listHooks(as: ActingAs, workspace: string): Promise<AdapterResult<HookRef[]>>;
  enableHook(as: ActingAs, workspace: string, hook: string, enabled: boolean): Promise<AdapterResult<HookRef>>;
  listApprovals(as: ActingAs, workspace: string): Promise<AdapterResult<ApprovalRef[]>>;
}

/** What the person may reach through their own accounts. */
export interface CapabilityAdapter {
  capabilities(as: ActingAs): Promise<AdapterResult<Capability[]>>;
}

/** One document the company mirror writes into a public context collection (M10.2). */
export interface MirrorDocument {
  path: string;
  description: string;
  text: string;
}

/**
 * The company mirror's view of the workspace (M10.2): company scope into a public context collection
 * and the company instructions into the workspace's admin instructions. Only the `Company` holds it,
 * after an admin's write, acting as that admin's agent; no agent tool reaches it, and the workshop
 * decides whether the person is an admin there.
 */
export interface CompanyMirrorAdapter {
  /** Finds the public collection by title or creates it, writes every document and removes the ones no longer listed. */
  publishContext(as: ActingAs, collection: { title: string; description: string }, docs: MirrorDocument[]): Promise<AdapterResult<{ collection: string; written: number }>>;
  /** Replaces the workspace's admin instructions; the answer is what the workshop holds afterwards. */
  setInstructions(as: ActingAs, text: string): Promise<AdapterResult<{ length: number }>>;
}

/** Pending actions across the person's workspaces. Read only: deciding is the person's, in the workspace. */
export interface ApprovalAdapter {
  pending(as: ActingAs): Promise<AdapterResult<ApprovalRef[]>>;
}

/** Upstream's banner colors (workshop-shared `BANNER_COLORS`); the contract suite checks the list. */
export const BANNER_COLORS = ["neutral", "info", "success", "warning", "danger", "brand"] as const;
export type BannerColor = (typeof BANNER_COLORS)[number];

/**
 * The workshop's deployment settings an admin changes from qyvr's admin page (M14.2), by upstream's own
 * names in `AdminSettingsView`, so administration has one home. Instructions stay the mirror's.
 */
export interface WorkspaceSettings {
  signupsEnabled: boolean;
  userSearchEnabled: boolean;
  siteName: string;
  announcement: string;
  banner: { text: string; color: BannerColor };
  accentColor: string;
}

/** Upstream's admin settings through its admin API. Only the `Company` holds it, after its admin check. */
export interface WorkspaceSettingsAdapter {
  readSettings(as: ActingAs): Promise<AdapterResult<WorkspaceSettings>>;
  /** Writes the given settings; the answer is what the workshop holds afterwards, read back. */
  writeSettings(as: ActingAs, patch: Partial<WorkspaceSettings>): Promise<AdapterResult<WorkspaceSettings>>;
}
