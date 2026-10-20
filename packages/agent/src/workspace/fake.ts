// In-memory implementation of the three workspace interfaces for hermetic tests. It keeps the rules
// the upstream workspace enforces that the agent core relies on: one tenant per adapter, a member
// sees only what they own or what was shared with them, a connect is refused for an agent session,
// and everything an agent creates carries the agent label (AD-17, B22). It has no way to approve,
// reject or share: those are seeded by a test standing in for a person (B23).
import {
  type ActingAs,
  type AdapterErrorCode,
  type AdapterResult,
  type AppRef,
  type ApprovalAdapter,
  type ApprovalRef,
  type BuildAgentTurn,
  type Capability,
  type CapabilityAdapter,
  type CompanyMirrorAdapter,
  type ContextDocument,
  type MirrorDocument,
  type HookRef,
  labeledTitle,
  type WorkspaceAdapter,
  type WorkspaceRef,
  type WorkspaceSettings,
  type WorkspaceSettingsAdapter,
} from "./adapters.ts";

interface FakeWorkspace extends WorkspaceRef {
  sharedWith: Set<string>;
  apps: Map<string, AppRef>;
  connectors: Set<string>;
  hooks: Map<string, HookRef>;
  approvals: Map<string, ApprovalRef>;
  /** What the agent said to the build agent, with the sender's person. */
  transcript: { by: string; text: string }[];
}

const ok = <T>(value: T): AdapterResult<T> => ({ ok: true, value });
const fail = <T>(code: AdapterErrorCode, reason: string): AdapterResult<T> => ({ ok: false, code, reason });

export class FakeWorkspaceAdapter implements WorkspaceAdapter, CapabilityAdapter, ApprovalAdapter, CompanyMirrorAdapter, WorkspaceSettingsAdapter {
  readonly #tenant: string;
  readonly #members: Set<string>;
  readonly #workspaces = new Map<string, FakeWorkspace>();
  /** Context collections are the company library's: visible to every member of the tenant. */
  readonly #collections = new Map<string, ContextDocument[]>();
  readonly #capabilities = new Map<string, Capability[]>();
  /** Scripted build-agent replies, consumed in order; the fake never calls a model. */
  readonly #buildReplies: BuildAgentTurn[] = [];
  #nextId = 1;
  /** The workshop's admins, who alone write public collections and the admin instructions (M10.2). */
  readonly #admins: Set<string>;
  #instructions = "";
  /** The deployment settings, upstream's defaults (M14.2). */
  #settings: WorkspaceSettings = { signupsEnabled: true, userSearchEnabled: true, siteName: "", announcement: "", banner: { text: "", color: "info" }, accentColor: "" };

  constructor(tenant: string, members: string[], admins: string[] = []) {
    this.#tenant = tenant;
    this.#members = new Set(members);
    this.#admins = new Set(admins);
  }

  /** The admin instructions the workspace's build agent reads (M10.2). */
  instructions(): string {
    return this.#instructions;
  }

  // --- seeding, for tests only -------------------------------------------------------------------

  seedWorkspace(owner: string, name: string): string {
    const id = `ws-${this.#nextId++}`;
    this.#workspaces.set(id, { id, name, owner, sharedWith: new Set(), apps: new Map(), connectors: new Set(), hooks: new Map(), approvals: new Map(), transcript: [] });
    return id;
  }

  /** A share is a human decision in the workspace UI; there is deliberately no adapter method for it. */
  seedShare(workspace: string, member: string): void {
    this.#require(workspace).sharedWith.add(member);
  }

  seedCollection(collection: string, docs: Omit<ContextDocument, "collection">[]): void {
    this.#collections.set(collection, docs.map((d) => ({ ...d, collection })));
  }

  seedHook(workspace: string, title: string, enabled = false): string {
    const id = `hk-${this.#nextId++}`;
    this.#require(workspace).hooks.set(id, { id, title, enabled });
    return id;
  }

  seedApproval(workspace: string, action: string): string {
    const w = this.#require(workspace);
    const id = `${workspace}:${this.#nextId++}`;
    w.approvals.set(id, { id, workspace, action, state: "pending" });
    return id;
  }

  /** What a person did in the workspace UI: the only way an approval leaves "pending". */
  seedPersonDecision(approval: string, decision: "approved" | "rejected"): void {
    for (const w of this.#workspaces.values()) {
      const a = w.approvals.get(approval);
      if (a) a.state = decision;
    }
  }

  seedCapabilities(person: string, capabilities: Capability[]): void {
    this.#capabilities.set(person, capabilities);
  }

  scriptBuildReply(turn: BuildAgentTurn): void {
    this.#buildReplies.push(turn);
  }

  /** What the workspace holds, for assertions: the apps (with their labeled titles) and the build transcript. */
  inspect(workspace: string): { apps: AppRef[]; connectors: string[]; transcript: { by: string; text: string }[]; title: string } {
    const w = this.#require(workspace);
    return { apps: [...w.apps.values()], connectors: [...w.connectors], transcript: [...w.transcript], title: w.name };
  }

  // --- WorkspaceAdapter --------------------------------------------------------------------------

  async listWorkspaces(as: ActingAs) {
    const denied = this.#admit<WorkspaceRef[]>(as);
    if (denied) return denied;
    return ok([...this.#workspaces.values()].filter((w) => this.#visible(w, as)).map(toRef));
  }

  async openWorkspace(as: ActingAs, workspace: string) {
    const found = this.#find(as, workspace);
    return found.ok ? ok(toRef(found.value)) : found;
  }

  async readContextCollection(as: ActingAs, collection: string) {
    const denied = this.#admit<ContextDocument[]>(as);
    if (denied) return denied;
    const docs = this.#collections.get(collection);
    return docs ? ok(docs.map((d) => ({ ...d }))) : fail<ContextDocument[]>("NOT_FOUND", `no collection ${collection}`);
  }

  // --- CompanyMirrorAdapter (M10.2) ---------------------------------------------------------------

  async publishContext(as: ActingAs, collection: { title: string; description: string }, docs: MirrorDocument[]) {
    const denied = this.#admit<{ collection: string; written: number }>(as);
    if (denied) return denied;
    if (!this.#admins.has(as.person)) return fail<{ collection: string; written: number }>("FORBIDDEN", "only an admin writes a public collection");
    this.#collections.set(collection.title, docs.map((d) => ({ collection: collection.title, path: d.path, text: d.text })));
    return ok({ collection: collection.title, written: docs.length });
  }

  async setInstructions(as: ActingAs, text: string) {
    const denied = this.#admit<{ length: number }>(as);
    if (denied) return denied;
    if (!this.#admins.has(as.person)) return fail<{ length: number }>("FORBIDDEN", "only an admin sets the admin instructions");
    this.#instructions = text;
    return ok({ length: text.length });
  }

  async readSettings(as: ActingAs) {
    const denied = this.#admit<WorkspaceSettings>(as);
    if (denied) return denied;
    if (!this.#admins.has(as.person)) return fail<WorkspaceSettings>("FORBIDDEN", "only an admin reads the deployment settings");
    return ok(structuredClone(this.#settings));
  }

  async writeSettings(as: ActingAs, patch: Partial<WorkspaceSettings>) {
    const read = await this.readSettings(as);
    if (!read.ok) return read;
    this.#settings = { ...this.#settings, ...structuredClone(patch) };
    return ok(structuredClone(this.#settings));
  }

  async converse(as: ActingAs, workspace: string, message: string) {
    const found = this.#find(as, workspace);
    if (!found.ok) return found;
    if (!message.trim()) return fail<BuildAgentTurn>("INVALID", "the message is empty");
    found.value.transcript.push({ by: as.person, text: message });
    const turn = this.#buildReplies.shift();
    return turn ? ok(turn) : fail<BuildAgentTurn>("UNAVAILABLE", "no scripted build-agent reply");
  }

  async createWorkspace(as: ActingAs, name: string) {
    const denied = this.#admit<WorkspaceRef>(as);
    if (denied) return denied;
    if (!name.trim()) return fail<WorkspaceRef>("INVALID", "name is empty");
    return ok(toRef(this.#require(this.seedWorkspace(as.person, as.agent ? labeledTitle(name.trim(), as.person) : name.trim()))));
  }

  async createApp(as: ActingAs, workspace: string, name: string) {
    const found = this.#find(as, workspace);
    if (!found.ok) return found;
    if (!name.trim()) return fail<AppRef>("INVALID", "name is empty");
    const app: AppRef = { id: `app-${this.#nextId++}`, workspace, name: as.agent ? labeledTitle(name.trim(), as.person) : name.trim() };
    found.value.apps.set(app.id, app);
    return ok({ ...app });
  }

  async bindConnector(as: ActingAs, workspace: string, account: string, resource: string) {
    const found = this.#find(as, workspace);
    if (!found.ok) return found;
    const mine = this.#capabilities.get(as.person) ?? [];
    // Only the person's own accounts bind (upstream: observers pick their own); another's id is absent.
    if (!mine.some((c) => c.account === account && c.resources.includes(resource))) return fail<{ account: string; resource: string }>("FORBIDDEN", "no such connected account of yours for that resource");
    found.value.connectors.add(`${account}:${resource}`);
    return ok({ account, resource });
  }

  async listHooks(as: ActingAs, workspace: string) {
    const found = this.#find(as, workspace);
    return found.ok ? ok([...found.value.hooks.values()].map((h) => ({ ...h }))) : found;
  }

  async enableHook(as: ActingAs, workspace: string, hook: string, enabled: boolean) {
    const found = this.#find(as, workspace);
    if (!found.ok) return found;
    const h = found.value.hooks.get(hook);
    if (!h) return fail<HookRef>("NOT_FOUND", `no hook ${hook}`);
    h.enabled = enabled;
    return ok({ ...h });
  }

  async listApprovals(as: ActingAs, workspace: string) {
    const found = this.#find(as, workspace);
    return found.ok ? ok([...found.value.approvals.values()].map((a) => ({ ...a }))) : found;
  }

  // --- CapabilityAdapter -------------------------------------------------------------------------

  async capabilities(as: ActingAs) {
    const denied = this.#admit<Capability[]>(as);
    if (denied) return denied;
    return ok((this.#capabilities.get(as.person) ?? []).map((c) => ({ ...c, resources: [...c.resources] })));
  }

  // --- ApprovalAdapter ---------------------------------------------------------------------------

  async pending(as: ActingAs) {
    const denied = this.#admit<ApprovalRef[]>(as);
    if (denied) return denied;
    const out: ApprovalRef[] = [];
    for (const w of this.#workspaces.values()) {
      if (!this.#visible(w, as)) continue;
      out.push(...[...w.approvals.values()].filter((a) => a.state === "pending").map((a) => ({ ...a })));
    }
    return ok(out);
  }

  // --- internals ---------------------------------------------------------------------------------

  #admit<T>(as: ActingAs): AdapterResult<T> | null {
    if (as.tenant !== this.#tenant) return fail("WRONG_TENANT", `adapter serves tenant ${this.#tenant}`);
    if (!this.#members.has(as.person)) return fail("FORBIDDEN", "not a member of this tenant");
    return null;
  }

  #visible(w: FakeWorkspace, as: ActingAs): boolean {
    return w.owner === as.person || w.sharedWith.has(as.person);
  }

  #find(as: ActingAs, workspace: string): AdapterResult<FakeWorkspace> {
    const denied = this.#admit<FakeWorkspace>(as);
    if (denied) return denied;
    const w = this.#workspaces.get(workspace);
    // Unshared and absent look the same, so a member cannot probe for a colleague's workspaces.
    if (!w || !this.#visible(w, as)) return fail("NOT_FOUND", `no workspace ${workspace}`);
    return ok(w);
  }

  #require(workspace: string): FakeWorkspace {
    const w = this.#workspaces.get(workspace);
    if (!w) throw new Error(`fake: no workspace ${workspace}`);
    return w;
  }
}

function toRef(w: FakeWorkspace): WorkspaceRef {
  return { id: w.id, name: w.name, owner: w.owner };
}
