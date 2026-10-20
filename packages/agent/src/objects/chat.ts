// The Chat object (AD-1, AD-2): one per conversation, owned by one person, on the Agents SDK. The
// SDK hosts the WebSocket endpoint on the hibernation API and the scheduled resume; the turn,
// transcript and outbox are the engine's (`chat/engine.ts`). The owner is decided here, on every
// connection and every frame: the person comes from the header the agent script sets from props,
// and frames go only to the owner's connections.
import { PrimaryFault } from "../model/fault.ts";
import { holdTypedSecrets } from "../vault/typed.ts";
import { Agent, type Connection, type ConnectionContext, type WSMessage } from "agents";
import { getAgentByName } from "agents";
import type { Choice } from "../chat/cards.ts";
import { type ChatFrame, ChatEngine, type ClaimResult, type RequestInput } from "../chat/engine.ts";
import { displayNames } from "../company/members.ts";
import { connectFrame, ownerOnly, type ProtocolFrame } from "../chat/protocol.ts";
import { answerFrame } from "../chat/socket.ts";
import { codeFor, type CodeHost } from "../code/egress.ts";
import type { RunRequest } from "../code/run.ts";
import { bindingPort, type BrowserBinding, browserOf } from "../browse/binding.ts";
import { meteredPort } from "../browse/meter.ts";
import type { LedgerSink } from "../ledger/types.ts";
import type { DomainMemory } from "../browse/memory.ts";
import type { FillApi, LoginsApi } from "../browse/tools.ts";
import { egressFor, type VaultEgress } from "../connectors/egress.ts";
import type { JobsApi } from "../jobs/tools.ts";
import { type Job, jobName } from "./job.ts";
import { PERSON_HEADER } from "../http/identity.ts";
import { personFiles, personMemory, personTree } from "../memory/rpc.ts";
import { documentsApi } from "../render/tools.ts";
import { onboardingNamespace, type OnboardingApi } from "../company/onboarding-tools.ts";
import { BUILTIN_SKILLS } from "../skills/builtin.ts";
import { SkillCatalog } from "../skills/catalog.ts";
import { SubAgentHost } from "../subagents/host.ts";
import type { SubAgentInput, SubAgentResult } from "../subagents/run.ts";
import { SubAgentStore } from "../subagents/store.ts";
import { verifyHandoff } from "../subagents/verifier.ts";
import { migrateObject, probeObject } from "../migrations/catalog.ts";

type ConnectionState = { person: string };

const send = (connection: Connection, frame: ChatFrame | ProtocolFrame) => connection.send(JSON.stringify(frame));

export class Chat extends Agent<Env> {
  private readonly schema = migrateObject(this.ctx, "chat");

  /** The sweep's wake (M25.3): what this wake applied and what is still behind. */
  async migrationProbe() { return probeObject(this.ctx.storage, this.schema); }
  static options = { sendIdentityOnConnect: false };
  private engineInstance?: ChatEngine;
  private hostInstance?: SubAgentHost;

  /**
   * This chat's sub-agents (M7.2): facets of this object driven by its alarm, since a user Worker
   * runs no Queue consumer (DECISIONS-LOG M7.2).
   */
  private get subagents(): SubAgentHost {
    const deps = { ai: this.env.AI, ledger: this.env.LEDGER.get(this.env.LEDGER.idFromName(this.env.TENANT_ID)), tenant: this.env.TENANT_ID, now: () => Date.now(), wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };
    this.hostInstance ??= new SubAgentHost({
      store: new SubAgentStore(this.ctx.storage),
      transport: {
        run: (input) => {
          const facet = this.ctx.facets.get(`subagent:${input.id}`, () => ({ class: (this.ctx.exports as unknown as { SubAgent: DurableObjectClass }).SubAgent }));
          return (facet as unknown as { run(i: SubAgentInput): Promise<SubAgentResult> }).run(input);
        },
      },
      verify: (who, brief, handoff) => verifyHandoff(deps, who, brief, handoff),
      handoff: (h) => this.engine.handoff(h),
      arm: () => this.armSubagents(),
      now: () => Date.now(),
    });
    return this.hostInstance;
  }

  /** Staging's live lane only (M22.1, `/dev/model-fault`): the engine's binding answers one forced primary failure. */
  private readonly primaryFault = new PrimaryFault();

  private get engine(): ChatEngine {
    const env = this.env.QYVR_ENV === "staging" ? { ...this.env, AI: this.primaryFault.wrap(this.env.AI) } : this.env;
    this.engineInstance ??= new ChatEngine(this.ctx, env, {
      wakeup: { arm: (at) => this.armResume(at), disarm: () => this.disarmResume() },
      // A turn that continues after a decision runs past the decide call; the alarm resumes it if this dies.
      defer: (p) => this.ctx.waitUntil(p),
      sockets: () => this.ownerConnections(),
      memory: (person) => personMemory(this.env, person),
      files: (person) => personFiles(this.env, person),
      tree: (person) => personTree(this.env, person),
      documents: (person) => documentsApi(async (call, requester) => (await getAgentByName(this.env.PERSON, person)).documentCall(requester, call), (input) => this.env.RENDERER.getByName("render").render(input)),
      skills: new SkillCatalog(this.env.AGENT_BUCKET, this.env.TENANT_SHAPE === "company" ? "company" : "standalone", (p) => this.company().teamsOf(p), BUILTIN_SKILLS),
      skillSeen: (person) => async (name, hash) => ((await getAgentByName(this.env.PERSON, person)).platformCall({ op: "skill-seen", name, hash }) as unknown as Promise<"first" | "same" | "changed">),
      code: (person) => codeFor(this.codeHost(), person),
      egress: (person) => egressFor(this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID)) as unknown as VaultEgress, person),
      credentials: (person) => {
        const vault = () => this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID));
        return { list: () => vault().list(person), addApprovedHost: (input, writer) => vault().addApprovedHost(input, writer) };
      },
      secrets: (person, text) => holdTypedSecrets(text, (value) => this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID)).holdTyped({ person, value, source: "chat" })),
      ...(browserOf(this.env) ? { browse: this.browseHook(browserOf(this.env) as BrowserBinding) } : {}),
      authority: (person) => ({
        decide: async (d) => (await getAgentByName(this.env.PERSON, person)).grantDecide(d),
        commit: async (d, effectId, args) => (await getAgentByName(this.env.PERSON, person)).grantCommit(d, effectId, args),
        createGrant: async (by, input) => (await getAgentByName(this.env.PERSON, person)).createGrant(by, input),
      }),
      company: { isAdmin: (person) => this.company().isAdmin(person), createGrant: (by, input) => this.company().createGrant(by, input) },
      colleagues: {
        directory: () => this.company().directory(),
        grantsNaming: async (colleague, requester) => (await getAgentByName(this.env.PERSON, colleague)).grantsNaming(requester),
        request: async (r) => (await getAgentByName(this.env.PERSON, r.to)).receiveRequest(r),
        // The sender's own `Person` decides which of their uploads a request may carry (M24.3).
        shareAttachments: async (principal, ids) => (await (await getAgentByName(this.env.PERSON, principal)).attachmentCall(principal, { op: "share", ids })) as never,
        deliverReply: async (chatId, n) => (await getAgentByName(this.env.CHAT, chatId)).notify(n),
      },
      jobs: this.jobsApi(),
      nameOf: displayNames(this.env.MEMBERS),
      ...(this.env.TENANT_SHAPE === "company" ? { companyInstructions: async () => this.companyText(await this.company().instructions()) } : {}),
      namespaces: (view) => [onboardingNamespace(this.onboardingApi(), () => view.owner() ?? "")],
      subagents: { open: () => new SubAgentStore(this.ctx.storage).open(), status: () => this.subagents.status(), close: (person, ids) => this.subagents.close(person, ids), delegate: (input) => this.subagents.delegate(input) },
    });
    return this.engineInstance;
  }

  /** Code Mode's host (M25.5): the loader on this script and its own `Egress` entrypoint, called from this object. */
  private codeHost(): CodeHost {
    return { env: this.env, exports: this.ctx.exports as unknown as CodeHost["exports"] };
  }

  /** The owner's jobs (M15.7): each is the `Job` object named for the owner, which checks the owner again. */
  private jobsApi(): JobsApi {
    const job = (person: string, id: string) => this.env.JOB.get(this.env.JOB.idFromName(jobName(person, id))) as unknown as Pick<Job, "inspect" | "define" | "enable" | "disable" | "remove">;
    return {
      ids: async (person) => (await (await getAgentByName(this.env.PERSON, person)).jobIds(person)) ?? [],
      inspect: async (person, id) => (await job(person, id).inspect(person)) as Awaited<ReturnType<JobsApi["inspect"]>>,
      // `by` is the agent, not the owner: the job starts off until the owner enables it.
      define: (person, def) => job(person, def.id).define({ owner: person, by: `agent:${person}`, def }),
      enable: (person, id) => job(person, id).enable(person),
      disable: (person, id) => job(person, id).disable(person),
      remove: (person, id) => job(person, id).remove(person),
      homeZone: async (person, seen) => (await (await getAgentByName(this.env.PERSON, person)).homeZone(person, seen)) ?? "UTC",
    };
  }

  /** The browser (M9): the binding's port, the person's engine memory on their `Person`, fill through the Vault. */
  private browseHook(binding: BrowserBinding) {
    const vault = () =>
      this.env.VAULT.get(this.env.VAULT.idFromName(this.env.TENANT_ID)) as unknown as {
        fill(req: { session: string; url: string; selector: string; ref: string; field?: string }, ctx: { person: string; purpose: string }): ReturnType<FillApi["fill"]>;
        scrub(session: string, text: string): Promise<string>;
        saveBrowserState(req: { session: string; url: string }, ctx: { person: string }): ReturnType<LoginsApi["save"]>;
        restoreBrowserState(req: { session: string; url: string }, ctx: { person: string }): ReturnType<LoginsApi["restore"]>;
      };
    return {
      // Browser time lands in the Ledger as a cost on this chat's browsing (M25.4).
      port: meteredPort(
        bindingPort(binding),
        async (t) => {
          const person = this.engine.owner();
          if (!person) throw new Error("no owner for the chat's browser time");
          await (this.env.LEDGER.get(this.env.LEDGER.idFromName(this.env.TENANT_ID)) as unknown as Required<Pick<LedgerSink, "recordBrowser">>).recordBrowser({ tenant: this.env.TENANT_ID, person, runId: `browser:chat:${this.name}`, ...t });
        },
        () => Date.now(),
      ),
      memory: (person: string) => ({
        get: async (domain: string) => (await getAgentByName(this.env.PERSON, person)).browseDomain(domain),
        record: async (row: Omit<DomainMemory, "at">) => (await getAgentByName(this.env.PERSON, person)).browseRecord(row),
      }),
      fill: (person: string): FillApi => ({
        fill: (req) => vault().fill(req, { person, purpose: "browse_fill" }),
        scrub: (session, text) => vault().scrub(session, text),
      }),
      // Saved logins (M24.3): the Vault keeps and restores them for this chat's owner alone.
      logins: (person: string): LoginsApi => ({
        save: (req) => vault().saveBrowserState(req, { person }),
        restore: (req) => vault().restoreBrowserState(req, { person }),
      }),
    };
  }

  /** Onboarding (M11.2): the `Company` decides each step; an invitation enrols the invitee's `Person` as the app's does. */
  private onboardingApi(): OnboardingApi {
    return {
      status: (by) => this.company().onboardingStatus(by),
      invite: async (by, email, role) => {
        const r = await this.company().invite(by, email, role);
        if (!r.ok) return { ok: false, code: r.code };
        await (await getAgentByName(this.env.PERSON, r.member.email)).enroll({ role: r.member.role, enrolledBy: by });
        return r;
      },
      requestWorkspace: (by) => this.company().onboardingRequestWorkspace(by),
    };
  }

  private companyText(v: { text: string } | null) {
    return v ? { tenant: this.env.TENANT_ID, text: v.text } : null;
  }

  private company() {
    return this.env.COMPANY.get(this.env.COMPANY.idFromName(this.env.TENANT_ID));
  }

  /** A colleague's request, sent here by the owner's `Person` (M7.1). */
  async request(input: RequestInput) {
    return this.engine.request(input);
  }

  /** The cards of this chat, rendered by the harness, for its owner. */
  async cardsFor(person: string) {
    return this.engine.cardsFor(person);
  }

  /** When this chat last had something to show (M29.3, the list row's time), for its owner. */
  async lastAt(person: string) {
    return this.engine.lastAt(person);
  }

  /** The link cards this chat showed its owner (M16.2): where a decision is theirs, with no choices. */
  async linksFor(person: string) {
    return this.engine.linksFor(person);
  }

  /** A person deciding cards; the engine refuses anyone but the approver, and every agent session. */
  async decide(ids: string[], by: { person: string; agent: boolean }, choice: Choice) {
    return this.engine.decide(ids, by, choice);
  }

  async clearLatch(person: string) {
    return this.engine.clearLatch(person);
  }

  /** The SDK's state and identity frames are not this socket's protocol. */
  shouldSendProtocolMessages(): boolean {
    return false;
  }

  /** Offboarding (M11): the owner's `Person` empties the chat once the personal scope is exported. */
  async purge(person: string): Promise<{ ok: boolean }> {
    if (this.engine.owner() !== person) return { ok: false };
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }

  /** Called by the owner's `Person` when it opens the chat. */
  async claim(person: string): Promise<ClaimResult> {
    return this.engine.claim(person);
  }

  async onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    const person = ctx.request.headers.get(PERSON_HEADER);
    const first = connectFrame(person, this.engine.owner(), () => this.engine.history());
    if (!first.ok || !person) {
      const code = first.ok ? "NO_SESSION" : first.code;
      send(connection, { type: "refused", code });
      connection.close(4403, code);
      return;
    }
    connection.setState({ person } satisfies ConnectionState);
    // The page drew nothing for this chat yet, or lost it with its socket: its own earlier turns first.
    send(connection, first.frame);
  }

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    const person = (connection.state as ConnectionState | null)?.person;
    if (!person) {
      send(connection, { type: "refused", code: "NO_SESSION" });
      return;
    }
    // A send runs the turn; a `sync` (the page checking its socket, M18.1) is answered with the history.
    const reply = await answerFrame(person, message as string | ArrayBuffer, this.engine, () => {
      // The person is writing: their proactive items wait for a quiet stretch after this (M14.1).
      this.ctx.waitUntil(getAgentByName(this.env.PERSON, person).then((p) => p.deliveryActivity()).catch(() => {}));
    }, async (p, ids, messageId) => (await (await getAgentByName(this.env.PERSON, p)).attachmentCall(p, { op: "bind", ids, chatId: this.name, messageId })) as { ok: true; lines: string[] });
    if (reply) send(connection, reply);
  }

  /** A job's message for the owner (M5.1), idempotent on its id. */
  async notify(n: { id: string; source: string; text: string; person: string }): Promise<ReturnType<ChatEngine["notify"]>> {
    return this.engine.notify(n);
  }

  /** Whether the owner has a client connected here; their `Person` pushes only when none of their chats has one (M14.1). */
  async hasClient(person: string): Promise<boolean> {
    return this.engine.owner() === person && this.ownerConnections().length > 0;
  }

  async hasNotice(id: string): Promise<boolean> {
    return this.engine.hasNotice(id);
  }

  /** The person's "Compact this chat" on the agent sheet (M24.2); the engine decides the owner. */
  async compactNow(person: string): Promise<ReturnType<ChatEngine["compactNow"]>> {
    return this.engine.compactNow(person);
  }

  /** The owner's `Person` reopened (unarchived) this chat: a new conversation epoch (M24.2). */
  async reopen(person: string) {
    return this.engine.reopen(person);
  }

  /** The chat's compaction records, for the owner only (M15.2). */
  async compactionsFor(person: string): Promise<ReturnType<ChatEngine["compactionsFor"]>> {
    return this.engine.compactionsFor(person);
  }

  /** Staging's mail probe (M6.2): the notices, for the owner only. */
  async noticesFor(person: string): Promise<ReturnType<ChatEngine["noticesFor"]>> {
    return this.engine.noticesFor(person);
  }

  /** The scheduled resume of a turn an eviction interrupted. */
  async resumeTurn(): Promise<void> {
    await this.engine.alarm();
  }

  /** The scheduled step of this chat's sub-agents. */
  async runSubagents(): Promise<void> {
    await this.subagents.step();
  }

  /** The sub-agents' status, for the chat's owner only (staging's probe reads it). */
  async subagentStatus(person: string) {
    return this.engine.owner() === person ? this.subagents.status() : null;
  }

  /** Staging's live lane: a delegation started as the main agent's committed call would start it. */
  async probeDelegate(person: string, requests: Array<{ role: "worker" | "coordinator"; brief: string }>) {
    if (this.env.QYVR_ENV !== "staging") return { ok: false, code: "NOT_FOUND" };
    const claimed = this.engine.claim(person);
    if (!claimed.ok) return claimed;
    const grp = `probe-${crypto.randomUUID().slice(0, 8)}`;
    return { grp, decision: await this.subagents.delegate({ grp, turnId: grp, person, requests }) };
  }

  /** Staging's live lane (M25.5): one Code Mode script run from this object for its owner, as `code_execute` runs it. */
  async probeCode(person: string, req: RunRequest) {
    if (this.env.QYVR_ENV !== "staging") return { ok: false, code: "NOT_FOUND" };
    const claimed = this.engine.claim(person);
    if (!claimed.ok) return claimed;
    return codeFor(this.codeHost(), person).run(req);
  }

  async probeGroup(person: string, grp: string) {
    if (this.env.QYVR_ENV !== "staging" || this.engine.owner() !== person) return null;
    return this.subagents.group(grp);
  }

  /** Staging's live lane: a stored worker asking to spawn, decided by the deployed host. */
  /** Staging's live lane (M22.1): the next hedged step's primary fails, so the hedge serves it. */
  async probeModelFault(person: string): Promise<{ ok: true } | { ok: false; code: string }> {
    if (this.env.QYVR_ENV !== "staging" || this.engine.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
    this.primaryFault.arm();
    return { ok: true };
  }

  async probeSpawn(person: string, id: string) {
    if (this.env.QYVR_ENV !== "staging" || this.engine.owner() !== person) return { ok: false, code: "CHAT_NOT_OWNER" };
    return this.subagents.spawn(id, [{ role: "worker", brief: "a worker's own sub-agent" }]);
  }

  /**
   * Always schedules: the step that calls this from inside its own callback is still listed until it
   * returns, so a "one already pending" check would drop its re-arm. An extra step finds nothing to do.
   */
  private async armSubagents(): Promise<void> {
    await this.schedule(0, "runSubagents");
  }

  private ownerConnections(): Connection[] {
    return ownerOnly(this.getConnections<ConnectionState>(), this.engine.owner());
  }

  private async armResume(at: number): Promise<void> {
    await this.disarmResume();
    await this.schedule(new Date(at), "resumeTurn");
  }

  private async disarmResume(): Promise<void> {
    for (const s of await this.listSchedules()) if (s.callback === "resumeTurn") await this.cancelSchedule(s.id);
  }
}
