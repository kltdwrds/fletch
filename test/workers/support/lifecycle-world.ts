// A hermetic one-member `solo-sam` for learning and lifecycle (M11.1): the real `Company` object with
// its merge queue, members, teams, connectors and settings, the real `Ledger`, and the member's real
// `PersonMemory`, `PersonalLearning` and `MemoryImport` over the object harness and one in-memory R2.
// The model is the scripted fake on the `AI` binding the referee, the handover draft and the import's
// extraction call. fletch has no platform to convert a tenant through, so the world has no converter.
import { unavailable } from "@qyvr/host";
import { upsertEntity } from "../../../packages/agent/src/memory/entities.ts";
import { PersonMemory } from "../../../packages/agent/src/memory/store.ts";
import { PersonalLearning } from "../../../packages/agent/src/learning/personal.ts";
import { MemoryImport } from "../../../packages/agent/src/lifecycle/import.ts";
import { ConversionState, type OffboardingDeps, purgeWork } from "../../../packages/agent/src/lifecycle/offboarding.ts";
import { PersonAttachments } from "../../../packages/agent/src/attachments/store.ts";
import { PersonLinks } from "../../../packages/agent/src/files/links.ts";
import { treeOf } from "../../../packages/agent/src/tree/rpc.ts";
import { seedClaim } from "./seed-claim.ts";
import { PersonFiles } from "../../../packages/agent/src/files/store.ts";
import { PersonAuthority } from "../../../packages/agent/src/grants/authority.ts";
import { SkillCatalog } from "../../../packages/agent/src/skills/catalog.ts";
import { Company } from "../../../packages/agent/src/objects/company.ts";
import { Ledger } from "../../../packages/agent/src/objects/ledger.ts";
import { FakeModel, type FakeStep } from "../../support/fake-model.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import { ada, T0, TENANT } from "./authority-world.ts";
import { asBucket, FakeR2 } from "./fake-r2.ts";

export { ada, T0, TENANT };

export const verdict = (v: "promote" | "reject", reason = "fine") => ({ text: JSON.stringify({ verdict: v, reason }) });

export function lifecycleWorld(o: { script?: FakeStep[]; roles?: Record<string, "owner" | "admin" | "member"> } = {}) {
  const clock = { now: T0 };
  const fake = new FakeModel(o.script ?? []);
  const members = [ada].map((p) => ({ email: p.email, role: o.roles?.[p.email] ?? p.role, name: p.name }));
  const env = { TENANT_ID: TENANT, TENANT_SHAPE: "company", QYVR_ENV: "test", HOST: { memberSeed: JSON.stringify(members) } };
  const ledgerH = new ObjectHarness("ledger", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), env, (l) => {
    l.now = () => clock.now;
  });
  const ledgers = { idFromName: (n: string) => ({ name: n }), get: () => ledgerH.instance };
  const vault = { putCompany: async () => ({ ok: true }), removeCompany: async () => true };
  const r2 = new FakeR2();
  const companyH = new ObjectHarness("company", (ctx, e) => new Company(ctx as DurableObjectState, e as Env), { ...env, LEDGER: ledgers, AGENT_BUCKET: asBucket(r2), AI: fake.binding, VAULT: { idFromName: (n: string) => ({ name: n }), get: () => vault } });
  const company = () => companyH.instance;
  const model = { ai: fake.binding as unknown as Ai, ledger: ledgerH.instance as never, tenant: TENANT, now: () => clock.now, wait: async () => {} };

  const hosts = new Map<string, ReturnType<typeof makeHost>>();
  const makeHost = (email: string) => {
    const h = new ObjectHarness(email, (ctx) => {
      const storage = (ctx as DurableObjectState).storage;
      const mem = new PersonMemory(storage, asBucket(r2), email, () => clock.now);
      const authority = new PersonAuthority(storage, TENANT, email, { snapshot: () => company().snapshot(), use: (g, e, at) => company().useGrant(g, e, at) }, () => clock.now);
      const learning = new PersonalLearning({ storage, bucket: asBucket(r2), person: email, commit: (d, id) => authority.commit(d, id), now: () => clock.now });
      const files = new PersonFiles(storage, asBucket(r2), email, () => clock.now);
      // The working tree, attachments and links as `objects/person.ts` builds them (M24.3); the reader writes the tree.
      const tree = treeOf(storage, email);
      const attachments = new PersonAttachments(storage, { person: email, bucket: asBucket(r2) as never, ingest: async (i) => ((await tree.write({ path: `work/uploads/${i.attachmentId}/${i.name}`, bytes: i.bytes }, email)).ok ? { ok: true, kind: "text", treePath: `work/uploads/${i.attachmentId}/${i.name}`, pages: 1 } : { ok: false, code: "INGEST_FAILED", reason: "tree" }), describe: (n) => n, convert: null, now: () => clock.now });
      const links = new PersonLinks(storage, files, asBucket(r2), () => clock.now);
      return { mem, authority, learning, imports: new MemoryImport(storage, mem), files, tree, attachments, links, pending: new ConversionState(storage) };
    }, {});
    return h;
  };
  const host = (email: string) => {
    if (!hosts.has(email)) hosts.set(email, makeHost(email));
    return (hosts.get(email) as ReturnType<typeof makeHost>).instance;
  };

  const offboarding = (email: string): OffboardingDeps => ({
    mem: host(email).mem,
    bucket: asBucket(r2),
    files: { dump: () => host(email).files.dump(), purgeAll: () => host(email).files.purgeAll() },
    work: { purge: () => purgeWork(host(email).tree, host(email).attachments, host(email).links) },
    company: { propose: (p, i) => company().promotionPropose(p, i), offboardingPolicy: (p) => company().offboardingPolicy(p), mayDepart: (p) => company().mayDepart(p), depart: (p) => company().depart(p) },
    converter: unavailable("provisioning", "fletch has no platform to convert a tenant through"),
    pending: host(email).pending,
    model,
  });

  const write = async (email: string, text: string, extra: { audience?: string[]; kind?: "fact" | "preference" } = {}) => {
    const w = await host(email).mem.appendDaily({ text, setting: { scope: "personal", ...(extra.audience ? { audience: extra.audience } : {}) }, writer: `agent:${email}`, source: "chat:seed", dedupe: `${email}:${text}` });
    if (!w.ok) throw new Error(`seed: ${w.code}`);
    const r = seedClaim(host(email).mem, w, { kind: extra.kind ?? "fact" });
    if (!r.ok) throw new Error(`seed claim: ${r.code}`);
    return r;
  };
  const page = (email: string, displayName: string, names: string[]) => upsertEntity(host(email).mem, { kind: "people", displayName, summary: `notes on ${displayName}`, rank: 1, names }, `agent:${email}`);

  const catalog = () => new SkillCatalog(asBucket(r2), "company", (p) => company().teamsOf(p));
  const person = (email: string) => ({ kind: "person" as const, email });
  const agent = (email: string) => ({ kind: "agent" as const, email });

  return { clock, fake, r2, company, host, model, ledger: () => ledgerH.instance, offboarding, write, page, catalog, person, agent };
}

export type LifecycleWorld = ReturnType<typeof lifecycleWorld>;
