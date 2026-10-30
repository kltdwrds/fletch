// The agent script: one deploy serves one tenant (AD-1). Every service it takes from where it is
// deployed comes from the host (`host.ts`), installed here once; the person comes from the host's
// identity and is mapped to a member by the `Company` (M4.1, F1, `http/serve.ts`). With nothing in
// front of the script there are no props, and it serves its own tenant.
import { getAgentByName } from "agents";
import { singleAccountHost } from "@qyvr/host-cloudflare";
import { available, hostOf, setHost } from "./host.ts";
import { propsOf } from "./http/identity.ts";
import type { IngressStub } from "./http/ingress-routes.ts";
import type { Directory } from "./http/routes.ts";
import type { AppDirectory, AppJob } from "./http/app-routes.ts";
import type { VaultDirectory } from "./http/vault-routes.ts";
import { serve } from "./http/serve.ts";
import { jobName } from "./objects/job.ts";
import { dayRollup } from "./obs/dashboard.ts";
import { appAttachments } from "./attachments/wiring.ts";
import { routeShare } from "./files/links.ts";
import { sweepTenant } from "./migrations/sweep.ts";

export { Chat, Company, Ingress, Job, Ledger, Person, Vault } from "./objects/index.ts";
/** Sub-agents are facets of their `Chat`, loaded from this export (M7.2); no binding names it. */
export { SubAgent } from "./objects/subagent.ts";
/** Code Mode's outbound (M25.5): every Dynamic Worker's `globalOutbound`, loaded with the tenant and person in props. */
export { Egress } from "./code/egress.ts";

setHost(singleAccountHost);

function directory(env: Env): Directory {
  const ledger = () => env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID));
  const company = () => env.COMPANY.get(env.COMPANY.idFromName(env.TENANT_ID));
  const memberEmails = async () => (await company().list()).map((m) => m.email);
  const personCounts = async (person: string, from: number, to: number) => (await getAgentByName(env.PERSON, person)).deliveryCounts(from, to);
  return {
    person: (person) => ({
      openChat: async () => (await getAgentByName(env.PERSON, person)).openChat(),
      ownsChat: async (chatId) => (await getAgentByName(env.PERSON, person)).ownsChat(chatId),
      connectChat: async (chatId) => (await getAgentByName(env.PERSON, person)).connectChat(chatId),
      enroll: async (input) => (await getAgentByName(env.PERSON, person)).enroll(input),
    }),
    company: () => ({
      lookup: (email) => company().lookup(email),
      list: () => company().list(),
      invite: (by, email, role) => company().invite(by, email, role),
      resyncAccess: (by) => company().resyncAccess(by),
    }),
    chat: (chatId) => ({ fetch: async (request) => (await getAgentByName(env.CHAT, chatId)).fetch(request) }),
    ledger: () => ({ modelCalls: (filter) => ledger().modelCalls(filter) }),
    ingress: (id) => env.INGRESS.get(env.INGRESS.idFromName(id)) as unknown as IngressStub,
    mail: {
      deliver: async (person, m) => (await getAgentByName(env.PERSON, person)).receiveMail(m),
      send: async (person, m) => (await getAgentByName(env.PERSON, person)).sendMail(person, m),
    },
    authority: {
      cards: async (chatId, person) => (await getAgentByName(env.CHAT, chatId)).cardsFor(person),
      decide: async (chatId, ids, by, choice) => (await getAgentByName(env.CHAT, chatId)).decide(ids, by, choice),
      compact: async (chatId, person) => (await getAgentByName(env.CHAT, chatId)).compactNow(person),
      clearLatch: async (chatId, person) => (await getAgentByName(env.PERSON, person)).ownsChat(chatId).then(async (owns) => (owns ? (await getAgentByName(env.CHAT, chatId)).clearLatch(person) : { ok: false, code: "CHAT_NOT_FOUND" })),
      grants: (person) => ({
        create: async (by, input) => (await getAgentByName(env.PERSON, person)).createGrant(by, input),
        list: async (by) => (await getAgentByName(env.PERSON, person)).listGrants(by),
        revoke: async (by, id) => (await getAgentByName(env.PERSON, person)).revokeGrant(by, id),
      }),
      request: async (to, r) => {
        // The recipient must be a member before their object is ever named; the Person checks again.
        if (!(await company().lookup(to))) return { ok: false, code: "COLLEAGUE_NOT_A_MEMBER", reason: "no such colleague" };
        return (await getAgentByName(env.PERSON, to)).receiveRequest({ from: r.from, to, text: r.text, origin: r.from, hops: 0, viaAgent: false });
      },
      directory: () => company().directory(),
      addPolicy: (by, input) => company().addPolicy(by, input),
      companyGrant: (by, input) => company().createGrant(by, input),
    },
    vault: (() => {
      // The Vault decides on every call; each write carries the signed-in person the route resolved.
      const vault = () => env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID));
      return {
        capture: (input, writer) => vault().capture(input, writer),
        registerHost: (input, writer) => vault().registerHost(input, writer),
        removeHost: (ref, host, writer) => vault().removeHost(ref, host, writer),
        revoke: (ref, writer) => vault().revoke(ref, writer),
        issueGrant: (input, writer) => vault().issueGrant(input, writer),
        revokeGrant: (nonce, writer) => vault().revokeGrant(nonce, writer),
        approveOneTimeCode: (input, writer) => vault().approveOneTimeCode(input, writer),
        list: (person) => vault().list(person),
        grants: (person) => vault().grants(person),
      } as VaultDirectory;
    })(),
    delivery: {
      pushKey: () => env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID)).pushKey(),
      call: async (person, call) => (await getAgentByName(env.PERSON, person)).deliveryCall(person, call),
    },
    admin: {
      journal: (by, person) => company().adminJournal(by, person),
      ledger: (by, person) => company().adminLedger(by, person),
      personalRead: async (person, by, area) => (await getAgentByName(env.PERSON, person)).adminRead(by, area),
      isMember: async (person) => !!(await company().lookup(person)),
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
    },
    app: {
      chats: async (person, call) => (await getAgentByName(env.PERSON, person)).chatsCall(person, call),
      chatLast: async (person, chatId) => (await getAgentByName(env.CHAT, chatId)).lastAt(person),
      // A chat's tasks (F12), each answered by that `Chat` for its owner alone, as `chatLast` is.
      chatTasks: async (person, chatId) => (await getAgentByName(env.CHAT, chatId)).tasksFor(person),
      chatTask: async (person, chatId, turnId) => (await getAgentByName(env.CHAT, chatId)).taskFor(person, turnId),
      chatTaskStop: async (person, chatId, turnId) => (await getAgentByName(env.CHAT, chatId)).stopTask(person, turnId),
      chatSearch: async (person, chatId, query) => (await getAgentByName(env.CHAT, chatId)).search(person, query),
      cards: async (person, chatId) => ((await (await getAgentByName(env.PERSON, person)).ownsChat(chatId)) ? (await getAgentByName(env.CHAT, chatId)).cardsFor(person) : null),
      jobIds: async (person) => (await getAgentByName(env.PERSON, person)).jobIds(person),
      job: (person, id) => env.JOB.get(env.JOB.idFromName(jobName(person, id))) as unknown as AppJob,
      files: async (person) => (await getAgentByName(env.PERSON, person)).fileList({ preview: true }, person),
      fileRead: async (person, path, from) => (await getAgentByName(env.PERSON, person)).fileRead({ path, from }, person),
      fileRename: async (person, path, to) => (await getAgentByName(env.PERSON, person)).fileRename({ path, to }, person),
      filePin: async (person, path, pinned) => (await getAgentByName(env.PERSON, person)).filePin({ path, pinned }, person),
      fileDelete: async (person, path) => (await getAgentByName(env.PERSON, person)).fileDelete({ path }, person),
      // Uploads (M24.3): the bytes go to the bucket under the session's person; their `Person` keeps the row and decides reads.
      attachments: appAttachments(env),
      fileLink: async (person, path, download) => (await getAgentByName(env.PERSON, person)).documentCall(person, { op: "link", path, download }) as never,
      fileLinked: async (person, link) => (await getAgentByName(env.PERSON, person)).documentCall(person, { op: "linked", ...link }) as never,
      loops: async (person) => (await getAgentByName(env.PERSON, person)).loopSettings(person),
      setLoop: async (person, loop, patch) => (await getAgentByName(env.PERSON, person)).setLoop(person, loop, patch),
      homeFile: async (person, path) => (await getAgentByName(env.PERSON, person)).memoryGet({ path, limit: 200 }, person),
      credentials: (person) => env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID)).list(person),
      companyConnectors: (person) => company().connectorsFor(person),
      grants: async (person) => (await getAgentByName(env.PERSON, person)).listGrants(person),
      names: async () => (await company().directory()).map((d) => ({ email: d.email, ...(d.name ? { name: d.name } : {}) })),
      memorySearch: async (person, input) => (await getAgentByName(env.PERSON, person)).memorySearch(input, person),
      memoryLineSource: async (person, input) => (await getAgentByName(env.PERSON, person)).memoryLineSource(input, person),
      now: () => Date.now(),
    } satisfies AppDirectory,
    lifecycle: {
      promotions: (email) => company().promotions(email),
      promotionAct: (action, actor, id) => (action === "consent" ? company().promotionConsent(actor, id) : action === "merge" ? company().promotionMerge(actor, id) : company().promotionDecline(actor, id)),
      importPlan: async (person, actor, summary) => (await getAgentByName(env.PERSON, person)).importPlan(actor, summary),
      importConfirm: async (person, actor, id) => (await getAgentByName(env.PERSON, person)).importConfirm(actor, id),
      offboardStatus: async (person) => (await getAgentByName(env.PERSON, person)).offboardingStatus(),
      offboardStart: async (person, actor) => (await getAgentByName(env.PERSON, person)).offboardStart(actor),
      offboardFinish: async (person, actor, choice) => (await getAgentByName(env.PERSON, person)).offboardFinish(actor, choice),
      onboardingStatus: (by) => company().onboardingStatus(by),
      onboardingSkip: (actor, step) => company().onboardingSkip(actor, step),
      onboardingStudy: (actor, material) => company().onboardingStudy(actor, material),
      onboardingReview: (actor, input) => company().onboardingReview(actor, input),
      conversionBundle: async (person, request) => (await getAgentByName(env.PERSON, person)).conversionBundle(request),
      conversionComplete: async (person, input) => (await getAgentByName(env.PERSON, person)).conversionComplete(input),
      conversionRestore: async (person, markdown) => (await getAgentByName(env.PERSON, person)).conversionRestore(markdown),
    },
    dashboard: {
      admin: { isAdmin: (by) => company().isAdmin(by), members: memberEmails, counts: personCounts, ledger: { dashboard: (range, d) => ledger().dashboard(range, d) } },
      person: (person) => ({
        chats: async (by) => (await getAgentByName(env.PERSON, person)).chatsCall(by, { op: "view" }),
        compactions: async (chatId, by) => ((await (await getAgentByName(env.PERSON, person)).ownsChat(chatId)) ? (await getAgentByName(env.CHAT, chatId)).compactionsFor(by) : null),
        items: async (by) => (await (await getAgentByName(env.PERSON, person)).deliveryCall(by, { op: "view" })) as never,
        counts: (from, to) => personCounts(person, from, to),
        ledger: { dashboard: (range, d) => ledger().dashboard(range, d) },
      }),
      now: () => Date.now(),
    },
    render: async (input) => {
      const render = hostOf(env).render;
      return available(render) ? render.render(input) : render;
    },
    share: (token) => routeShare(token, env.AGENT_BUCKET, async (person, t) => (await getAgentByName(env.PERSON, person)).sharedFile(t)),
    migrations: () => sweepTenant({
      members: memberEmails,
      company: () => company().migrationProbe(),
      ledger: () => ledger().migrationProbe(),
      vault: () => env.VAULT.get(env.VAULT.idFromName(env.TENANT_ID)).migrationProbe(),
      person: async (email) => (await getAgentByName(env.PERSON, email)).platformCall({ op: "probe" }) as never,
      chat: async (id) => (await getAgentByName(env.CHAT, id)).migrationProbe(),
      job: (name) => env.JOB.get(env.JOB.idFromName(name)).migrationProbe(),
    }),
    rollup: (day) => dayRollup({ members: memberEmails, counts: personCounts, ledger: { rollup: (d, c) => ledger().rollup(d, c) } }, day),
  };
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    // No platform in front of the script means no props: it serves its own tenant.
    return serve(request, env, propsOf(ctx) ?? { tenant: env.TENANT_ID }, { dir: directory(env), now: () => Date.now() });
  },
} satisfies ExportedHandler<Env>;
