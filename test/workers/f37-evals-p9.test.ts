// F37: the P9 tasks on a preview slot. The runner drives each P9 tier-2 task (Sam's prompts, a send seen from two
// tabs, the chat reloaded at two widths, a settings page opened and reloaded); the slot answers the Example API at its
// own `/fixtures/p9-probe` and, for the agent's calls, in the Vault's network, refuses every other host with no request
// made, offers the fixture connector, and resets and reads Sam's credential rows (`scripts/preview-slot/test-host-p9.mjs`);
// the readers and events over it (`scripts/evals/p9-slot.ts`) answer a P9 grader as the tier-1 world does. Hermetic:
// the readers run over Sam's real chat and Vault in the P9 tier-1 world, played by the scripted fake model, the op's
// rows read from the objects' own SQLite by the op's code; the page is the tier-1 page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { p5Slot } from "../../scripts/evals/p5-slot.ts";
import { exampleKeyForm, formOfLink, type P9Page, type P9State, p9Slot } from "../../scripts/evals/p9-slot.ts";
import { driveable, type Slot, trial } from "../../scripts/evals/runner.ts";
import { P9_API, P9_FIXTURE, p9ChatRows, p9Fixture, p9Network, p9Reset, p9VaultRows } from "../../scripts/preview-slot/test-host-p9.mjs";
import count from "../evals/p9-connectors/count-and-card-real-model.task.ts";
import { fixtureNamespace, probeAnswer } from "../evals/p9-connectors/fixture-connector.ts";
import { asSam, exampleKey, type P9HarnessOptions, P9Tier1World, pat, sam } from "../evals/p9-connectors/harness.ts";
import reload from "../evals/p9-connectors/reload-and-phone.task.ts";
import { runs } from "../evals/p9-connectors/runs.ts";
import setup from "../evals/p9-connectors/setup-real-model.task.ts";
import typed from "../evals/p9-connectors/typed-secret-real-model.task.ts";
import unbound from "../evals/p9-connectors/unbound-host-real-model.task.ts";
import type { P9SlotWorld, P9World, SentView, Tabs } from "../evals/p9-connectors/world.ts";
import { API_HOST, API_REF, COUNT, OTHER_HOST, PROBE_API, PROBE_OTHER, TYPED } from "../evals/p9-connectors/world.ts";
import { EMPTY_SNAPSHOT, type SlotEntry, type SlotWorld } from "../support/evals.ts";
import type { DefinedTask } from "../support/task.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

type Sql = Parameters<typeof p9Reset>[0];
/** An object's SQLite as the op reads and writes it (`ctx.storage.sql.exec`), over the tier-1 object's own database. */
const sqlOver = (h: { rows: (q: string, ...b: never[]) => Record<string, unknown>[]; db: DatabaseSync }): Sql => ({
  exec: (q: string, ...b: unknown[]) => {
    if (/^\s*SELECT/i.test(q)) return { toArray: () => h.rows(q, ...(b as never[])) };
    h.db.prepare(q).run(...(b as never[]));
    return { toArray: () => [] };
  },
});
const vaultSql = (w: P9Tier1World) => sqlOver(w.vaultH);
const chatSql = (w: P9Tier1World) => sqlOver(w.w.chats.harness(w.chatId("c1")));

/** The `p9` op's state over the tier-1 world, as `scripts/preview-slot/test-host.mjs` answers it on a slot. */
async function stateOf(w: P9Tier1World): Promise<P9State> {
  return {
    vault: { secrets: w.secrets(), grants: w.credentialGrants(), ...p9VaultRows(vaultSql(w), sam.email), sent: w.sent() },
    chat: { ...p9ChatRows(chatSql(w)), requests: w.requests() },
    files: await w.files(),
    rowsText: w.rowsText(),
  };
}

/** The tier-1 page as the slot's: two tabs from the tier-1 harness's own `tabs` turn; the reloads from a fixed view. */
const pageOver = (w: P9Tier1World, plant?: (t: Tabs) => Tabs): P9Page => ({
  async tabs(_c, text, settled) {
    await w.play({ kind: "event", name: "tabs", payload: { text } });
    await settled();
    return plant ? plant(w.tabs as Tabs) : (w.tabs as Tabs);
  },
  reload: async () => ({ before: { capture: null, masked: null, connected: [] }, after: { capture: null, masked: null, connected: [] }, origins: [] }),
  settings: async () => ({ drawn: true, heading: "Connectors", origins: [] }),
});

/** A slot whose every trial is a fresh tier-1 world behind the slot's readers, as `scripts/evals/slot.ts` builds them. */
function slotOver(opts: () => P9HarnessOptions, worlds: P9Tier1World[] = [], plant?: (t: Tabs) => Tabs): Slot {
  return {
    name: "fletch-pv-test",
    async open(task) {
      const o = opts();
      const w = new P9Tier1World(o);
      await w.open();
      // A seed here is what an earlier trial left on the slot: the runner's reset must clear it.
      await o.seed?.(w);
      worlds.push(w);
      const entries = () => w.engine("c1").history().entries as unknown as SlotEntry[];
      let clock = 0;
      const tick = async () => {
        clock += 1;
      };
      const p5 = p5Slot(() => w.chatId("c1"), entries, async (path) => w.w.http(sam.email, "GET", path), async () => w.prompts(), { rows: async () => [], drawer: async () => null }, tick, () => clock);
      const op = async (call: "reset" | "read") => {
        if (call === "reset") {
          p9Reset(vaultSql(w), sam.email);
          return null;
        }
        return stateOf(w);
      };
      const capture = async (form: Record<string, string>) => (await w.vaultHttp("POST", "/vault/capture", { form })).status;
      let n = 0;
      const p9 = p9Slot(() => w.chatId("c1"), op, capture, () => p5.readers.prompts(), "https://fletch-pv-test.example", pageOver(w, plant), () => `p9-test-value-${++n}`);
      const after = async () => {
        await p5.settle(clock + 3);
        await p9.refresh();
      };
      const world = {
        chatId: w.chatId("c1"),
        replies: [] as string[],
        snapshot: () => EMPTY_SNAPSHOT,
        entries,
        reactions: () => [],
        async send(text: string) {
          await w.play({ kind: "prompt", by: sam.email, text });
          await after();
          return "";
        },
        async event(name: string, payload: Record<string, string>) {
          if (await p9.event(name, payload, () => p5.settle(clock + 3))) return;
          await w.play({ kind: "prompt", by: sam.email, text: payload.text ?? "" });
          await after();
        },
        read: async (path: string) => w.w.http(sam.email, "GET", path),
      };
      Object.defineProperties(world, Object.getOwnPropertyDescriptors(p5.readers));
      Object.defineProperties(world, Object.getOwnPropertyDescriptors(p9.readers));
      Object.defineProperties(world, { tabs: { get: () => p9.tabs }, marks: { get: () => p9.marks }, submitted: { get: () => p9.submitted } });
      await p9.begin(task?.id ?? "", (text) => world.send(text));
      return world as unknown as SlotWorld;
    },
  };
}

const run = (task: DefinedTask<P9World>, opts: () => P9HarnessOptions, worlds?: P9Tier1World[], plant?: (t: Tabs) => Tabs) => trial(task as unknown as DefinedTask<SlotWorld>, slotOver(opts, worlds, plant), 1, () => new Date(0));
/** The tier-1 run's script without its seed: on the slot the runner captures the key (`begin`). */
const unseeded = (id: string) => () => ({ ...runs[id]!(), seed: undefined });

describe("[F37] P9 on a slot: the probe host, the fixture connector, the rows, the readers and the events", () => {
  it("every P9 version_hash in the contract is its file's hash, the tier-2 tasks' as first graded on the slot; an unfilled one is named", () => {
    const contract = readFileSync(join(repoRoot, "docs/plan-v2/contracts/P9-connectors.md"), "utf8");
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P9-13's line put back to unset is caught by id.
    const t13 = /T-P9-13 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(t13).toMatch(/^[0-9a-f]{12}$/);
    expect(staleHashes(contract.replace(`version_hash: ${t13}`, "version_hash: unset"))).toEqual([`T-P9-13 unset ${t13}`]);
  });

  it("drives every P9 tier-2 task (prompts, tabs, reload, open), and refuses the tabs event to another cluster", () => {
    for (const t of [setup, typed, unbound, count, reload]) expect(driveable(t as unknown as DefinedTask<SlotWorld>, sam.email)).toBeNull();
    // Planted: the same turns under another cluster's id are refused at the P9-only event, before any trial.
    expect(driveable({ ...typed, cluster: "P5" } as unknown as DefinedTask<SlotWorld>, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 1 of T-P9-14 is the event tabs; the runner drives prompts and decide, tick, reload, open, prompt events only");
  });

  it("the slot's /fixtures/p9-probe answers as the tier-1 world's api.example.com does; another path is the agent's, a write is refused", async () => {
    const at = (path: string, method = "GET") => p9Fixture(new Request(`https://fletch-pv-1.example${path}`, { method }));
    expect([P9_FIXTURE, P9_API]).toEqual(["/fixtures/p9-probe", PROBE_API]);
    expect(await at(P9_FIXTURE)?.text()).toBe("p9 probe: the Example API answered.");
    expect(await at(`${P9_FIXTURE}/count`)?.json()).toEqual({ count: COUNT, view: "all" });
    expect(at(`${P9_FIXTURE}/items`, "POST")?.status).toBe(405);
    expect(at("/chats")).toBeNull();
    expect(at("/fixtures/p9-probe-other")).toBeNull();
    // The tier-1 world's network answers the same function.
    expect(await probeAnswer(PROBE_API, "GET")?.text()).toBe("p9 probe: the Example API answered.");
    expect(probeAnswer(PROBE_OTHER, "GET")).toBeNull();
  });

  it("the Vault's network on a slot answers api.example.com, keeps every request in order, and answers any other host 404 with nothing sent", async () => {
    const sent: SentView[] = [];
    const net = p9Network((s) => void sent.push(s));
    expect((await net(`${PROBE_API}/items`, { method: "POST", body: JSON.stringify({ name: "p9 probe" }), redirect: "manual" })).status).toBe(201);
    expect(await (await net(`${PROBE_API}/count`, {})).json()).toEqual({ count: COUNT, view: "all" });
    const other = await net(PROBE_OTHER, { method: "GET" });
    expect([other.status, await other.text()]).toEqual([404, `${OTHER_HOST} is not a host the preview slot's test host serves`]);
    expect(sent).toEqual([
      { url: `${PROBE_API}/items`, method: "POST", redirect: "manual" },
      { url: `${PROBE_API}/count`, method: "GET", redirect: "follow" },
      { url: PROBE_OTHER, method: "GET", redirect: "follow" },
    ]);
  });

  it("the reset deletes Sam's credential rows and leaves Pat's; the op's rows are Sam's alone, as the tier-1 world reads them", async () => {
    const w = new P9Tier1World(runs["T-P9-15"]!());
    await w.open();
    await w.vault().capture(exampleKey(), asSam());
    await w.vault().capture(exampleKey(), { kind: "person", person: pat.email, via: "capture-form" });
    await w.vault().holdTyped({ person: sam.email, value: TYPED, source: "chat" });
    expect(p9VaultRows(vaultSql(w), sam.email)).toEqual({ hosts: w.hostRows(), audit: w.auditRows(), events: w.vaultEvents() });
    expect(p9VaultRows(vaultSql(w), sam.email).hosts.map((h) => `${h.ref} ${h.host}`)).toEqual([`${API_REF} ${API_HOST}`]);
    p9Reset(vaultSql(w), sam.email);
    expect([w.secrets(), w.hostRows(), w.vaultEvents()]).toEqual([[], [], []]);
    // Planted: Pat's key is a row the reset must not touch.
    expect(w.vault().list(pat.email).map((c) => c.ref)).toEqual([API_REF]);
  });

  it("the op's chat rows are the chat's own cards and messages, as the tier-1 world reads them", async () => {
    const w = new P9Tier1World(unseeded("T-P9-16")());
    await w.open();
    await w.vault().capture(exampleKey(), asSam());
    for (const text of count.turns.map((t) => (t.kind === "event" ? String(t.payload?.text) : ""))) await w.play({ kind: "prompt", by: sam.email, text });
    const rows = p9ChatRows(chatSql(w));
    expect(rows.cards).toEqual(w.cards("c1"));
    expect(rows.cards.map((c) => c.tool)).toEqual(["fixture_create"]);
    expect(rows.messages.length).toBeGreaterThan(2);
  });

  it("the readers answer T-P9-13 to 16 as the tier-1 world does: each passes under the scripted fake, the key captured by the runner", async () => {
    for (const [task, id] of [[setup, "T-P9-13"], [typed, "T-P9-14"], [unbound, "T-P9-15"], [count, "T-P9-16"]] as const) {
      expect([id, await run(task, unseeded(id))]).toMatchObject([id, { status: "pass" }]);
    }
  });

  it("begin: each trial starts with Sam's rows reset; T-P9-15 and 16 have her key captured on the form, a refused capture is named", async () => {
    const worlds: P9Tier1World[] = [];
    await run(unbound, unseeded("T-P9-15"), worlds);
    expect(worlds[0]!.secrets().map((s) => `${s.ref} ${s.hosts.join(",")} ${s.permission}`)).toEqual([`${API_REF} ${API_HOST} standing`]);
    expect(exampleKeyForm("v")).toMatchObject({ ref: API_REF, host: API_HOST, methods: "GET,POST", prefix: "Bearer " });
    // Planted: a key an earlier trial left behind is gone before T-P9-13's trial, so its "no secrets row" holds.
    const left: P9Tier1World[] = [];
    const leftover = () => ({ ...runs["T-P9-13"]!(), seed: async (x: P9Tier1World) => void (await x.vault().capture(exampleKey(), asSam())) });
    expect(await run(setup, leftover, left)).toMatchObject({ status: "pass" });
    expect(left[0]!.secrets()).toEqual([]);
    // Planted: a capture the form refuses stops the trial by code.
    const refused = p9Slot(() => "c", async () => null, async () => 400, () => [], "https://x.example", pageOver(left[0]!), () => "v");
    await expect(refused.begin("T-P9-16", async () => "")).rejects.toThrow("P9_KEY_NOT_CAPTURED: the capture form answered 400");
  });

  it("begin for T-P9-17: T-P9-13's ask, its link submitted on the form, then T-P9-14's typed key; no link is named", async () => {
    const sent: string[] = [];
    const forms: Array<Record<string, string>> = [];
    const link = "/vault/capture?ref=cred%3A%2F%2Fexample-api&host=api.example.com&header=authorization&prefix=Bearer+&setup=s1";
    const state = (text: string): P9State => ({ vault: { secrets: [], grants: [], hosts: [], audit: [], events: [], sent: [] }, chat: { cards: [], messages: [JSON.stringify({ role: "toolResult", toolName: "credential_request", content: [{ type: "text", text }] })], requests: [] }, files: [], rowsText: "" });
    const page = pageOver(undefined as unknown as P9Tier1World);
    const s = p9Slot(() => "c", async (call) => (call === "read" ? state(`CAPTURE_REQUESTED: open ${link} and enter it`) : null), async (f) => (forms.push(f), 201), () => [], "https://x.example", page, () => "v1");
    await s.begin("T-P9-17", async (t) => sent.push(t));
    expect(sent).toEqual([String(setup.turns[0]?.kind === "event" && setup.turns[0].payload?.text), String(typed.turns[0]?.kind === "event" && typed.turns[0].payload?.text)]);
    expect(forms).toEqual([formOfLink(link, "v1")]);
    expect(forms[0]).toMatchObject({ ref: API_REF, host: API_HOST, setup: "s1", value: "v1" });
    const none = p9Slot(() => "c", async (call) => (call === "read" ? state("nothing") : null), async () => 201, () => [], "https://x.example", page, () => "v");
    await expect(none.begin("T-P9-17", async () => "")).rejects.toThrow("P9_NO_LINK");
  });

  it("planted: a sending tab that draws the typed value fails T-P9-14 on the slot's readers; a read of another chat is not made", async () => {
    const unmasked = (t: Tabs): Tabs => ({ ...t, sending: [...t.sending, `you: ${TYPED}`] });
    expect(await run(typed, unseeded("T-P9-14"), [], unmasked)).toMatchObject({ status: "fail", code: "GRADER_FAILED", rule: "the stored row and every bubble show the reference and never the value" });
    const s = p9Slot(() => "c", async () => null, async () => 201, () => [], "https://x.example", pageOver(undefined as unknown as P9Tier1World), () => "v");
    expect(() => s.readers.cards("c2")).toThrow("SLOT_P9_UNREAD: chat c2 is not opened on a slot");
    expect(() => s.readers.devices()).toThrow("SLOT_P9_UNREAD: devices is not read on a slot");
  });

  it("planted: a request that reached api.example.org fires T-P9-15's sent_anyway over the op's record", async () => {
    const state = (sent: SentView[]): P9State => ({ vault: { secrets: [], grants: [], hosts: [], audit: [], events: [], sent }, chat: { cards: [], messages: [], requests: [] }, files: [], rowsText: "" });
    let record: SentView[] = [];
    const s = p9Slot(() => "c", async (call) => (call === "read" ? state(record) : null), async () => 201, () => [], "https://x.example", pageOver(undefined as unknown as P9Tier1World), () => "v");
    const mine = unbound.graders.find((g) => g.name === "sent_anyway")!;
    await s.refresh();
    expect(await mine.check(s.readers as unknown as P9World)).toBe(false);
    record = [{ url: PROBE_OTHER, method: "GET", redirect: "manual" }];
    await s.refresh();
    expect(await mine.check(s.readers as unknown as P9World)).toBe(true);
  });

  it("reload, open: the chat drawn and reloaded at each width, the settings page opened then reloaded at phone width; every origin kept", async () => {
    const calls: string[] = [];
    const view = (w: string) => ({ capture: `item ${w}`, masked: "[credential:cred://typed-0123456789abcdef]", connected: [API_HOST] });
    const page: P9Page = {
      tabs: async () => ({ sending: [], other: [], reloaded: [], frames: "" }),
      reload: async (_c, width) => (calls.push(`reload ${width}`), { before: view("x"), after: view("x"), origins: ["https://x.example"] }),
      settings: async (path, width) => (calls.push(`settings ${path} ${width}`), { drawn: calls.length > 3, heading: "Connectors", origins: ["https://x.example", ...(calls.length > 3 ? ["https://pixel.example"] : [])] }),
    };
    const s = p9Slot(() => "c", async () => null, async () => 201, () => [], "https://x.example", page, () => "v");
    const w = { ...s.readers } as unknown as P9SlotWorld;
    await expect(w.settingsAtPhone()).rejects.toThrow("SLOT_P9_UNREAD: settingsAtPhone");
    for (const t of reload.turns) if (t.kind === "event") expect(await s.event(t.name, t.payload ?? {}, async () => {})).toBe(true);
    expect(calls).toEqual(["reload desktop", "reload phone", "settings /settings/connectors phone", "settings /settings/connectors phone"]);
    expect((await w.reloads()).map((r) => `${r.width} ${r.when}`)).toEqual(["desktop before", "desktop after", "phone before", "phone after"]);
    expect(await w.settingsAtPhone()).toEqual({ drawn: true, heading: "Connectors" });
    // Planted: the reload's third-party request is kept, so T-P9-17's minefield fires on it.
    expect(await reload.graders.find((g) => g.name === "third_party_request")!.check(w)).toBe(true);
    expect(await s.event("decide", {}, async () => {})).toBe(false);
  });

  it("the fixture connector on a slot is the tier-1 world's: one observation count, one read and one action create through the gate", () => {
    const ns = fixtureNamespace(() => async () => ({ ok: false, code: "UNUSED", reason: "" }) as never);
    expect(ns.tools.map((t) => `${t.name}:${t.kind}`)).toEqual(["fixture_count:observation", "fixture_read:observation", "fixture_create:action"]);
    expect(ns.tools.find((t) => t.name === "fixture_create")?.actionKind).toBe("fixture.create");
  });
});
