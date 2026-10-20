// The Person object (AD-1), one per member, on the Agents SDK. It owns the person's chats, their memory (the home
// tree in the tenant bucket and the memory tables in this object's SQLite), their grants and the decision point for
// every action their agent proposes, colleagues' requests to their agent, the personal rung of the promotion ladder,
// memory import, the person's half of offboarding, and the person's loops on cron schedules (M12).
import { Agent, getAgentByName } from "agents";
import type { ColleagueRequest, RequestOutcome } from "../colleagues/tools.ts";
import { type AdminArea, adminPersonalRead, ownChats } from "../company/admin.ts";
import { PersonAuthority } from "../grants/authority.ts";
import type { JournalRow } from "../grants/journal.ts";
import type { CreateResult } from "../grants/store.ts";
import type { Decision, Descriptor, Grant } from "../grants/types.ts";
import { type DomainMemory, PersonBrowse } from "../browse/memory.ts";
import { receiveRequest } from "../person/requests.ts";
import { PersonFiles } from "../files/store.ts";
import { type AttachmentCall, PersonAttachments } from "../attachments/store.ts";
import { type AttachmentLinkCall, runAttachmentCall } from "../attachments/links.ts";
import { attachmentDeps } from "../attachments/wiring.ts";
import { type DocumentCall, documentCall, PersonLinks } from "../files/links.ts";
import { forgetConfirmed } from "../vault/browser-state.ts";
import { runTreeCall, type TreeCall, treeOf } from "../tree/rpc.ts";
import type { EntityInput } from "../memory/entities.ts";
import { MemoryService } from "../memory/service.ts";
import { PersonMemory } from "../memory/store.ts";
import { legFor, type SemanticLeg } from "../memory/semantic.ts";
import type { Actor } from "../learning/ladder.ts";
import { PersonalLearning, personalSkillsPrefix } from "../learning/personal.ts";
import { MemoryImport } from "../lifecycle/import.ts";
import type { PersonCompanyApi } from "../person/company-api.ts";
import { PERSON_CRONS, PersonLoops, personSlot } from "../loops/personal.ts";
import { type LoopLedger, LoopSettings, PERSON_LOOPS, type PersonLoop } from "../loops/registry.ts";
import { restorePersonal } from "../lifecycle/bundle.ts";
import { completeConversion, conversionBundle, type Converter, ConversionState, finishOffboarding, type OffboardingDeps, purgeWork, startOffboarding } from "../lifecycle/offboarding.ts";
import type { MemoryWriteInput, WriteContext } from "../memory/tools.ts";
import { probeSearch } from "../memory/probe-search.ts";
import { PersonJobIndex } from "../person/job-index.ts";
import { forgetProducers } from "../person/forget-producers.ts";
import { type ChatsCall, type OpenResult, PersonChats, runChatsCall } from "../person/chats.ts";
import { asNotify, type DeliveryCall, type DeliveryInput, PersonDelivery, runCall } from "../delivery/service.ts";
import { personDeliveryDeps, skillDraftOffer } from "../delivery/person-deps.ts";
import { type InboundMail, type MailOutService, type OutboundMail, PersonMail } from "../person/mail.ts";
import { memberName, type Profile, PersonProfile } from "../person/profile.ts";
import { log } from "../obs/log.ts";
import { migrateObject } from "../migrations/catalog.ts";
import { type PersonPlatformCall, personPlatformCall } from "../migrations/person-api.ts";

/** Buffered daily lines reach R2 within this many seconds of the first unrendered write. */
export const RENDER_DELAY_S = 60;
/** The longest one memory probe holds its request while it waits on the index (M12.2). */
export const PROBE_WAIT_MS = 25_000;

export class Person extends Agent<Env> {
  private readonly schema = migrateObject(this.ctx, "person");
  static options = { sendIdentityOnConnect: false };
  private chatsInstance?: PersonChats;
  private memoryInstance?: MemoryService;
  private filesInstance?: PersonFiles;
  private mailInstance?: PersonMail;
  private authorityInstance?: PersonAuthority;
  private browseInstance?: PersonBrowse;

  /** The object's name is the person; the agent script names it from props, never from a request. */
  private get chats(): PersonChats {
    this.chatsInstance ??= new PersonChats(
      this.ctx.storage,
      this.name,
      async (chatId, person) => (await getAgentByName(this.env.CHAT, chatId)).claim(person),
      async (chatId, person) => (await getAgentByName(this.env.CHAT, chatId)).reopen(person),
    );
    return this.chatsInstance;
  }

  private personMemoryInstance?: PersonMemory;
  private semanticInstance?: SemanticLeg;
  private learningInstance?: PersonalLearning;
  private importInstance?: MemoryImport;
  private loopsInstance?: PersonLoops;
  private loopStateInstance?: LoopSettings;

  /** The person's loops are cron schedules, created once; the SDK dedupes a cron by callback and payload. */
  async onStart(): Promise<void> {
    for (const loop of PERSON_LOOPS) await this.schedule(PERSON_CRONS[loop], "loopTick", loop);
  }

  async loopTick(loop: PersonLoop): Promise<void> {
    if (!PERSON_LOOPS.includes(loop)) return;
    const out = await this.loops.run(loop, personSlot(loop, Date.now()));
    await this.armRender();
    const n = this.learning.pending().length;
    if (loop === "skill-review" && out.signal === "notify" && n) await this.delivery.deliver(skillDraftOffer(out.runId, n));
  }

  private deliveryInstance?: PersonDelivery;
  private get delivery(): PersonDelivery {
    const armFlush = async (at: number) => {
      for (const s of await this.listSchedules()) if (s.callback === "deliveryFlush") await this.cancelSchedule(s.id);
      await this.schedule(new Date(at), "deliveryFlush");
    };
    this.deliveryInstance ??= new PersonDelivery(this.ctx.storage, personDeliveryDeps({ env: this.env, person: this.name, chats: () => this.chats, mail: () => this.mail, armFlush }));
    return this.deliveryInstance;
  }

  /** Everything for the person arrives through here (M14.1): job notices, mail, the loops' offers. */
  async deliver(input: DeliveryInput) {
    return this.delivery.deliver(input);
  }

  /** The person's own subscriptions, feedback and preferences, from the app's routes. */
  async deliveryCall(by: string, call: DeliveryCall) {
    return runCall(this.delivery, by, call);
  }

  /** Counts of the person's delivery items in a range (M15.3): numbers only, for the dashboards and the rollup. */
  async deliveryCounts(from: number, to: number) {
    return this.delivery.counts(from, to);
  }

  async deliveryActivity(): Promise<void> { this.delivery.activity(); }
  async deliveryFlush(): Promise<void> { await this.delivery.flush(); }

  private get loopState(): LoopSettings {
    this.loopStateInstance ??= new LoopSettings(this.ctx.storage, PERSON_LOOPS);
    return this.loopStateInstance;
  }

  private get loops(): PersonLoops {
    const m = this.modelDeps();
    this.loopsInstance ??= new PersonLoops({
      mem: this.personMemory,
      state: this.loopState,
      model: { ai: m.ai, ledger: m.ledger as LoopLedger, tenant: m.tenant, wait: m.wait },
      skillNames: async () => {
        const prefix = personalSkillsPrefix(this.name);
        const listed = await this.env.AGENT_BUCKET.list({ prefix });
        return listed.objects.flatMap((o) => /^([^/]+)\/SKILL\.md$/.exec(o.key.slice(prefix.length))?.[1] ?? []);
      },
      proposeSkill: async (input) => this.learning.review(input),
      now: () => Date.now(),
    });
    return this.loopsInstance;
  }

  /** The person's loops with their flags and budgets, to the person alone. */
  async loopSettings(requester: string) { return this.loops.settings(requester); }
  async setLoop(requester: string, loop: unknown, patch: { enabled?: unknown; budget?: unknown }) { return this.loops.setLoop(requester, loop, patch); }

  /** What the person's loops did, with the skills the review proposed still waiting, to the person alone. */
  async loopReport(requester: string, loop: PersonLoop) {
    const r = this.loops.report(requester, loop);
    return r.ok ? { ...r, pendingSkills: this.learning.pending() } : r;
  }

  private get personMemory(): PersonMemory {
    this.personMemoryInstance ??= new PersonMemory(this.ctx.storage, this.env.AGENT_BUCKET, this.name);
    return this.personMemoryInstance;
  }

  private get learning(): PersonalLearning {
    this.learningInstance ??= new PersonalLearning({
      storage: this.ctx.storage,
      bucket: this.env.AGENT_BUCKET,
      person: this.name,
      commit: (d, effectId) => this.authority.commit(d, effectId),
      now: () => Date.now(),
    });
    return this.learningInstance;
  }

  private get imports(): MemoryImport {
    this.importInstance ??= new MemoryImport(this.ctx.storage, this.personMemory);
    return this.importInstance;
  }

  private modelDeps() {
    return { ai: this.env.AI, ledger: this.env.LEDGER.get(this.env.LEDGER.idFromName(this.env.TENANT_ID)) as never, tenant: this.env.TENANT_ID, now: () => Date.now(), wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };
  }

  private get memory(): MemoryService {
    this.memoryInstance ??= new MemoryService(
      this.personMemory,
      {
        search: (input, readers) => this.company().memorySearch(input, readers),
        get: (input, readers) => this.company().memoryGet(input, readers),
        append: (by, input) => this.company().memoryAppend(by, input),
      },
      this.semantic,
    );
    return this.memoryInstance;
  }

  /** The semantic half of the person's search (M12.2): the tenant index under this person's namespace. */
  private get semantic(): SemanticLeg | undefined {
    if (!this.env.MEMORY_INDEX) return undefined;
    const m = this.modelDeps();
    this.semanticInstance ??= legFor({ index: this.env.MEMORY_INDEX, ai: m.ai, ledger: m.ledger, tenant: m.tenant, store: this.name, sql: () => this.personMemory.sql, now: m.now });
    return this.semanticInstance;
  }

  private get files(): PersonFiles {
    this.filesInstance ??= new PersonFiles(this.ctx.storage, this.env.AGENT_BUCKET, this.name);
    return this.filesInstance;
  }

  private linksInstance?: PersonLinks;
  /** The person's signing key and share links (M24.3, `files/links.ts`), made once per instance. */
  private get links(): PersonLinks {
    this.linksInstance ??= new PersonLinks(this.ctx.storage, this.files, this.env.AGENT_BUCKET, () => Date.now());
    return this.linksInstance;
  }

  private get mail(): PersonMail {
    this.mailInstance ??= new PersonMail(this.ctx.storage, {
      person: this.name,
      ...memberName(this.env.MEMBERS, this.name),
      now: () => Date.now(),
      openChat: () => this.chats.open(Date.now(), "mail"),
      ownsChat: (chatId) => this.chats.owns(chatId),
      notify: async (chatId, n) => asNotify(await this.delivery.deliver({ ...n, kind: "requested", category: "mail", chat: chatId })),
      mailOut: this.env.MAIL_OUT as unknown as MailOutService,
      holdCode: (code, source) => this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID)).captureOneTimeCode({ person: this.name, code, source }),
      attachments: (m) => this.attachments.fromMail(m),
    });
    return this.mailInstance;
  }

  private company(): PersonCompanyApi {
    return this.env.COMPANY.get(this.env.COMPANY.idFromName(this.env.TENANT_ID)) as unknown as PersonCompanyApi;
  }

  /** The personal rung (M11): the agent's skill, written at once under the person's self-learning grant, else waiting for them. */
  async learnSkill(input: { name: string; description: string; body: string; tools?: string[]; connectors?: string[] }) {
    return this.learning.propose(input);
  }

  async mergeLearned(actor: Actor, id: string) {
    return this.learning.merge(actor, id);
  }

  async editSkill(actor: Actor, input: { name: string; description: string; body: string; tools?: string[]; connectors?: string[] }) {
    return this.learning.editByHand(actor, input);
  }

  /** The agent proposes a promotion of the person's own learning; it waits in the company's queue for the person's consent. */
  async proposePromotion(input: unknown) {
    return this.company().promotionPropose(this.name, input);
  }

  /** Memory import (M11): extraction shown first, saved only on the person's confirmation. */
  async importPlan(actor: Actor, summary: string) {
    return this.imports.plan(this.modelDeps(), actor, summary);
  }

  async importConfirm(actor: Actor, id: string) {
    const r = await this.imports.confirm(actor, id);
    if (r.ok) await this.armRender();
    return r;
  }

  private offboardingDeps(): OffboardingDeps {
    const company = this.company();
    return {
      mem: this.personMemory,
      bucket: this.env.AGENT_BUCKET,
      files: { dump: () => this.files.dump(), purgeAll: () => this.files.purgeAll() },
      work: { purge: () => purgeWork(treeOf(this.ctx.storage, this.name), this.attachments, this.links) },
      company: { propose: (p, i) => company.promotionPropose(p, i), offboardingPolicy: (p) => company.offboardingPolicy(p), depart: (p) => company.depart(p) },
      // The dispatcher's provisioning API (M11.2), bound with this tenant in props.
      converter: (this.env.PROVISIONING as unknown as Converter | undefined) ?? null,
      pending: new ConversionState(this.ctx.storage),
      ...memberName(this.env.MEMBERS, this.name),
      model: this.modelDeps(),
    };
  }

  /**
   * Empties every chat this person owns, their vectors in the tenant index, and this object's own
   * storage: the end of their scope here. Says whether the index let go of the vectors.
   */
  private async emptyAll(): Promise<{ ok: true; vectors: number } | { ok: false; code: string; reason: string }> {
    for (const id of this.chats.list()) await (await getAgentByName(this.env.CHAT, id)).purge(this.name);
    const index = this.semantic ? await this.semantic.purge(this.personMemory.chunkIds()) : { ok: true as const, vectors: 0 };
    await this.ctx.storage.deleteAll();
    return index;
  }

  /** Offboarding (M11): the handover drafted into proposals awaiting the person, and the policy they are told. */
  async offboardStart(actor: Actor) {
    return startOffboarding(this.offboardingDeps(), actor);
  }

  /**
   * Export, then the purge and the seat, after which this object and the person's chats hold nothing;
   * or a conversion asked of the platform, which purges only on its completion.
   */
  async offboardFinish(actor: Actor, choice: unknown) {
    const r = await finishOffboarding(this.offboardingDeps(), actor, choice);
    if (r.ok && r.choice === "export") return { ...r, index: await this.emptyAll() };
    return r;
  }

  /** Where the person's offboarding stands: a conversion asked for and not completed, or none. */
  async offboardingStatus() {
    return { pending: new ConversionState(this.ctx.storage).get() };
  }

  /** The platform reads the pending conversion's bundle (M11.2); only the dispatcher's own call reaches this. */
  async conversionBundle(request: unknown) {
    return conversionBundle(this.offboardingDeps(), request);
  }

  /** The platform's completion: on success the scope here is purged and the seat released. */
  async conversionComplete(input: { request?: unknown; ok?: unknown; code?: unknown }) {
    const r = await completeConversion(this.offboardingDeps(), input);
    if (r.ok && r.converted) return { ...r, index: await this.emptyAll() };
    return r;
  }

  /** In the new standalone tenant: the converted scope restored into this person's empty stores. */
  async conversionRestore(markdown: unknown) {
    if (typeof markdown !== "string") return { ok: false as const, code: "BUNDLE_INVALID", reason: "no bundle" };
    const r = await restorePersonal(this.personMemory, markdown, "qyvr:conversion", (path, text) => this.files.write({ path, text }, { requester: this.name, writer: "qyvr:conversion" }));
    if (r.ok) await this.armRender();
    return r;
  }

  private get authority(): PersonAuthority {
    this.authorityInstance ??= new PersonAuthority(this.ctx.storage, this.env.TENANT_ID, this.name, {
      snapshot: () => this.company().snapshot(),
      use: (grantId, effectId, at) => this.company().useGrant(grantId, effectId, at),
    }, () => Date.now(), (i) => this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID)).grantForAction({ person: this.name, ...i }));
    return this.authorityInstance;
  }

  private get browse(): PersonBrowse {
    this.browseInstance ??= new PersonBrowse(this.ctx.storage, () => Date.now());
    return this.browseInstance;
  }

  /** What this person's agent has learned of one domain's browsing (M9): engine and block state, no content. */
  async browseDomain(domain: string): Promise<DomainMemory | null> { return this.browse.get(domain); }
  async browseRecord(row: Omit<DomainMemory, "at">): Promise<void> { return this.browse.record(row); }

  /** The grants engine's answer for one descriptor, read-only (M7.1). */
  async grantDecide(d: Descriptor): Promise<Decision> {
    return this.authority.decide(d);
  }

  /** The gate's answer when an action is about to run, recording the use where the grant lives. */
  async grantCommit(d: Descriptor, effectId: string, args?: Record<string, unknown>): Promise<Decision> {
    return this.authority.commit(d, effectId, args);
  }

  async createGrant(by: string, input: unknown): Promise<CreateResult> {
    return this.authority.create(by, input);
  }

  async revokeGrant(by: string, id: string) {
    return this.authority.revoke(by, id);
  }

  async listGrants(by: string): Promise<Grant[] | null> {
    return this.authority.list(by);
  }

  /** The person's live grants naming `requester`, for the `colleagues` namespace. */
  async grantsNaming(requester: string) {
    return this.authority.naming(requester);
  }

  /** A colleague's request to this person's agent: checked here, run in a chat of its own. */
  async receiveRequest(r: ColleagueRequest): Promise<RequestOutcome> {
    const ledger = this.env.LEDGER.get(this.env.LEDGER.idFromName(this.env.TENANT_ID)) as unknown as { journal(row: JournalRow): Promise<unknown> };
    return receiveRequest(
      {
        person: this.name,
        lookup: (email) => this.company().lookup(email),
        openChat: () => this.chats.open(Date.now(), "request"),
        run: async (chatId, input) => (await getAgentByName(this.env.CHAT, chatId)).request({ ...input, person: this.name }),
        journal: (row) => ledger.journal(row),
        now: () => Date.now(),
        attach: (a) => this.attachments.fromRequest(a),
      },
      r,
    );
  }

  /** Mail the platform received and sealed for this person (M6.1); it lands fenced in their chat. */
  async receiveMail(m: InboundMail) { return this.mail.receive(m); }
  /** Staging's mail probe (M6.2): the chat the person's mail lands in, if any yet. */
  async mailChatId(): Promise<string | null> { return this.mail.mailChatId(); }
  /** Mail the person's agent sends from one of their chats, labelled by the platform (A6, B3). */
  async sendMail(by: string, m: OutboundMail) { return this.mail.send(by, m); }

  private attachmentsInstance?: PersonAttachments;
  /** The person's attachments (M24.3, `attachments/store.ts`): uploads, mail's files and colleagues' requests' files, decided here. */
  private get attachments(): PersonAttachments { this.attachmentsInstance ??= new PersonAttachments(this.ctx.storage, attachmentDeps(this.env, this.ctx.storage, this.name)); return this.attachmentsInstance; }
  async attachmentCall(by: string, call: AttachmentCall | AttachmentLinkCall) { return runAttachmentCall(this.attachments, this.links, by, call); }

  // The person's files, each decided in the store for the owner alone; rename and pin are the Library's item menu (M23.4).
  async fileList(input: { prefix?: string; preview?: boolean }, requester: string) { return this.files.list(input, requester); }
  async fileRead(input: { path: string; from?: number; limit?: number }, requester: string) { return this.files.read(input, requester); }
  async fileWrite(input: { path: string; text: string }, ctx: { requester: string; writer: string }) { return this.files.write(input, ctx); }
  async fileDelete(input: { path: string }, requester: string) { return this.files.remove(input, requester); }
  async fileRename(input: { path: string; to: string }, requester: string) { return this.files.rename(input, requester); }
  async filePin(input: { path: string; pinned: boolean }, requester: string) { return this.files.pin(input, requester); }
  /** Rendered documents and signed links (M24.3, `files/links.ts`); `sharedFile` answers a public share link with no session. */
  async documentCall(requester: string, call: DocumentCall) { return documentCall(this.files, this.links, requester, call); }
  async sharedFile(token: string) { return this.links.shared(token); }
  /** The working tree, `work/` (M24.3): the Agents SDK `Workspace` in this object's SQLite, decided in `PersonTree` for the owner alone. */
  async treeCall(call: TreeCall, requester: string) { return runTreeCall(treeOf(this.ctx.storage, this.name), call, requester); }

  /** Creates the person's profile when an admin's invitation enrols them (M4.1). */
  async enroll(input: { role: Profile["role"]; enrolledBy: string | null }): Promise<Profile> {
    const profile = new PersonProfile(this.ctx.storage, this.name).enroll(input, Date.now());
    await this.chats.main(Date.now());
    return profile;
  }

  async openChat(): Promise<OpenResult> { return this.chats.open(Date.now()); }

  /** A `Job` object names its owner here when it holds a job (M14.2); the app lists them to the person alone. */
  async noteJob(id: string): Promise<boolean> {
    return new PersonJobIndex(this.ctx.storage).note(id, Date.now());
  }

  /** A removed job leaves the list; its object says so (M25.6). */
  async forgetJob(id: string): Promise<void> { new PersonJobIndex(this.ctx.storage).forget(id); }
  async jobIds(requester: string): Promise<string[] | null> { return requester === this.name ? new PersonJobIndex(this.ctx.storage).list() : null; }

  /** The saved home zone a job is set in (M25.2); only the person's own chat asks. */
  async homeZone(requester: string, seen: string | undefined): Promise<string | null> {
    return requester === this.name ? new PersonJobIndex(this.ctx.storage).homeZone(seen) : null;
  }

  /** The person's chat list (M14.2): the main chat, side chats, archive, delete and titles. */
  async chatsCall(requester: string, call: ChatsCall) {
    return runChatsCall(this.chats, this.name, requester, call, Date.now());
  }

  async platformCall(call: PersonPlatformCall) { return personPlatformCall(this.ctx.storage, this.schema, { chats: () => this.chats.list(), jobs: () => new PersonJobIndex(this.ctx.storage).list(), name: this.name }, call as never); }

  async ownsChat(chatId: string): Promise<boolean> {
    return this.chats.owns(chatId);
  }

  /** A page's socket to one of this person's chats: owned, and recorded as the chat last open (M17.1). */
  async connectChat(chatId: string): Promise<boolean> {
    return this.chats.connected(chatId, Date.now());
  }

  async memorySearch(input: { queries: string[]; maxResults?: number }, requester: string, also?: string[]) {
    return this.memory.memorySearch(input, requester, also);
  }

  async memoryGet(input: { path: string; from?: number; limit?: number }, requester: string, also?: string[]) {
    return this.memory.memoryGet(input, requester, also);
  }

  async memoryExplain(input: { claimId?: string; citation?: string }, requester: string, also?: string[]) {
    return this.memory.memoryExplain(input, requester, also);
  }

  async memoryLineSource(input: { citation: string }, requester: string) {
    return this.memory.memoryLineSource(input, requester);
  }

  /** An admin's read of this person's memory or chats (A9): refused here, where they are owned, and journaled. */
  async adminRead(by: string, area: AdminArea) {
    const ledger = this.env.LEDGER.get(this.env.LEDGER.idFromName(this.env.TENANT_ID)) as unknown as { journal(row: JournalRow): Promise<unknown> };
    return adminPersonalRead(
      { person: this.name, read: (a, r) => (a === "memory" ? this.memory.memoryGet({ path: "MEMORY.md" }, r) : this.chatList(r)), journal: (row) => ledger.journal(row), now: () => Date.now() },
      by,
      area,
    );
  }

  /** The person's chats, listed to the person alone; an admin is refused here, where the chats are owned (A9). */
  async chatList(requester: string) {
    return ownChats(this.name, requester, () => this.chats.list());
  }

  async memoryWrite(input: MemoryWriteInput, ctx: WriteContext) {
    const result = await this.memory.memoryWrite(input, ctx);
    if (result.ok && input.target !== "team") await this.armRender();
    return result;
  }

  async standingFiles() {
    return this.memory.standingFiles();
  }

  async upsertEntity(input: EntityInput, writer: string) {
    return this.memory.upsertEntity(input, writer);
  }

  async forgetPlan(input: { claimIds?: string[]; query?: string; sites?: string[] }, requester: string) {
    return this.memory.forgetPlan(input, requester, forgetProducers({ env: this.env, storage: this.ctx.storage, person: this.name }));
  }
  async forgetConfirm(planId: string, requester: string) {
    // The plan's sites take their saved browser logins with them (M24.3); a Vault that did not answer is said.
    const r = await forgetConfirmed(this.memory, () => this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID)), this.name, planId, requester);
    if (r.ok) await this.armRender();
    return r;
  }

  // Staging probes for M12.2's live lane: the person's own memory and loops, refused elsewhere. -----

  private staging(): { ok: false; code: string; reason: string } | null {
    return this.env.QYVR_ENV === "staging" ? null : { ok: false, code: "NOT_FOUND", reason: "memory probes exist in staging only" };
  }

  /** Lines in the person's own daily note, idempotent by `dedupe`, so a re-run seeds nothing twice. */
  async devMemorySeed(lines: Array<{ text: string; dedupe: string }>) {
    const off = this.staging();
    if (off) return off;
    const citations: string[] = [];
    for (const l of lines) {
      const w = await this.memoryWrite({ target: "daily", text: l.text }, { requester: this.name, setting: { scope: "personal" }, source: "dev:seed", dedupe: `seed:${l.dedupe}` });
      citations.push(w.ok && "citation" in w ? w.citation : `${(w as { code?: string }).code ?? "MEMORY_WRITE_FAILED"}`);
    }
    return { ok: true, citations };
  }

  /** Renders and pushes every queued chunk now rather than at the timer; says what is still queued. */
  async devMemorySync() {
    const off = this.staging();
    if (off) return off;
    await this.memory.renderPending();
    let upserted = 0;
    let deleted = 0;
    for (let i = 0; i < 20 && this.semantic?.pending(); i++) {
      const r = await this.memory.syncVectors();
      if (!r.ok) return { ...r, upserted, deleted, pending: this.semantic.pending() };
      upserted += r.upserted;
      deleted += r.deleted;
    }
    return { ok: true, upserted, deleted, pending: this.semantic?.pending() ?? null, index: !!this.semantic };
  }

  /** The person's own search, keyword only or fused, each hit's citation resolved (`memory/probe-search.ts`). */
  async devMemorySearch(queries: string[], mode: "keyword" | "hybrid", waitFor?: string) {
    return this.staging() ?? probeSearch(this.personMemory, this.semantic, this.name, { queries, mode, ...(waitFor ? { waitFor } : {}) }, PROBE_WAIT_MS);
  }

  /** One loop ticked as its cron fires it, in the current slot; then what the loop did. */
  async devLoopTick(loop: PersonLoop) {
    const off = this.staging();
    if (off) return off;
    await this.loopTick(loop);
    return this.loops.report(this.name, loop);
  }

  /** The person's loop schedules as the Agents SDK holds them. */
  async devLoopSchedules() {
    const off = this.staging();
    if (off) return off;
    const schedules = (await this.listSchedules()).filter((s) => s.callback === "loopTick").map((s) => ({ loop: s.payload, type: s.type, cron: "cron" in s ? s.cron : null, next: s.time }));
    return { ok: true, schedules };
  }

  /**
   * The render timer: buffered daily lines go to R2, and queued chunks to the index (M12.2). A failed
   * sync leaves them queued and keyword-searchable; it is reported, and the next write retries it.
   */
  async flushMemory(): Promise<void> {
    await this.memory.renderPending();
    const synced = await this.memory.syncVectors();
    if (!synced.ok) log("memory.index.sync", { code: synced.code }, "error");
    else if (this.semantic?.pending()) await this.schedule(RENDER_DELAY_S, "flushMemory");
  }

  private async armRender(): Promise<void> {
    if ((await this.listSchedules()).some((s) => s.callback === "flushMemory")) return;
    await this.schedule(RENDER_DELAY_S, "flushMemory");
  }
}
