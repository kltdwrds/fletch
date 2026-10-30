// The Company object (AD-1, AD-22), one per tenant: from M4.1 its members and roles, seeded from the
// tenant file and extended by admins' invitations; from M7.1 the directory, company policies and
// company grants, and the snapshot every grant decision reads; from M10.1 owners, teams, company
// instructions, and the company and team memory scopes, which it decides on every read and write;
// from M10.2 seats, budgets, model tiers and disabled agents (pushed to the Ledger, which enforces
// them), company connectors (values in the Vault), company skills, and the workspace mirror; from
// M11 the promotion ladder's merge queue for team and company scope, team skills, and the company's
// half of offboarding: its policy on pages about members, and the seat a departure releases; from
// M11.2 the onboarding record: its steps, the study's draft under review, the workspace request; from
// M12 the company's loops on this object's alarm, with their flags and budgets set by admins; from
// M14.2 the workspace's deployment settings, read and written for an admin through the adapter.
import { DurableObject } from "cloudflare:workers";
import { adminJournal, adminLedger, type LedgerReads } from "../company/admin.ts";
import { CompanyAuthority, type CompanySnapshot } from "../company/authority.ts";
import { CompanyInstructions, type InstructionsVersion } from "../company/instructions.ts";
import { CompanyConnectors, type CompanyVault, entitled } from "../company/connectors.ts";
import { type AccessSync, syncAccess } from "../company/access-sync.ts";
import { CompanyMembers, displayNames, type InviteResult, isAdminRole, type Member, type RoleResult } from "../company/members.ts";
import { CompanyMirror, type MirrorOutcome } from "../company/mirror.ts";
import { CompanyOnboarding } from "../company/onboarding.ts";
import { CompanySettings, type CompanySettingsView } from "../company/settings.ts";
import { CompanySkills } from "../company/skills.ts";
import { DEFAULT_BUDGETS, type CompanyPolicy } from "../ledger/budget.ts";
import { type SettingsResult, workspaceSettings } from "../company/workspace-settings.ts";
import type { CompanyMirrorAdapter, WorkspaceSettingsAdapter } from "../workspace/adapters.ts";
import { CompanyTeams, type Team } from "../company/teams.ts";
import { CompanyMemory, type ScopeWrite } from "../memory/company.ts";
import type { Reader } from "../memory/disclosure.ts";
import type { DirectoryEntry } from "../colleagues/tools.ts";
import type { CreateResult } from "../grants/store.ts";
import { type Actor, PromotionLadder } from "../learning/ladder.ts";
import { PUBLIC_CONNECTORS } from "../learning/narrowing.ts";
import { referee } from "../learning/referee.ts";
import { writeSkillFile } from "../learning/skill-files.ts";
import { COMPANY_OWNER, CompanyLoops } from "../loops/company.ts";
import { COMPANY_LOOPS, type CompanyLoop, type LoopModel, LoopRun, LoopSettings } from "../loops/registry.ts";
import { legFor } from "../memory/semantic.ts";
import { migrateObject, probeObject } from "../migrations/catalog.ts";
import { available, hostOf } from "../host.ts";
import { type LoginCall, type LoginResultOf, runLoginCall } from "@qyvr/host-cloudflare";
import { modelConfig } from "../model/routes.ts";

export class Company extends DurableObject<Env> {
  private readonly schema = migrateObject(this.ctx, "company");

  /** The sweep's wake (M25.3): what this wake applied and what is still behind. */
  async migrationProbe() { return probeObject(this.ctx.storage, this.schema); }

  /**
   * The self-host login's storage (F1, R3): passkeys, sessions and recovery codes are rows here, reached by the host's
   * identity through one call. A Durable Object RPC method is reachable only by code holding the namespace binding (the
   * host), and no HTTP route forwards to it.
   */
  async loginCall<C extends LoginCall>(call: C): Promise<LoginResultOf<C>> { return runLoginCall(this.ctx.storage, Date.now, call); }
  private membersInstance?: CompanyMembers;
  private authorityInstance?: CompanyAuthority;
  private teamsInstance?: CompanyTeams;
  private instructionsInstance?: CompanyInstructions;
  private memoryInstance?: CompanyMemory;
  private settingsInstance?: CompanySettings;
  private connectorsInstance?: CompanyConnectors;
  private skillsInstance?: CompanySkills;
  private mirrorInstance?: CompanyMirror;
  private ladderInstance?: PromotionLadder;
  private onboardingInstance?: CompanyOnboarding;
  private loopStateInstance?: LoopSettings;
  private loopsInstance?: CompanyLoops;

  private loopsArmed = false;

  /**
   * The company loops run on this object's alarm (M12): armed by the first call of each wake that
   * reads the members, which nearly every call does, and re-armed by each tick.
   */
  private armLoops(): void {
    if (this.loopsArmed) return;
    this.loopsArmed = true;
    void this.ctx.storage.getAlarm().then((at) => (at === null ? this.ctx.storage.setAlarm(Date.now()) : undefined));
  }

  async alarm(): Promise<void> {
    const { next } = await this.loops.tick(Date.now());
    await this.ctx.storage.setAlarm(next);
  }

  private get loopState(): LoopSettings {
    this.loopStateInstance ??= new LoopSettings(this.ctx.storage, COMPANY_LOOPS);
    return this.loopStateInstance;
  }

  private loopModel(): LoopModel {
    return { ai: this.env.AI, models: modelConfig(this.env), ledger: this.ledger as never, tenant: this.env.TENANT_ID, wait: (ms) => new Promise<void>((r) => setTimeout(r, ms)) };
  }

  private get loops(): CompanyLoops {
    this.loopsInstance ??= new CompanyLoops({
      storage: this.ctx.storage,
      memory: this.memory,
      state: this.loopState,
      model: this.loopModel(),
      ladder: this.ladder,
      ledger: this.ledger as never,
      skillNames: async () => (await this.skills.list()).map((k) => k.name),
      now: () => Date.now(),
    });
    return this.loopsInstance;
  }

  /** The company's loops with their flags and budgets; admins only. */
  async loopSettings(by: string) {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false as const, code: "NOT_AN_ADMIN", reason: "the company's loops are its admins'" };
    return { ok: true as const, loops: this.loopState.list() };
  }

  async setLoop(by: string, loop: unknown, patch: { enabled?: unknown; budget?: unknown }) {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false as const, code: "NOT_AN_ADMIN", reason: "the company's loops are its admins'" };
    return this.loopState.set(loop, patch);
  }

  /** One company loop in the slot due at `slot`; the alarm calls this through `tick`. */
  async runLoop(loop: CompanyLoop, slot: number) {
    return this.loops.run(loop, slot);
  }

  /** What the company's loops did: each run's outcome and each batch's reconciliation; admins only. */
  async loopReport(by: string, loop: CompanyLoop) {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false as const, code: "NOT_AN_ADMIN", reason: "the company's loops are its admins'" };
    return { ok: true as const, runs: this.loopState.runs(loop), reconciliations: this.loops.reconciliations(loop) };
  }

  /** The monthly cost report, to admins only (memory-and-learning.md "Background loops"). */
  async costReport(by: string, month: string) {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false as const, code: "NOT_AN_ADMIN", reason: "the cost report is for the company's admins" };
    const report = this.loops.costReport(month);
    return report ? { ok: true as const, report } : { ok: false as const, code: "COST_REPORT_NOT_FOUND", reason: `no report for ${month} yet` };
  }

  /** The company connectors this member's agent may use, with who connected each; never a value (M23.5). */
  async connectorsFor(person: string) {
    if (!this.members.lookup(person)) return { ok: false as const, code: "NOT_A_MEMBER", reason: "connectors are its members'" };
    const snapshot = this.authority.snapshot();
    const now = Date.now();
    const connectors = this.connectors.list().filter((c) => entitled(snapshot, person, c.id, "use", now)).map((c) => ({ id: c.id, hosts: c.hosts, connectedBy: c.connectedBy, at: c.at }));
    return { ok: true as const, connectors };
  }

  /** The consolidated company claims the upkeep loop keeps, for any member (company scope passes the gate). */
  async companyClaims(by: string) {
    if (!this.members.lookup(by)) return { ok: false as const, code: "NOT_A_MEMBER", reason: "company memory is its members'" };
    return { ok: true as const, claims: this.memory.companyClaims() };
  }

  /** Onboarding (M11.2): steps read from the stores that own them; the workspace asked of the platform. */
  private get onboarding(): CompanyOnboarding {
    const host = hostOf(this.env);
    this.onboardingInstance ??= new CompanyOnboarding(this.ctx.storage, {
      isAdmin: (e) => isAdminRole(this.members.lookup(e)?.role),
      connectors: () => this.connectors.list().map((c) => ({ id: c.id, hosts: c.hosts })),
      memberCount: () => this.members.list().length,
      hasWorkspace: host.tenant.shape === "company",
      instructions: () => this.instructionsStore.current()?.text ?? "",
      appendCompany: async (text) => {
        const r = await this.memory.appendStudied({ scope: "company", text, writer: "onboarding:study", source: "onboarding:study" });
        return r.ok ? { ok: true, citation: r.citation } : r;
      },
      requestWorkspace: async (person) => (available(host.provisioning) ? host.provisioning.requestWorkspace(person) : host.provisioning),
      studyRun: () => LoopRun.start({ loop: "onboarding-study", owner: COMPANY_OWNER, state: this.loopState, model: this.loopModel(), now: () => Date.now(), slot: Date.now() }),
      now: () => Date.now(),
    });
    return this.onboardingInstance;
  }

  /** The merge queue for team and company scope (M11); the referee runs on the cheap route. */
  private get ladder(): PromotionLadder {
    this.ladderInstance ??= new PromotionLadder({
      storage: this.ctx.storage,
      isMember: (e) => !!this.members.lookup(e),
      isAdmin: (e) => isAdminRole(this.members.lookup(e)?.role),
      teamMembers: (id) => this.teams.list().find((t) => t.id === id)?.members ?? null,
      members: () => this.members.list().map((m) => m.email),
      holding: (member) => {
        const snapshot = this.authority.snapshot();
        const company = this.connectors.list().map((c) => c.id).filter((id) => entitled(snapshot, member, id, "use", Date.now()));
        return { member, connectors: [...PUBLIC_CONNECTORS, ...(hostOf(this.env).tenant.shape === "company" ? ["workspace"] : []), ...company] };
      },
      referee: (i) =>
        referee(
          { ai: this.env.AI, models: modelConfig(this.env), ledger: this.ledger as never, tenant: this.env.TENANT_ID, now: () => Date.now(), wait: (ms) => new Promise<void>((r) => setTimeout(r, ms)) },
          { ...i, context: i.target === "company" ? (this.instructionsStore.current()?.text ?? "") : "" },
        ),
      writeSkill: (target, name, text, writer) => {
        if (!this.env.AGENT_BUCKET) throw new Error("COMPANY_SKILLS_UNAVAILABLE: the tenant bucket is not bound");
        return writeSkillFile(this.env.AGENT_BUCKET, target === "company" ? "skills/company/" : `skills/teams/${target.slice(5)}/`, name, text, writer, Date.now());
      },
      appendMemory: (target, text, writer) => this.memory.appendMerged({ scope: target, text, writer, source: writer }),
      now: () => Date.now(),
    });
    return this.ladderInstance;
  }

  private get settings(): CompanySettings {
    this.settingsInstance ??= new CompanySettings(this.ctx.storage, this.members, () => Date.now(), DEFAULT_BUDGETS);
    return this.settingsInstance;
  }

  private get connectors(): CompanyConnectors {
    this.connectorsInstance ??= new CompanyConnectors(this.ctx.storage, this.members, () => Date.now());
    return this.connectorsInstance;
  }

  private get skills(): CompanySkills {
    this.skillsInstance ??= new CompanySkills(this.members, this.env.AGENT_BUCKET, hostOf(this.env).tenant.shape);
    return this.skillsInstance;
  }

  /**
   * The mirror and the settings reach a company workspace through an adapter. fletch has none: the upstream
   * adapter was the platform's (the dispatcher's handshake to its workshop), so both answer as unconnected.
   */
  private get upstream(): (CompanyMirrorAdapter & WorkspaceSettingsAdapter) | null {
    return null;
  }

  private get mirrorStore(): CompanyMirror {
    this.mirrorInstance ??= new CompanyMirror(this.ctx.storage, this.env.TENANT_ID, this.upstream, () => Date.now());
    return this.mirrorInstance;
  }

  private get ledger() {
    return this.env.LEDGER.get(this.env.LEDGER.idFromName(this.env.TENANT_ID)) as unknown as LedgerReads & { setCompanyPolicy(p: CompanyPolicy): Promise<CompanyPolicy> };
  }

  private get vault(): CompanyVault {
    return this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID)) as unknown as CompanyVault;
  }

  private get members(): CompanyMembers {
    this.armLoops();
    this.membersInstance ??= new CompanyMembers(this.ctx.storage, hostOf(this.env).memberSeed, () => Date.now());
    return this.membersInstance;
  }

  private get authority(): CompanyAuthority {
    this.authorityInstance ??= new CompanyAuthority(this.ctx.storage, this.env.TENANT_ID, this.members, this.teams, () => Date.now());
    return this.authorityInstance;
  }

  private get teams(): CompanyTeams {
    this.teamsInstance ??= new CompanyTeams(this.ctx.storage, this.members, () => Date.now());
    return this.teamsInstance;
  }

  private get instructionsStore(): CompanyInstructions {
    this.instructionsInstance ??= new CompanyInstructions(this.ctx.storage, this.members, () => Date.now());
    return this.instructionsInstance;
  }

  private get memory(): CompanyMemory {
    this.memoryInstance ??= new CompanyMemory(this.ctx.storage, {
      reader: (email) => this.reader(email),
      isAdmin: (email) => isAdminRole(this.members.lookup(email)?.role),
      ...(this.env.AGENT_BUCKET ? { bucket: this.env.AGENT_BUCKET } : {}),
      now: () => Date.now(),
      // The semantic half of company and team search (M12.2): the tenant index, the company's namespace.
      semantic: (sql: () => SqlStorage) => this.env.MEMORY_INDEX && legFor({ index: this.env.MEMORY_INDEX, ai: this.env.AI, models: modelConfig(this.env), ledger: this.ledger as never, tenant: this.env.TENANT_ID, store: COMPANY_OWNER, sql, now: () => Date.now() }),
    });
    return this.memoryInstance;
  }

  /** One reader as the disclosure gate sees them: a member now, and of which teams. */
  private reader(email: string): Reader {
    const member = this.members.lookup(email);
    return { email: member?.email ?? email, member: !!member, teams: member ? this.teams.teamsOf(member.email) : [] };
  }

  /** The members with their names and roles; every member may read it. */
  async directory(): Promise<DirectoryEntry[]> {
    const nameOf = displayNames(hostOf(this.env).memberSeed);
    return this.members.list().map((m) => ({ email: m.email, role: m.role, ...(nameOf(m.email) !== m.email ? { name: nameOf(m.email) } : {}) }));
  }

  async snapshot(): Promise<CompanySnapshot> {
    return this.authority.snapshot();
  }

  async useGrant(grantId: string, effectId: string, at: number): Promise<import("../grants/store.ts").GrantUse> {
    return this.authority.use(grantId, effectId, at);
  }

  /** An owner or an admin acts for the company. */
  async isAdmin(person: string): Promise<boolean> {
    return isAdminRole(this.members.lookup(person)?.role);
  }

  async setRole(by: string, email: string, role: unknown): Promise<RoleResult> {
    return this.members.setRole(by, email, role);
  }

  /** The teams one member is in; the skill catalog reads team skills by it (M11). */
  async teamsOf(email: string): Promise<string[]> {
    return this.members.lookup(email) ? this.teams.teamsOf(this.members.lookup(email)?.email as string) : [];
  }

  async teamList(): Promise<Team[]> {
    return this.teams.list();
  }

  async createTeam(by: string, input: unknown) {
    return this.teams.create(by, input);
  }

  async setTeamMember(by: string, team: string, email: string, inTeam: boolean) {
    return this.teams.setMember(by, team, email, inTeam);
  }

  /** The current company instructions; every member's agent reads them. */
  async instructions(): Promise<InstructionsVersion | null> {
    return this.instructionsStore.current();
  }

  async instructionsHistory(by: string): Promise<InstructionsVersion[] | null> {
    return isAdminRole(this.members.lookup(by)?.role) ? this.instructionsStore.history() : null;
  }

  /** A new version, then the mirror as the admin who wrote it; the answer says how the mirror went. */
  async writeInstructions(by: string, text: unknown) {
    const r = this.instructionsStore.write(by, text);
    return r.ok ? { ...r, mirror: await this.mirrorAs(by) } : r;
  }

  /** The company's settings for its admins: seats, budgets, model tier, disabled agents. */
  async settingsView(by: string): Promise<CompanySettingsView | null> {
    return isAdminRole(this.members.lookup(by)?.role) ? this.settings.view() : null;
  }

  /** An admin's change: the Ledger takes the policy first, so what is stored is what is enforced. */
  async setSettings(by: string, input: unknown) {
    const p = this.settings.propose(by, input);
    if (!p.ok) return p;
    const pushed = await this.pushPolicy(this.settings.policy(p.next));
    if (!pushed.ok) return pushed;
    this.settings.store(by, p.changes);
    return { ok: true as const, settings: this.settings.view() };
  }

  /** An admin disables or re-enables a member's agent; the Ledger then admits no call of theirs. */
  async setAgentDisabled(by: string, email: string, disabled: boolean) {
    const p = this.settings.proposeDisabled(by, email, disabled);
    if (!p.ok) return p;
    const pushed = await this.pushPolicy(this.settings.policy(p.next));
    if (!pushed.ok) return pushed;
    this.settings.storeDisabled(by, email, disabled);
    return { ok: true as const, settings: this.settings.view() };
  }

  private async pushPolicy(policy: CompanyPolicy): Promise<{ ok: true } | { ok: false; code: string; reason: string }> {
    try {
      await this.ledger.setCompanyPolicy(policy);
      return { ok: true };
    } catch (err) {
      return { ok: false, code: "LEDGER_UNAVAILABLE", reason: `the Ledger did not take the policy, so nothing changed: ${String(err)}` };
    }
  }

  /** One page's worth for an admin: members with their agents' state, seats, settings, policies, teams, connectors, skills, instructions, the mirror. */
  async overview(by: string) {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false as const, code: "NOT_AN_ADMIN", reason: "only an admin sees the company's pages" };
    const settings = this.settings.view();
    const nameOf = displayNames(hostOf(this.env).memberSeed);
    const members = this.members.list();
    return {
      ok: true as const,
      members: members.map((m) => ({ email: m.email, name: nameOf(m.email), role: m.role, source: m.source, disabled: settings.disabled.includes(m.email) })),
      seats: { used: members.length, limit: settings.seats },
      settings,
      policies: this.authority.policies(),
      teams: this.teams.list(),
      connectors: this.connectors.list(),
      skills: (await this.skills.list()).map((s) => ({ name: s.name, description: s.description })),
      instructions: this.instructionsStore.current(),
      mirror: this.mirrorStore.history(5),
    };
  }

  async connectConnector(by: string, input: unknown) {
    return this.connectors.connect(by, input, this.vault);
  }

  async removeConnector(by: string, id: string) {
    return this.connectors.remove(by, id, this.vault);
  }

  /** The Vault asks this on every resolution of a company connector's credential. */
  async connectorEntitled(person: string, connector: string, purpose: string): Promise<boolean> {
    if (!this.members.lookup(person) || !this.connectors.has(connector)) return false;
    return entitled(this.authority.snapshot(), this.members.lookup(person)?.email as string, connector, purpose, Date.now());
  }

  async writeSkill(by: string, input: unknown) {
    const r = await this.skills.write(by, input);
    return r.ok ? { ...r, mirror: await this.mirrorAs(by) } : r;
  }

  async removeSkill(by: string, name: string) {
    const r = await this.skills.remove(by, name);
    return r.ok ? { ...r, mirror: await this.mirrorAs(by) } : r;
  }

  /** An admin re-runs the mirror by hand, e.g. after the workshop was unreachable. */
  async mirror(by: string): Promise<MirrorOutcome> {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin runs the mirror" };
    return this.mirrorAs(by);
  }

  /** The workspace's deployment settings (M14.2), read, or written and read back, as the admin's agent session. */
  async workspaceSettings(by: string, input?: unknown): Promise<SettingsResult> {
    const admin = this.members.lookup(by);
    if (!isAdminRole(admin?.role)) return { ok: false, code: "NOT_AN_ADMIN", reason: "only an admin changes the workspace's settings" };
    return workspaceSettings(this.upstream, { tenant: this.env.TENANT_ID, person: admin?.email ?? by, agent: true }, input);
  }

  private async mirrorAs(by: string): Promise<MirrorOutcome> {
    return this.mirrorStore.run(this.members.lookup(by)?.email ?? by, {
      instructions: this.instructionsStore.current()?.text ?? "",
      memory: this.memory.companyDays(),
      skills: await this.skills.list(),
    });
  }

  /** An agent's journal and ledger, for an admin of this company (A9); the roles are checked here. */
  async adminJournal(by: string, person: string) {
    return adminJournal(this.adminDeps(), by, person);
  }

  async adminLedger(by: string, person: string) {
    return adminLedger(this.adminDeps(), by, person);
  }

  private adminDeps() {
    return {
      isAdmin: (p: string) => isAdminRole(this.members.lookup(p)?.role),
      isMember: (p: string) => !!this.members.lookup(p),
      ledger: this.ledger,
    };
  }

  /** Company and team memory for every reader of a turn; the disclosure gate decides here. */
  async memorySearch(input: { queries: string[]; maxResults?: number }, readers: string[]) {
    return this.memory.searchHybrid(input, readers);
  }

  async memoryGet(input: { path: string; from?: number; limit?: number }, readers: string[]) {
    return this.memory.get(input, readers);
  }

  /** A company-scope line an admin wrote in person is mirrored at once; team lines never are. */
  async memoryAppend(by: string, input: ScopeWrite) {
    const r = await this.memory.append(by, input);
    return r.ok && input.scope === "company" ? { ...r, mirror: await this.mirrorAs(by) } : r;
  }

  /** A person's agent proposes a promotion into team or company scope; it waits for the person (M4). */
  async promotionPropose(person: string, input: unknown) {
    return this.ladder.propose(person, input);
  }

  async promotionConsent(actor: Actor, id: string) {
    return this.ladder.consent(actor, id);
  }

  /** The merge key's holder merges; a company-scope merge is mirrored as that admin, like their own writes. */
  async promotionMerge(actor: Actor, id: string) {
    const r = await this.ladder.merge(actor, id);
    if (r.ok && r.proposal.status === "merged" && r.proposal.target === "company") return { ...r, mirror: await this.mirrorAs(actor.email) };
    return r;
  }

  async promotionDecline(actor: Actor, id: string) {
    return this.ladder.decline(actor, id);
  }

  async promotions(email: string) {
    return this.ladder.list(email);
  }

  /** What a departing member is told before they leave, and the names offboarding matches pages by. */
  async offboardingPolicy(person: string) {
    if (!this.members.lookup(person)) return { ok: false as const, code: "NOT_A_MEMBER", reason: "only a member offboards" };
    const nameOf = displayNames(hostOf(this.env).memberSeed);
    const members = this.members.list().filter((m) => m.email !== this.members.lookup(person)?.email).map((m) => ({ email: m.email, name: nameOf(m.email) }));
    return { ok: true as const, memberPagesInExport: this.settings.view().memberPagesInExport, members };
  }

  /** Whether the person may leave, asked before offboarding builds a bundle or purges anything (F40, P14 delta 3). */
  async mayDepart(person: string) {
    const r = this.members.mayDepart(person);
    return r.ok ? r : { ok: false as const, code: r.code, reason: r.code === "LAST_OWNER" ? "the last owner cannot leave" : "not a member" };
  }

  /**
   * The seat is released once the person's scope is purged (M11): their membership, their teams with
   * it, and their proposals that never became the company's (unapproved, rejected or declined) go, and
   * from M24.3 everything they keep in the Vault: credentials, grants and saved browser logins.
   */
  async depart(person: string) {
    const email = this.members.lookup(person)?.email;
    const r = this.members.depart(person);
    if (!r.ok) return { ok: false as const, code: r.code, reason: r.code === "LAST_OWNER" ? "the last owner cannot leave" : "not a member" };
    this.ladder.dropUnapproved(email ?? person);
    // The departure stands whatever the Vault answers; a purge that did not happen is said with its code.
    const vault = this.env.VAULT ? await Promise.resolve().then(() => this.vault.purgePerson(email ?? person)).catch((e: unknown) => ({ ok: false as const, code: "VAULT_UNAVAILABLE", reason: String(e).slice(0, 160) })) : null;
    if (vault) return { ok: true as const, vault, access: await this.syncAccess() };
    // Access stops admitting them with the seat (M14.3); the departure stands whatever it answers.
    return { ok: true as const, access: await this.syncAccess() };
  }

  async onboardingStatus(by: string) {
    return this.onboarding.status(by);
  }

  async onboardingSkip(actor: Actor, step: unknown) {
    return this.onboarding.skip(actor, step);
  }

  async onboardingStudy(actor: Actor, material: unknown) {
    return this.onboarding.study(actor, material);
  }

  /** The review makes accepted lines company scope; like an admin's own company write, it is mirrored as them. */
  async onboardingReview(actor: Actor, input: { accept?: unknown; reject?: unknown }) {
    const r = await this.onboarding.review(actor, input);
    return r.ok && r.accepted.length ? { ...r, mirror: await this.mirrorAs(actor.email) } : r;
  }

  async onboardingRequestWorkspace(person: string) {
    return this.onboarding.requestWorkspace(person);
  }

  async addPolicy(by: string, input: unknown) {
    return this.authority.addPolicy(by, input);
  }

  async createGrant(by: string, input: unknown): Promise<CreateResult> {
    return this.authority.createGrant(by, input);
  }

  async revokeGrant(by: string, id: string) {
    return this.authority.revokeGrant(by, id);
  }

  async fetch(): Promise<Response> {
    return Response.json({ code: "NOT_IMPLEMENTED", object: "Company" }, { status: 501 });
  }

  async lookup(email: string): Promise<Member | null> {
    return this.members.lookup(email);
  }

  async list(): Promise<Member[]> {
    return this.members.list();
  }

  /**
   * An invitation takes a seat; with none free it is refused (M10.2). Once recorded, Access is told
   * the new member list (M14.3), and what it answered is returned beside the member.
   */
  async invite(by: string, email: string, role: unknown): Promise<InviteResult> {
    if (isAdminRole(this.members.lookup(by)?.role) && !this.settings.seatFree()) return { ok: false, code: "SEATS_FULL" };
    const r = this.members.invite(by, email, role);
    return r.ok ? { ...r, access: await this.syncAccess() } : r;
  }

  /** An admin sends the member list to Access again, after a sync that failed. */
  async resyncAccess(by: string): Promise<AccessSync | { ok: false; code: "NOT_AN_ADMIN" }> {
    if (!isAdminRole(this.members.lookup(by)?.role)) return { ok: false, code: "NOT_AN_ADMIN" };
    return this.syncAccess();
  }

  private syncAccess(): Promise<AccessSync> {
    return syncAccess(hostOf(this.env).members, this.members.list());
  }
}
