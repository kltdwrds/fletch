// The two-member `solo-sam` with a browser (M9): the authority world's real gate, grants, journal and
// chats, plus the real `PersonBrowse` engine memory on each member's own storage, a real `VaultCore`
// holding a seeded credential whose fill goes to the fake browser, and the scripted `FakeBrowser`.
import type { DomainMemory, EngineMemoryApi } from "../../../packages/agent/src/browse/memory.ts";
import { PersonBrowse } from "../../../packages/agent/src/browse/memory.ts";
import type { FillApi } from "../../../packages/agent/src/browse/tools.ts";
import { VaultCore } from "../../../packages/agent/src/vault/core.ts";
import { holdTypedSecrets } from "../../../packages/agent/src/vault/typed.ts";
import type { FakeMode, FakeStep } from "../../support/fake-model.ts";
import { FakeBrowser, type FakeSite } from "../../support/browser/fake-browser.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import { seededToken } from "../../support/vendors/index.ts";
import { ada, authorityWorld, T0, TENANT } from "./authority-world.ts";
import { asPerson, keysFor, testMasterKey } from "./vault-harness.ts";

export const LOGIN_HOST = "login.fixture.example";
export const LOGIN_REF = "cred://fixture-login";
/** Ada's registry entry in this world (M13): one login page the reference may be typed into, nothing else. */
export const FILL_ENTRY = { host: LOGIN_HOST, methods: ["GET"], header: "authorization", prefix: "", fills: true };

export interface BrowseWorldOptions {
  sites: Record<string, FakeSite>;
  script: FakeStep[];
  mode?: FakeMode;
  /** The planted violation: reads back are not scrubbed of typed values. */
  noScrub?: boolean;
  /** The planted violation (M14.2): the Person commits an allow-once fill without asking the Vault for a grant. */
  noMint?: boolean;
  /** Each member's real memory and files on their `Person` (M7.3), so a copying model's writes land somewhere real. */
  stores?: boolean;
  /** Settings the world's Vault sees (M13): another host the login is registered on. */
  extraHosts?: Array<typeof FILL_ENTRY>;
}

export async function browseWorld(o: BrowseWorldOptions) {
  const browser = new FakeBrowser(o.sites);
  const token = seededToken();
  const now = { current: T0 };

  const memories = new Map<string, ObjectHarness<PersonBrowse>>();
  const memoryHost = (person: string) => {
    let h = memories.get(person);
    if (!h) {
      h = new ObjectHarness(`browse-${person}`, (ctx) => new PersonBrowse((ctx as DurableObjectState).storage, () => now.current), {});
      memories.set(person, h);
    }
    return h;
  };
  const memory = (person: string): EngineMemoryApi => ({ get: async (d) => memoryHost(person).instance.get(d), record: async (r) => memoryHost(person).instance.record(r) });
  /** What a person's agent has remembered of a domain, read from their own storage. */
  const learned = (person: string, domain: string): Promise<DomainMemory | null> => memoryHost(person).instance.get(domain);

  const vaultH = new ObjectHarness(
    "vault",
    (ctx) =>
      new VaultCore(ctx as never, {
        tenant: TENANT,
        keys: keysFor(TENANT, testMasterKey()),
        fetch: async () => {
          throw new Error("HERMETIC: no network");
        },
        now: () => now.current,
        inject: browser.inject,
      }),
    {},
  );
  const put = await vaultH.instance.capture({ ref: LOGIN_REF, value: token, kind: "login", hosts: [FILL_ENTRY, ...(o.extraHosts ?? [])] }, asPerson(ada.email, "capture-form"));
  if (!put.ok) throw new Error(`vault seed refused: ${put.code}`);

  const fill = (person: string): FillApi => ({
    fill: (req) => vaultH.instance.fill(req, { person, purpose: "browse_fill" }),
    scrub: async (session, text) => (o.noScrub ? text : vaultH.instance.scrub(session, text)),
  });

  // As `objects/chat.ts` and `objects/person.ts` wire the Vault (M14.2): typed secrets held before a
  // message is stored, and a one-shot credential grant minted when an allow-once fill commits.
  const world = authorityWorld({
    script: o.script,
    ...(o.mode ? { mode: o.mode } : {}),
    browse: { port: browser, memory, fill },
    ...(o.stores ? { stores: true } : {}),
    secrets: (person, text) => holdTypedSecrets(text, (value) => vaultH.instance.holdTyped({ person, value, source: "chat" })),
    mint: (person: string) => (i: { ref: string; site: string | null; card: string }) => (o.noMint ? Promise.resolve({ ok: true as const }) : vaultH.instance.grantForAction({ person, ...i })),
  });
  // One clock: the engines' and the memory's.
  Object.defineProperty(now, "current", { get: () => world.clock.now, set: (v: number) => (world.clock.now = v) });
  return { ...world, browser, token, vault: vaultH, learned, memoryHost, ada };
}

export type BrowseWorld = Awaited<ReturnType<typeof browseWorld>>;

/** Everything a model could have been shown or a store could hold, as text: the sinks a value must stay out of. */
export async function sinks(w: BrowseWorld): Promise<Record<string, string>> {
  const rows = <T extends object>(h: ObjectHarness<T>) => {
    const tables = h.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name));
    return JSON.stringify(tables.flatMap((t) => h.rows(`SELECT * FROM "${t}"`).map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, v instanceof Uint8Array ? new TextDecoder().decode(v) : v])))));
  };
  return {
    "model messages and tool results": JSON.stringify(w.fake.requests),
    transcripts: [ada.email].flatMap((p) => w.transcriptOf(p)).join("\n"),
    notices: JSON.stringify([ada.email].flatMap((p) => w.noticesOf(p))),
    journal: JSON.stringify(await w.journal()),
    "engine memory": [ada.email].map((p) => rows(w.memoryHost(p))).join("\n"),
  };
}
