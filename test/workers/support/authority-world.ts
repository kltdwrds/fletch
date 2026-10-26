// A hermetic two-member `solo-sam` for the authority model (M7.1): the real `Company` object, the
// real `Ledger` with its journal, each member's real `PersonAuthority` and `PersonChats` over the
// object harness, the real request entry (`receiveRequest`), real `ChatEngine` chats with the gate,
// and the agent script's real `route` for the app's requests. Only the fixture connectors are
// stand-ins: a calendar that can project a pending move, work tools for the colleague requests, a
// company `books` connector, a page reader, a restricted HR record, mail, a shop and drafts. Every
// connector call that runs is logged in `performed`; nothing reaches a network. With `stores`, each
// member's `Person` also holds their real memory and files over one in-memory R2 (M7.3).
import { Type } from "@earendil-works/pi-ai";
import { SkillCatalog } from "../../../packages/agent/src/skills/catalog.ts";
import { seedPlatformDocs } from "../../support/platform-docs.ts";
import { searchChat } from "../../../packages/agent/src/chat/search.ts";
import { ChatEngine, type ChatView, type EngineCtx, type EngineHooks } from "../../../packages/agent/src/chat/engine.ts";
import type { ColleagueRequest } from "../../../packages/agent/src/colleagues/tools.ts";
import type { ApprovalAdapter, CapabilityAdapter, WorkspaceAdapter } from "../../../packages/agent/src/workspace/adapters.ts";
import { companyView } from "../../../packages/agent/src/company/authority.ts";
import { displayNames } from "../../../packages/agent/src/company/members.ts";
import { PersonFiles } from "../../../packages/agent/src/files/store.ts";
import { documentCall, PersonLinks, routeShare } from "../../../packages/agent/src/files/links.ts";
import { documentsApi } from "../../../packages/agent/src/render/tools.ts";
import type { RenderResult } from "../../../packages/agent/src/render/render.ts";
import type { FilesApi } from "../../../packages/agent/src/files/tools.ts";
import { directTreeApi, treeOf } from "../../../packages/agent/src/tree/rpc.ts";
import type { PersonTree } from "../../../packages/agent/src/tree/tree.ts";
import { PersonAuthority } from "../../../packages/agent/src/grants/authority.ts";
import type { JournalRow } from "../../../packages/agent/src/grants/journal.ts";
import type { Descriptor, Grant } from "../../../packages/agent/src/grants/types.ts";
import type { AuthorityDirectory } from "../../../packages/agent/src/http/authority-routes.ts";
import type { AdminDirectory } from "../../../packages/agent/src/http/admin-routes.ts";
import type { LifecycleDirectory } from "../../../packages/agent/src/http/lifecycle-routes.ts";
import { onboardingNamespace, type OnboardingApi } from "../../../packages/agent/src/company/onboarding-tools.ts";
import { adminPersonalRead, ownChats } from "../../../packages/agent/src/company/admin.ts";
import type { CompanyMemoryApi } from "../../../packages/agent/src/memory/company.ts";
import { type Directory, route } from "../../../packages/agent/src/http/routes.ts";
import { MemoryService } from "../../../packages/agent/src/memory/service.ts";
import { legFor } from "../../../packages/agent/src/memory/semantic.ts";
import { PersonMemory } from "../../../packages/agent/src/memory/store.ts";
import { Company } from "../../../packages/agent/src/objects/company.ts";
import { type JobDeps, JobEngine } from "../../../packages/agent/src/jobs/engine.ts";
import { jobToolSpecs } from "../../../packages/agent/src/jobs/job-tools.ts";
import { completeForJob } from "../../../packages/agent/src/jobs/model.ts";
import type { JobsApi } from "../../../packages/agent/src/jobs/tools.ts";
import { PersonJobIndex } from "../../../packages/agent/src/person/job-index.ts";
import { Ledger } from "../../../packages/agent/src/objects/ledger.ts";
import { chatTask, chatTasks } from "../../../packages/agent/src/chat/activity.ts";
import { PersonChats, runChatsCall } from "../../../packages/agent/src/person/chats.ts";
import type { AppDirectory } from "../../../packages/agent/src/http/app-routes.ts";
import type { CredentialMint } from "../../../packages/agent/src/grants/credential-use.ts";
import { receiveRequest } from "../../../packages/agent/src/person/requests.ts";
import type { Namespace, ToolSpec } from "../../../packages/agent/src/tools/registry.ts";
import { FakeModel, type FakeMode, type FakeStep } from "../../support/fake-model.ts";
import { harnessNamespace, ObjectHarness } from "../../support/object-harness.ts";
import people from "../../fixtures/people.json" with { type: "json" };
import { asBucket, FakeR2 } from "./fake-r2.ts";

export const TENANT = "solo-sam";
export const person = (id: string) => people.people.find((p) => p.id === id) as (typeof people.people)[number];
export const ada = person("sam-solo");
/** Tuesday 13 October 2026, 10:00 UTC. */
export const T0 = Date.UTC(2026, 9, 13, 10, 0);

const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });
const args = Type.Object({}, { additionalProperties: true });
/** Declared (optional) parameters, so a live model is told what the fixture's tool takes (M15.1). */
const params = (props: Record<string, "string" | "number">) =>
  Type.Object(Object.fromEntries(Object.entries(props).map(([k, t]) => [k, Type.Optional(t === "number" ? Type.Number() : Type.String())])), { additionalProperties: true });

export interface WorldOptions {
  script?: FakeStep[];
  mode?: FakeMode;
  /** Role overrides for this world only, e.g. a second admin so the admin is not the principal. */
  roles?: Record<string, "owner" | "admin" | "member">;
  /** Hostile pages by id, for the injection family. */
  pages?: Record<string, string>;
  /** Each member's real memory and files on their `Person`, offered to their chats (M7.3). */
  stores?: boolean;
  /** The platform docs in the tenant bucket, read by the chats' `skill_read` (M24.1). */
  docs?: boolean;
  /** The company workspace the chats' `workspace` namespace reaches (M8.1). */
  workspace?: WorkspaceAdapter & CapabilityAdapter & ApprovalAdapter;
  /** The browser the chats' `browse` namespace reaches (M9). */
  browse?: EngineHooks["browse"];
  /** Bindings the `Company` sees beside the Ledger, the bucket and the model, e.g. VAULT or WORKSPACE (M10.2). */
  companyEnv?: Record<string, unknown>;
  /** The environment every object sees (`QYVR_ENV`); "test" unless a test needs staging's defaults (M28.1). */
  qyvrEnv?: "test" | "staging";
  /** A fresh tenant (M11.2): its shape, and the members its tenant file seeds. */
  shape?: "company" | "standalone";
  seed?: Array<typeof ada>;
  /** The chats offer the `onboarding` namespace, as `objects/chat.ts` does (M11.2). */
  onboarding?: boolean;
  /** The tenant's Vectorize index (M12.2): each `Person`'s memory and the `Company` fuse it with FTS5. */
  index?: unknown;
  /** More namespaces beside the fixtures, given the chat's owner: a test's own tool on a production path (M25.1). */
  namespaces?: (owner: () => string) => import("../../../packages/agent/src/tools/registry.ts").Namespace[];
  /** The Vault's egress, the credentials the agent may see (M13) and Code Mode over it (M25.5), as `objects/chat.ts` wires them. */
  vault?: Pick<EngineHooks, "egress" | "credentials" | "code">;
  /** The Vault's hold for secrets typed in chat, as `objects/chat.ts` wires it (M14.2). */
  secrets?: EngineHooks["secrets"];
  /** The Vault's one-shot credential grant on an allow-once commit, as `objects/person.ts` wires it (M14.2). */
  mint?: (person: string) => CredentialMint;
  /** The chats offer the `jobs` namespace over real `Job` engines on this clock, as `objects/chat.ts` wires it (M15.7). */
  jobs?: boolean;
  /** The Vault's listing for the connectors page (M23.5): each person's own credentials and the company's, never a value. */
  credentials?: (person: string) => Promise<import("../../../packages/agent/src/vault/core.ts").CredentialInfo[]>;
  /** The Renderer the chats' `documents` namespace reaches (M24.3); with it, each `Person` serves documents and signed links. */
  render?: (input: { markdown: string; to: string }) => Promise<RenderResult>;
  /** A model binding in place of the scripted fake: the live eval arms' gateway shim (M15.1). */
  ai?: { run: (model: string, inputs: unknown, options: unknown) => Promise<Response> };
  /** Each member's attachments as `objects/person.ts` and `objects/chat.ts` wire them (M24.3): the sender's store shares, the recipient's keeps. */
  attachments?: { share: NonNullable<import("../../../packages/agent/src/colleagues/tools.ts").ColleaguesApi["shareAttachments"]>; attach: (to: string) => NonNullable<import("../../../packages/agent/src/person/requests.ts").RequestDeps["attach"]> };
}

export function authorityWorld(o: WorldOptions = {}) {
  const clock = { now: T0 };
  const fake = new FakeModel(o.script ?? [], o.mode ?? { kind: "scripted" });
  const aiBinding = o.ai ?? fake.binding;
  const members = (o.seed ?? [ada]).map((p) => ({ email: p.email, role: o.roles?.[p.email] ?? p.role, name: p.name }));
  const env = { TENANT_ID: TENANT, TENANT_SHAPE: o.shape ?? "company", QYVR_ENV: o.qyvrEnv ?? "test", HOST: { memberSeed: JSON.stringify(members) } };
  const performed: string[] = [];
  const calendar = new Map<string, Map<string, string>>(members.map((m) => [m.email, new Map([["evt-1", "thu"], ["evt-2", "wed"], ["evt-9", "mon"]])]));
  const pages = o.pages ?? {};

  const ledgerH = new ObjectHarness("ledger", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), env, (l) => {
    l.now = () => clock.now;
  });
  const ledgers = { idFromName: (n: string) => ({ name: n }), get: () => ledgerH.instance };
  const r2 = new FakeR2();
  const companyH = new ObjectHarness("company", (ctx, e) => new Company(ctx as DurableObjectState, e as Env), { ...env, LEDGER: ledgers, AGENT_BUCKET: asBucket(r2), AI: aiBinding, ...(o.index ? { MEMORY_INDEX: o.index } : {}), ...o.companyEnv });
  const company = () => companyH.instance;
  /** The company's memory as each `Person` reaches it, as `objects/person.ts` wires it (M10.1). */
  const companyMemory: CompanyMemoryApi = {
    search: (i, r) => company().memorySearch(i, r),
    get: (i, r) => company().memoryGet(i, r),
    append: (by, i) => company().memoryAppend(by, i),
  };
  const persons = new Map<string, ObjectHarness<{ authority: PersonAuthority; chats: PersonChats; memory: MemoryService; files: PersonFiles; links: PersonLinks; tree: PersonTree; jobs: PersonJobIndex }>>();
  const host = (email: string) => {
    let h = persons.get(email);
    if (!h) {
      h = new ObjectHarness(email, (ctx) => {
        const storage = (ctx as DurableObjectState).storage;
        return {
          authority: new PersonAuthority(storage, TENANT, email, { snapshot: () => company().snapshot(), use: (g, e, at) => company().useGrant(g, e, at) }, () => clock.now, o.mint?.(email)),
          chats: new PersonChats(storage, email, async (chatId, p) => chats.harness(chatId).instance.claim(p)),
          memory: (() => {
            const mem = new PersonMemory(storage, asBucket(r2), email, () => clock.now);
            // As `objects/person.ts` builds it: the leg under this person's name in the Ledger.
            const leg = legFor({ index: o.index, ai: aiBinding as never, ledger: ledgerH.instance as never, tenant: TENANT, store: email, sql: () => mem.sql, now: () => clock.now });
            return new MemoryService(mem, companyMemory, leg);
          })(),
          ...(() => {
            const files = new PersonFiles(storage, asBucket(r2), email, () => clock.now);
            // Signed links and shares (M24.3) over the same files and storage, as `objects/person.ts` builds them.
            return { files, links: new PersonLinks(storage, files, asBucket(r2), () => clock.now) };
          })(),
          // The working tree (M24.3), as `objects/person.ts` builds it: the Workspace over this object's storage.
          tree: treeOf(storage, email),
          jobs: new PersonJobIndex(storage),
        };
      }, env);
      persons.set(email, h);
    }
    return h.instance;
  };

  /** One `Job` object per owner and id, as `objects/job.ts` names them; its chat notices go to the real chats. */
  const jobDeps: JobDeps = {
    now: () => clock.now,
    get: () => async () => ({ ok: false, code: "EGRESS_UNAVAILABLE", reason: "no egress in this world" }) as never,
    ledger: { recordRun: (row) => ledgerH.instance.recordRun(row) },
    complete: (a) => completeForJob({ ai: aiBinding as unknown as Ai, ledger: ledgerH.instance, tenant: TENANT, now: () => clock.now, wait: async () => {} }, a),
    chat: (chatId) => ({ notify: async (n) => chats.harness(chatId).instance.notify(n), hasNotice: async (id) => chats.harness(chatId).instance.hasNotice(id) }),
    index: async (owner, id) => host(owner).jobs.note(id, clock.now),
    forget: async (owner, id) => host(owner).jobs.forget(id),
    // As `objects/job.ts` builds them: the owner's memory, read as the owner alone (M25.2).
    tools: (owner, jobId) => jobToolSpecs({ owner, jobId, get: jobDeps.get(owner, `job:${jobId}`), memory: host(owner).memory }),
  };
  const jobObjects = new Map<string, ObjectHarness<JobEngine>>();
  const jobOf = (owner: string, id: string) => {
    const key = `${owner}/${id}`;
    let h = jobObjects.get(key);
    if (!h) {
      h = new ObjectHarness(key, (ctx, e) => new JobEngine({ storage: (ctx as { storage: never }).storage }, e as unknown as JobDeps), jobDeps as unknown as Record<string, unknown>);
      jobObjects.set(key, h);
    }
    return h;
  };
  const jobsApi: JobsApi = {
    ids: async (p) => host(p).jobs.list(),
    inspect: async (p, id) => jobOf(p, id).instance.inspect(p) as never,
    define: (p, def) => jobOf(p, def.id).instance.define({ owner: p, by: `agent:${p}`, def }),
    enable: (p, id) => jobOf(p, id).instance.enable(p),
    disable: (p, id) => jobOf(p, id).instance.disable(p),
    remove: (p, id) => jobOf(p, id).instance.remove(p),
    homeZone: async (p, seen) => host(p).jobs.homeZone(seen),
  };

  /** Called after the gate's call-time answer and before the commit, to plant a change in between. */
  const hooks: { beforeCommit?: (d: Descriptor) => Promise<void> | void } = {};

  const fixtures = (view: ChatView): Namespace[] => {
    const owner = () => view.owner() ?? "";
    const log = (tool: string, a: Record<string, unknown>) => performed.push(`${owner()}:${tool}:${JSON.stringify(a)}`);
    const resource = (a: Record<string, unknown>) => ({ scope: "personal" as const, resource: String(a.resource ?? a.event ?? "none") });
    const work = (name: string, actionKind: string): ToolSpec => ({
      name, kind: "action", label: name.replace("_", " "), description: `Fixture: ${actionKind} on a resource.`, parameters: params({ resource: "string", text: "string" }), actionKind, subject: resource,
      execute: async (_id, a) => {
        log(name, a as Record<string, unknown>);
        return text(`${actionKind} done`);
      },
    });
    const tools: ToolSpec[] = [
      {
        name: "calendar_list", kind: "observation", label: "calendar", description: "Fixture: the person's calendar.", parameters: args,
        execute: async () => {
          const events = new Map(calendar.get(owner()));
          // A projecting connector reads pending simulated moves as applied.
          for (const p of view.pending()) if (p.tool === "calendar_move") events.set(String(p.args.event), String(p.args.to));
          return text([...events].map(([e, d]) => `${e}: ${d}`).join("\n"));
        },
      },
      {
        name: "calendar_move", kind: "action", label: "move a meeting", description: "Fixture: move a calendar event.", parameters: params({ event: "string", to: "string" }), actionKind: "calendar.move", subject: resource,
        project: (a) => `moved ${String(a.event)} to ${String(a.to)}`,
        execute: async (_id, a) => {
          log("calendar_move", a as Record<string, unknown>);
          calendar.get(owner())?.set(String((a as Record<string, unknown>).event), String((a as Record<string, unknown>).to));
          return text(`moved ${String((a as Record<string, unknown>).event)} to ${String((a as Record<string, unknown>).to)}`);
        },
      },
      work("reports_read", "reports.read"),
      work("docs_share", "docs.share"),
      work("notes_post", "notes.post"),
      {
        name: "books_read", kind: "observation", label: "read the books", description: "Fixture: the company's books.", parameters: args,
        actionKind: "books.read", subject: () => ({ scope: "company", connector: "books" }),
        execute: async (_id, a) => {
          log("books_read", a as Record<string, unknown>);
          return text("revenue 120");
        },
      },
      {
        name: "page_fetch", kind: "observation", label: "read a page", description: "Fixture: read a web page by its id, as `page`.", parameters: params({ page: "string" }), external: true,
        execute: async (_id, a) => text(pages[String((a as Record<string, unknown>).page)] ?? "(empty page)"),
      },
      {
        name: "hr_record", kind: "observation", label: "HR record", description: "Fixture: a restricted HR record.", parameters: args, external: true,
        execute: async () => text("salary band 7; under review", { sensitivity: "restricted" }),
      },
      {
        name: "mail_send", kind: "action", label: "send mail", description: "Fixture: send mail.", parameters: params({ to: "string", body: "string" }), actionKind: "mail.send",
        subject: () => ({ scope: "personal", connector: "mail" }), recipients: (a) => [String(a.to)],
        execute: async (_id, a) => {
          log("mail_send", a as Record<string, unknown>);
          return text("sent");
        },
      },
      {
        name: "shop_buy", kind: "action", label: "buy", description: "Fixture: buy something.", parameters: params({ item: "string", amount: "number" }), actionKind: "purchase", purchase: true,
        subject: () => ({ scope: "personal", connector: "shop" }), amount: (a) => ({ value: Number(a.amount ?? 0), currency: "EUR" }),
        execute: async (_id, a) => {
          log("shop_buy", a as Record<string, unknown>);
          return text("bought");
        },
      },
      {
        name: "drafts_save", kind: "observation", label: "save a draft", description: "Fixture: save a draft in the person's own drafts.", parameters: params({ text: "string" }), mutates: true,
        execute: async (_id, a) => {
          log("drafts_save", a as Record<string, unknown>);
          return text("draft saved");
        },
      },
    ];
    return [{ name: "fixtures", description: "fixture connectors", deferral: "eager", tools }];
  };

  /** Onboarding as `objects/chat.ts` wires it: the `Company` decides each step. */
  const onboardingApi: OnboardingApi = {
    status: (by) => company().onboardingStatus(by),
    invite: async (by, email, role) => {
      const r = await company().invite(by, email, role);
      return r.ok ? r : { ok: false, code: r.code };
    },
    requestWorkspace: (by) => company().onboardingRequestWorkspace(by),
  };

  /** The `Person`'s files as the chat reaches them, as `objects/person.ts` serves them. */
  const filesOf = (p: string): FilesApi => {
    const f = () => host(p).files;
    return { fileList: async (i, r) => f().list(i, r), fileRead: async (i, r) => f().read(i, r), fileWrite: async (i, c) => f().write(i, c), fileDelete: async (i, r) => f().remove(i, r) };
  };

  const nameOf = displayNames(env.HOST.memberSeed);
  const request = (r: ColleagueRequest) =>
    receiveRequest(
      {
        person: r.to,
        lookup: (email) => company().lookup(email),
        openChat: () => host(r.to).chats.open(clock.now, "request"),
        run: (chatId, input) => chats.harness(chatId).instance.request({ ...input, person: r.to }),
        journal: (row) => ledgerH.instance.journal(row),
        now: () => clock.now,
        ...(o.attachments ? { attach: o.attachments.attach(r.to) } : {}),
      },
      r,
    );

  const docsSeeded = o.docs ? seedPlatformDocs(r2) : Promise.resolve();
  const docsCatalog = new SkillCatalog(
    {
      list: async (x) => {
        await docsSeeded;
        return r2.list(x);
      },
      get: async (k) => {
        await docsSeeded;
        return r2.get(k);
      },
    },
    "company",
  );
  const chats: ReturnType<typeof harnessNamespace<ChatEngine>> = harnessNamespace((name) =>
    new ObjectHarness<ChatEngine>(
      name,
      (ctx, e) =>
        new ChatEngine(ctx as EngineCtx, e as Env, {
          namespaces: (view) => [...fixtures(view), ...(o.onboarding ? [onboardingNamespace(onboardingApi, () => view.owner() ?? "")] : []), ...(o.namespaces?.(() => view.owner() ?? "") ?? [])],
          ...(o.workspace ? { workspace: { tenant: TENANT, api: { workspaces: o.workspace, capabilities: o.workspace, approvals: o.workspace } } } : {}),
          ...(o.browse ? { browse: o.browse } : {}),
          ...(o.vault ?? {}),
          ...(o.secrets ? { secrets: o.secrets } : {}),
          ...(o.jobs ? { jobs: jobsApi } : {}),
          ...(o.stores ? { memory: (p: string) => host(p).memory, files: filesOf, tree: (p: string) => directTreeApi(host(p).tree) } : {}),
          ...(o.docs ? { skills: docsCatalog } : {}),
          ...(o.render ? { documents: (p: string) => documentsApi(async (call, requester) => documentCall(host(p).files, host(p).links, requester, call), o.render as never) } : {}),
          authority: (p) => ({
            decide: (d) => host(p).authority.decide(d),
            commit: async (d, effectId, a) => {
              await hooks.beforeCommit?.(d);
              return host(p).authority.commit(d, effectId, a);
            },
            createGrant: async (by, input) => host(p).authority.create(by, input),
          }),
          company: { isAdmin: (p) => company().isAdmin(p), createGrant: (by, input) => company().createGrant(by, input) },
          colleagues: {
            directory: () => company().directory(),
            grantsNaming: (c, r) => host(c).authority.naming(r),
            request,
            deliverReply: async (chatId, n) => chats.harness(chatId).instance.notify(n),
            ...(o.attachments ? { shareAttachments: o.attachments.share } : {}),
          },
          nameOf,
          companyInstructions: async () => {
            const v = await company().instructions();
            return v ? { tenant: TENANT, text: v.text } : null;
          },
        }),
      { ...env, AI: aiBinding, LEDGER: ledgers },
      (c) => {
        c.now = () => clock.now;
        c.wait = async () => {};
      },
    ),
  );

  const authorityDir: AuthorityDirectory = {
    cards: async (chatId, p) => ((await host(p).chats.owns(chatId)) ? chats.harness(chatId).instance.cardsFor(p) : null),
    decide: async (chatId, ids, by, choice) => chats.harness(chatId).instance.decide(ids, by, choice),
    clearLatch: async (chatId, p) => chats.harness(chatId).instance.clearLatch(p),
    compact: async (chatId, p) => chats.harness(chatId).instance.compactNow(p),
    grants: (p) => ({ create: async (by, input) => host(p).authority.create(by, input), list: async (by) => host(p).authority.list(by), revoke: async (by, id) => host(p).authority.revoke(by, id) }),
    request: async (to, r) => ((await company().lookup(to)) ? request({ from: r.from, to, text: r.text, origin: r.from, hops: 0, viaAgent: false }) : { ok: false, code: "COLLEAGUE_NOT_A_MEMBER", reason: "no such colleague" }),
    directory: () => company().directory(),
    addPolicy: (by, input) => company().addPolicy(by, input),
    companyGrant: (by, input) => company().createGrant(by, input),
  };
  /** The admin routes' directory, as `index.ts` wires it: the Company checks roles, the Person refuses (M10.1). */
  const adminDir: AdminDirectory = {
    journal: (by, p) => company().adminJournal(by, p),
    ledger: (by, p) => company().adminLedger(by, p),
    personalRead: (p, by, area) =>
      adminPersonalRead(
        {
          person: p,
          read: async (a, r) => (a === "memory" ? host(p).memory.memoryGet({ path: "MEMORY.md" }, r) : ownChats(p, r, () => host(p).chats.list())),
          journal: (row) => ledgerH.instance.journal(row),
          now: () => clock.now,
        },
        by,
        area,
      ),
    isMember: async (p) => !!(await company().lookup(p)),
    teams: () => company().teamList(),
    createTeam: (by, input) => company().createTeam(by, input),
    setTeamMember: (by, team, email, inTeam) => company().setTeamMember(by, team, email, inTeam),
    setRole: (by, email, role) => company().setRole(by, email, role),
    instructions: () => company().instructions(),
    instructionsHistory: (by) => company().instructionsHistory(by),
    writeInstructions: (by, text) => company().writeInstructions(by, text),
    writeMemory: (by, input) => company().memoryAppend(by, { ...input, writer: `person:${by}`, source: "admin-ui" }),
    overview: (by) => company().overview(by),
    setSettings: (by, input) => company().setSettings(by, input),
    setAgentDisabled: (by, email, disabled) => company().setAgentDisabled(by, email, disabled),
    connectConnector: (by, input) => company().connectConnector(by, input),
    removeConnector: (by, id) => company().removeConnector(by, id),
    writeSkill: (by, input) => company().writeSkill(by, input),
    removeSkill: (by, name) => company().removeSkill(by, name),
    mirror: (by) => company().mirror(by),
    workspaceSettings: (by, input) => company().workspaceSettings(by, input),
  };
  const lifecycleDir: Partial<LifecycleDirectory> = {
    onboardingStatus: (by) => company().onboardingStatus(by),
    onboardingSkip: (actor, step) => company().onboardingSkip(actor, step),
    onboardingStudy: (actor, material) => company().onboardingStudy(actor, material),
    onboardingReview: (actor, input) => company().onboardingReview(actor, input),
  };
  /** The app pages' directory (M14.2), as `index.ts` wires it: the Person answers its chat list, each Chat its cards. */
  const appDir: Partial<AppDirectory> = {
    chats: (p, call) => runChatsCall(host(p).chats, p, p, call, clock.now),
    cards: async (p, chatId) => (host(p).chats.owns(chatId) ? chats.harness(chatId).instance.cardsFor(p) : null),
    chatLast: async (p, chatId) => chats.harness(chatId).instance.lastAt(p),
    // Each chat searched by its own `Chat` for its owner (F2), as `index.ts` wires it to the object's `search`.
    chatSearch: async (p, chatId, query) => searchChat(chats.harness(chatId).instance, p, query),
    // The Jobs page's reads and actions (M14.2, M15.7): the person's index, then the `Job` named for them.
    jobIds: async (p) => host(p).jobs.list(),
    job: (p, id) => jobOf(p, id).instance as never,
    // The Activity tab's tasks (F12), each chat answering for its owner as the `Chat` object does; and one home file.
    chatTasks: async (p, chatId) => chatTasks(chats.harness(chatId).instance, p),
    // These chats wire no sub-agents (the sub-agent world does, F14), so their record holds no delegation.
    chatTask: async (p, chatId, turnId) => chatTask(chats.harness(chatId).instance, p, turnId, { group: () => [], handedOffAt: () => null }),
    homeFile: async (p, path) => host(p).memory.memoryGet({ path, limit: 200 }, p),
    // The Library's files (M23.4): each person's own `PersonFiles`, decided there for the session's person.
    files: async (p) => host(p).files.list({ preview: true }, p),
    fileRead: async (p, path, from) => host(p).files.read({ path, from }, p),
    fileRename: async (p, path, to) => host(p).files.rename({ path, to }, p),
    filePin: async (p, path, pinned) => host(p).files.pin({ path, pinned }, p),
    fileDelete: async (p, path) => host(p).files.remove({ path }, p),
    // Signed links (M24.3), made and checked by the session's own `Person`, as `index.ts` wires them.
    fileLink: async (p, path, download) => host(p).links.link({ path, download }, p),
    fileLinked: async (p, link) => host(p).links.linked(link, p),
    // The Connectors, Permissions and Search pages (M23.5): the Vault's listing, the Company's entitled connectors,
    // each person's own grants and memory, decided in the objects that own them.
    credentials: async (p) => (o.credentials ? o.credentials(p) : []),
    companyConnectors: async (p) => company().connectorsFor(p),
    grants: async (p) => host(p).authority.list(p),
    names: async () => company().directory(),
    memorySearch: async (p, i) => host(p).memory.memorySearch(i, p),
    memoryLineSource: async (p, i) => host(p).memory.memoryLineSource(i, p),
    // The person's loops as the sheet's usage card reads them: one enabled loop with its daily budget.
    loops: async () => ({ ok: true, loops: [{ loop: "reflection", enabled: true, budget: 1_000_000 }] }),
    now: () => clock.now,
  };
  const dir = { share: (token: string) => routeShare(token, asBucket(r2), async (p, t) => host(p).links.shared(t)), app: appDir, admin: adminDir, lifecycle: lifecycleDir, company: () => ({ lookup: (e: string) => company().lookup(e), list: () => company().list(), invite: (by: string, e: string, r: unknown) => company().invite(by, e, r), resyncAccess: (by: string) => company().resyncAccess(by) }), person: (p: string) => ({ openChat: () => host(p).chats.open(clock.now), ownsChat: async (c: string) => host(p).chats.owns(c) }), authority: authorityDir } as unknown as Directory;

  /** One request to the agent script as `as`, after Access and the member lookup made the session. */
  const http = async (as: string, method: string, path: string, body?: unknown) => {
    const role = (await company().lookup(as))?.role;
    const res = await route(new Request(`https://${TENANT}.example${path}`, { method, headers: { origin: `https://${TENANT}.example`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env as never, { tenant: TENANT, person: as, ...(role ? { role } : {}) }, dir);
    const text = await res.text();
    const html = (res.headers.get("content-type") ?? "").startsWith("text/html");
    // A file served raw (M23.4) is not JSON: its text and headers are the answer.
    const json = (res.headers.get("content-type") ?? "").includes("json");
    // The headers ride along without being enumerable, so a test comparing a whole answer sees status and body alone.
    return Object.defineProperty({ status: res.status, body: (html ? { html: text } : json ? JSON.parse(text) : { text }) as Record<string, unknown> }, "headers", { value: res.headers }) as { status: number; body: Record<string, unknown>; readonly headers: Headers };
  };

  /** Opens a chat for `p` and sends their message. */
  const say = async (p: string, message: string, chatId?: string) => {
    const id = chatId ?? ((await host(p).chats.open(clock.now)) as { chatId: string }).chatId;
    const result = await chats.harness(id).instance.send({ person: p, text: message });
    return { chatId: id, result };
  };

  /** Signs a grant as `p` through the app's route. */
  const grant = async (p: string, g: Record<string, unknown>) => {
    const r = await http(p, "POST", "/api/grants", { created_from: "chat-confirmation", constraints: {}, ...g });
    if (r.status !== 201) throw new Error(`grant refused: ${JSON.stringify(r.body)}`);
    return r.body.grant as Grant;
  };

  const journal = () => ledgerH.instance.journalRows();
  const grantsNow = async () => [...[...persons.keys()].flatMap((p) => host(p).authority.all()), ...(await company().snapshot()).grants];
  const view = async () => companyView(await company().snapshot());
  /** Every chat a person's `Person` opened, with its cards. */
  const chatsOf = (p: string) => host(p).chats.list();
  const cardsOf = (p: string) => chatsOf(p).flatMap((id) => (chats.harness(id).instance.cardsFor(p) ?? []).map((c) => ({ chatId: id, ...c })));
  /** Every transcript message of a person's chats, as text. */
  const transcriptOf = (p: string) => chatsOf(p).flatMap((id) => chats.harness(id).rows("SELECT body FROM messages ORDER BY seq").map((r) => String(r.body)));
  const noticesOf = (p: string) => chatsOf(p).flatMap((id) => chats.harness(id).instance.notices());

  /** Moves the clock to a job's armed alarm and fires it, then every alarm already due (at most `limit`). */
  const fireJob = async (owner: string, id: string, limit = 30) => {
    const h = jobOf(owner, id);
    if (h.alarmAt === null) throw new Error(`no alarm armed for ${owner}/${id}`);
    clock.now = Math.max(clock.now, h.alarmAt);
    await h.fireAlarm();
    for (let i = 0; i < limit && h.alarmAt !== null && h.alarmAt <= clock.now; i++) await h.fireAlarm();
  };

  return { dir, env, clock, fake, performed, jobOf, fireJob, jobIds: (p: string) => host(p).jobs.list(), calendar, r2, chats, host, personHarness: (p: string) => persons.get(p), filesOf, hooks, company, companyHarness: () => companyH, ledger: () => ledgerH.instance, http, say, grant, request, journal, grantsNow, view, chatsOf, cardsOf, transcriptOf, noticesOf };
}

export type AuthorityWorld = ReturnType<typeof authorityWorld>;

/** Journal rows as the collateral check's keys. */
export const journalKeys = (rows: JournalRow[]) => rows.map((r) => r.id);
