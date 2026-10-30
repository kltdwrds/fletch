// The chat engine's host contract (moved out of `engine.ts` at M24.2 to keep it under the file cap): the
// object state it runs over, the resume wakeup, and the hooks the `Chat` object (or a test world) gives it.
import type { CodeApi } from "../code/run.ts";
import type { ColleaguesApi } from "../colleagues/tools.ts";
import type { WorkspaceApi } from "../workspace/tools.ts";
import type { Egress } from "../connectors/egress.ts";
import type { CredentialsApi } from "../connectors/namespaces.ts";
import type { JobsApi } from "../jobs/tools.ts";
import type { FilesApi, TreeApi } from "../files/tools.ts";
import type { MemoryApi } from "../memory/tools.ts";
import type { DocumentsApi } from "../render/tools.ts";
import type { SkillCatalog } from "../skills/catalog.ts";
import type { SkillSeenCall } from "../skills/tools.ts";
import type { DelegateInput } from "../subagents/host.ts";
import type { SubAgentsView } from "../subagents/tools.ts";
import type { Namespace } from "../tools/registry.ts";
import type { BrowseHook } from "../browse/hook.ts";
import type { AuthorityApi } from "./gate.ts";
import type { CompanyApprovals } from "./approvals.ts";

/** The parts of the object's state the engine uses. */
export interface EngineCtx {
  id?: { name?: string; toString(): string };
  storage: Pick<DurableObjectStorage, "sql" | "transactionSync" | "setAlarm" | "deleteAlarm">;
  getWebSockets(): Iterable<{ send(data: string): void }>;
}

/** Arms and disarms the resume of a running turn; the host decides the mechanism. */
export interface Wakeup {
  arm(at: number): Promise<void>;
  disarm(): Promise<void>;
}

export interface EngineHooks {
  /** Keeps work a call leaves running alive past the call (the object's `waitUntil`); the alarm resumes it if it dies. */
  defer?: (p: Promise<unknown>) => void;
  /** Defaults to the object's own alarm. */
  wakeup?: Wakeup;
  /** The sockets frames go to; defaults to every socket the object accepted. */
  sockets?: () => Iterable<{ send(data: string): void }>;
  /** The owner's memory on their `Person` object; without it the chat runs with no memory tools. */
  memory?: (person: string) => MemoryApi;
  /** The owner's files on their `Person` object; without it there is no `files` namespace. */
  files?: (person: string) => FilesApi;
  /** The owner's working tree, `work/` (M24.3); the `files` namespace serves `work/` paths from it, and oversized results spill into it. */
  tree?: (person: string) => TreeApi;
  /** The Renderer and the owner's documents and links (M24.3); without it there is no `documents` namespace. */
  documents?: (person: string) => DocumentsApi;
  /** The tenant's skill catalog; without it the shortlist is empty and there is no `skills` namespace. */
  skills?: SkillCatalog;
  /** The person's `skill_seen` (M25.3): a changed skill gets one notice on its next read. */
  skillSeen?: (person: string) => SkillSeenCall;
  /** Code Mode for the owner (M25.5): Dynamic Workers loaded from this Chat object, egress their only network; without it `code_execute` refuses. */
  code?: (person: string) => CodeApi;
  /** The tenant's egress for this person (the Vault's egress module); without it there are no connectors. */
  egress?: (person: string) => Egress;
  /** The person's credentials as the agent may see them (M13): status and hosts, never a value. */
  credentials?: (person: string) => CredentialsApi;
  /** Holds secrets the person typed in the Vault before the message is stored (M14.2); the text comes back with references. */
  secrets?: (person: string, text: string) => Promise<{ ok: true; text: string } | { ok: false; code: "SECRET_NOT_HELD" }>;
  /** The browser (M9): the read lane, the live lane and fill; without it there is no `browse` namespace. */
  browse?: BrowseHook;
  /** Further namespaces: fixtures in tests; a function receives the chat's view (its pending simulated calls). */
  namespaces?: Namespace[] | ((view: ChatView) => Namespace[]);
  /** The principal's grants on their `Person` (M7.1); without it nothing gated runs. */
  authority?: (person: string) => AuthorityApi;
  /** The company's approvals for company resources. */
  company?: CompanyApprovals;
  /** The `colleagues` namespace's directory, grants and requests. */
  colleagues?: ColleaguesApi;
  /** The person's jobs (M15.7): registered off from chat, turned on by their approval; without it there is no `jobs` namespace. */
  jobs?: JobsApi;
  /** The company workspace through the adapters (M8.1); standalone tenants have none, so no `workspace` namespace. */
  workspace?: { tenant: string; api: WorkspaceApi };
  /** A member's display name; the address stands in without one. */
  nameOf?: (email: string) => string;
  /** The company's instructions (M10.1), fenced below the standing files; standalone tenants have none. */
  companyInstructions?: () => Promise<{ tenant: string; text: string } | null>;
  /** This chat's sub-agents (M7.2); without it there is no `subagents` namespace. */
  subagents?: SubAgentsView & { delegate(input: DelegateInput): Promise<{ ok: boolean; code?: string; reason?: string }>; stopped?(turnId: string): void };
}

/** What a projecting connector may read of this chat: the proposals pending as simulated. */
export interface ChatView {
  owner(): string | null;
  pending(): Array<{ tool: string; args: Record<string, unknown> }>;
}
