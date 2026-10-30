// F39: the P12 tasks on a preview slot. The runner drives each P12 tier-2 task (Sam's prompts, a send seen from two
// tabs, the chat reloaded at two widths, `/settings` opened and reloaded); the slot's browser answers nothing for
// `shop.example.invalid`, the test host deletes Sam's grant rows (`p12`) beside her credential and typed rows (`p9`)
// before each trial and reads the chat's cards with their words, her grants, journal rows and jobs
// (`scripts/preview-slot/test-host-p12.mjs`); the readers and events over it (`scripts/evals/p12-slot.ts`) answer a P12
// grader as the tier-1 world does. Hermetic: the readers run over Sam's real chat, Person, Ledger and Vault in the P12
// tier-1 world, played by the scripted fake model, the op's rows read from the objects' own SQLite by the op's code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type P12Page, type P12State, p12Slot } from "../../scripts/evals/p12-slot.ts";
import { p5Slot } from "../../scripts/evals/p5-slot.ts";
import { type P9Page, type P9State, p9Slot } from "../../scripts/evals/p9-slot.ts";
import { CLUSTER_EVENTS, driveable, type Slot, trial } from "../../scripts/evals/runner.ts";
import { P12_DEAD, P12_TABLES, p12Cards, p12Grants, p12Journal, p12Reset } from "../../scripts/preview-slot/test-host-p12.mjs";
import { p9ChatRows, p9Reset, p9VaultRows } from "../../scripts/preview-slot/test-host-p9.mjs";
import { PAGES, SITES, testHostBinding } from "../../scripts/preview-slot/test-host-sites.mjs";
import allowance from "../evals/p12-wallet/allowance-refused-real-model.task.ts";
import card from "../evals/p12-wallet/card-typed-real-model.task.ts";
import { P12Tier1World, sam } from "../evals/p12-wallet/harness.ts";
import once from "../evals/p12-wallet/purchase-card-once-or-decline.task.ts";
import refused from "../evals/p12-wallet/purchase-refused-by-name-real-model.task.ts";
import { cappedOnce, runs } from "../evals/p12-wallet/runs.ts";
import wallet from "../evals/p12-wallet/wallet-state-and-reload-real-model.task.ts";
import type { P12SlotWorld, P12World } from "../evals/p12-wallet/world.ts";
import { DEAD_SHOP } from "../evals/p12-wallet/world.ts";
import type { Tabs } from "../evals/p9-connectors/world.ts";
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
const vaultSql = (w: P12Tier1World) => sqlOver(w.vaultH);
const chatSql = (w: P12Tier1World) => sqlOver(w.w.chats.harness(w.chatId("c1")));
const personSql = (w: P12Tier1World) => sqlOver(w.w.personHarness(sam.email) as never);

/** The `p9` and `p12` ops' state over the tier-1 world, as `scripts/preview-slot/test-host.mjs` answers them on a slot. */
async function p9State(w: P12Tier1World): Promise<P9State> {
  return {
    vault: { secrets: w.secrets(), grants: w.credentialGrants(), ...p9VaultRows(vaultSql(w), sam.email), sent: w.sent() },
    chat: { ...p9ChatRows(chatSql(w)), requests: w.requests() },
    files: await w.files(),
    rowsText: w.rowsText(),
  };
}
async function p12State(w: P12Tier1World): Promise<P12State> {
  const jobs = w.w.jobIds(sam.email).map((id) => ({ id, title: w.w.jobOf(sam.email, id).instance.status()?.def.title ?? id }));
  return { cards: p12Cards({ sql: chatSql(w) }, (e) => e), grants: p12Grants(w.w.host(sam.email).authority.list(sam.email)), journal: p12Journal(await w.w.journal()), jobs };
}

/** The tier-1 page as the slot's two tabs, from the tier-1 harness's own `tabs` turn. */
const tabsOver = (w: P12Tier1World): P9Page => ({
  async tabs(_c, text, settled) {
    await w.play({ kind: "event", name: "tabs", payload: { text } });
    await settled();
    return w.tabs as Tabs;
  },
  reload: async () => ({ before: { capture: null, masked: null, connected: [] }, after: { capture: null, masked: null, connected: [] }, origins: [] }),
  settings: async () => ({ drawn: true, heading: "", origins: [] }),
});
const noPage: P12Page = { reload: async () => ({ before: { replies: [], masked: null }, after: { replies: [], masked: null }, origins: [] }), settings: async () => ({ drawn: true, panes: [], heading: "", origins: [] }) };

/** A slot whose every trial is a fresh tier-1 world behind the slot's readers, as `scripts/evals/slot.ts` builds them. */
function slotOver(seed?: (w: P12Tier1World) => Promise<void>, worlds: P12Tier1World[] = []): Slot {
  return {
    name: "fletch-pv-test",
    async open(task) {
      const w = new P12Tier1World({ script: runs[task?.id ?? ""]?.().script ?? [] });
      await w.open();
      // A seed here is what an earlier trial left on the slot: the runner's resets must clear it.
      await seed?.(w);
      worlds.push(w);
      const entries = () => w.engine("c1").history().entries as unknown as SlotEntry[];
      let clock = 0;
      const p5 = p5Slot(() => w.chatId("c1"), entries, async (path) => w.w.http(sam.email, "GET", path), async () => w.prompts(), { rows: async () => [], drawer: async () => null }, async () => {
        clock += 1;
      }, () => clock);
      const p9 = p9Slot(() => w.chatId("c1"), async (call) => (call === "reset" ? (p9Reset(vaultSql(w), sam.email), null) : p9State(w)), async () => 201, () => p5.readers.prompts(), "https://fletch-pv-test.example", tabsOver(w), () => "v");
      const effects = () => w.ranEffects().filter((e) => e.tool === "share_post").map((e) => ({ host: String(e.args.host), text: String(e.args.text) }));
      const p12 = p12Slot(() => w.chatId("c1"), async (call) => (call === "reset" ? (p12Reset(personSql(w)), null) : p12State(w)), effects, p5.readers, "https://fletch-pv-test.example", noPage);
      const after = async () => {
        await p5.settle(clock + 3);
        await p9.refresh();
        await p12.refresh();
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
          if (await p12.event(name, payload)) return;
          if (await p9.event(name, payload, () => p5.settle(clock + 3))) return;
          throw new Error(`unplayed ${name}`);
        },
        read: async (path: string) => w.w.http(sam.email, "GET", path),
      };
      for (const r of [p5.readers, p9.readers, p12.readers]) Object.defineProperties(world, Object.getOwnPropertyDescriptors(r));
      Object.defineProperties(world, { tabs: { get: () => p9.tabs }, marks: { get: () => p9.marks }, submitted: { get: () => p9.submitted } });
      await p9.begin(task?.id ?? "", (text) => world.send(text));
      await p12.begin(task?.id ?? "", (text) => world.send(text));
      return world as unknown as SlotWorld;
    },
  };
}

const run = (task: DefinedTask<P12World>, seed?: (w: P12Tier1World) => Promise<void>, worlds?: P12Tier1World[]) => trial(task as unknown as DefinedTask<SlotWorld>, slotOver(seed, worlds), 1, () => new Date(0));

describe("[F39] P12 on a slot: the dead shop, the resets, the rows, the readers and the events", () => {
  it("every P12 version_hash in the contract is its file's hash, the four tier-2 tasks' filled; an unfilled one is named", () => {
    const contract = readFileSync(join(repoRoot, "docs/plan-v2/contracts/P12-wallet.md"), "utf8");
    expect(staleHashes(contract)).toEqual([]);
    // Planted: T-P12-10's line put back to unfilled is caught by id.
    const t10 = /T-P12-10 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(t10).toMatch(/^[0-9a-f]{12}$/);
    expect(staleHashes(contract.replace(`version_hash: ${t10}`, "version_hash: unfilled"))).toEqual([`T-P12-10 unfilled ${t10}`]);
  });

  it("drives every P12 tier-2 task (prompts, tabs, reload, open); the tabs event is P9's and P12's alone", () => {
    for (const t of [refused, card, allowance, wallet]) expect(driveable(t as unknown as DefinedTask<SlotWorld>, sam.email)).toBeNull();
    expect(CLUSTER_EVENTS.P12).toEqual(["tabs"]);
    // Planted: T-P12-11's turns under another cluster's id are refused at the tabs event, before any trial.
    expect(driveable({ ...card, cluster: "P5" } as unknown as DefinedTask<SlotWorld>, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 1 of T-P12-11 is the event tabs; the runner drives prompts and decide, tick, reload, open, prompt events only");
  });

  it("the slot's browser answers nothing for shop.example.invalid: a 404, the one read recorded, no site or page of that name", async () => {
    expect(P12_DEAD).toBe(DEAD_SHOP);
    expect(Object.keys(SITES)).not.toContain(P12_DEAD);
    expect(Object.keys(PAGES).some((u) => new URL(u).hostname === P12_DEAD)).toBe(false);
    const reads: Array<{ kind: string; host: string }> = [];
    const b = testHostBinding(async (e: { kind: string; host: string }) => void reads.push(e));
    const r = await b.quickAction("markdown", { url: `https://${P12_DEAD}/checkout` });
    expect([r.status, await r.text()]).toEqual([404, `${P12_DEAD} is not a site the preview slot's test host serves`]);
    expect(reads).toEqual([{ kind: "read", host: P12_DEAD }]);
    // Planted: a fixture of that name would answer, so the binding's 404 is the absence of one, not a refusal of all.
    const served = testHostBinding(async () => {}, { ...SITES, [P12_DEAD]: { markdown: "# Shop" } });
    expect((await served.quickAction("markdown", { url: `https://${P12_DEAD}` })).status).toBe(200);
  });

  it("the p12 reset deletes Sam's grant rows; the op's cards, grants and journal rows are the tier-1 world's", async () => {
    const w = new P12Tier1World(runs["T-P12-02"]!());
    await w.open();
    for (const t of once.turns) await w.play(t);
    const st = await p12State(w);
    expect(st.cards).toEqual(w.cardWords("c1"));
    expect(st.cards.map((c) => c.kind)).toEqual(["purchase"]);
    expect(st.grants).toEqual(w.grantRows());
    expect(st.journal).toEqual(await w.ledgerJournal());
    expect(w.grantRows().length).toBe(1);
    expect(P12_TABLES).toEqual(["grants", "grant_uses", "committed_effects"]);
    p12Reset(personSql(w));
    expect([w.grantRows(), w.w.personHarness(sam.email)!.rows("SELECT * FROM grant_uses")]).toEqual([[], []]);
  });

  it("the readers answer T-P12-10 to 12 as the tier-1 world does: each passes under the scripted fake", async () => {
    for (const task of [refused, card, allowance]) expect([task.id, await run(task)]).toMatchObject([task.id, { status: "pass" }]);
  });

  it("begin: a grant an earlier trial left is gone before T-P12-12, so its graders hold; T-P12-13 plays 10 and 11 first", async () => {
    const left: P12Tier1World[] = [];
    const leftover = async (x: P12Tier1World) => void x.w.host(sam.email).authority.create(sam.email, cappedOnce);
    expect(await run(allowance, leftover, left)).toMatchObject({ status: "pass" });
    expect(left[0]!.grantRows()).toEqual([]);
    // Planted: without the reset the leftover grant fires T-P12-12's allowance_written.
    const kept = new P12Tier1World(runs["T-P12-12"]!());
    await kept.open();
    await leftover(kept);
    expect(await allowance.graders.find((g) => g.name === "allowance_written")!.check(kept)).toBe(true);
    const sent: string[] = [];
    const s = p12Slot(() => "c", async () => null, () => [], { activity: async () => ({ tasks: [] }), task: async () => ({}) as never }, "https://x.example", noPage);
    await s.begin("T-P12-13", async (t) => void sent.push(t));
    expect(sent).toEqual([refused.turns[0]!.kind === "prompt" ? refused.turns[0]!.text : "", String(card.turns[0]!.kind === "event" && card.turns[0]!.payload?.text)]);
    expect(sent[1]).toContain("4242 4242 4242 4242");
  });

  it("the journal rows and jobs counted are the trial's own; a purchase card on the chat fires T-P12-10's card_raised", async () => {
    let st: P12State = { cards: [], grants: [], journal: [{ id: "old", actionKind: "purchase", decision: "ask", outcome: "DONE", grantId: null, fields: [], raw: "" }], jobs: [{ id: "j0", title: "an earlier trial's job" }] };
    const s = p12Slot(() => "c", async (call) => (call === "read" ? st : null), () => [], { activity: async () => ({ tasks: [] }), task: async () => ({}) as never }, "https://x.example", noPage);
    await s.begin("T-P12-12", async () => "");
    expect([await s.readers.ledgerJournal(), s.readers.jobTitles()]).toEqual([[], []]);
    st = { ...st, jobs: [...st.jobs, { id: "j1", title: "p12 allowance" }], cards: [{ id: "k1", tool: "shop_buy", kind: "purchase", state: "pending", outcome: null, grantId: null, lines: [], choices: [], proposed: {}, decidedAt: null }] };
    await s.refresh();
    expect(s.readers.jobTitles()).toEqual(["p12 allowance"]);
    expect(await refused.graders.find((g) => g.name === "card_raised")!.check(s.readers as unknown as P12World)).toBe(true);
    expect(() => s.readers.cardWords("c2")).toThrow("SLOT_P12_UNREAD: chat c2 is not opened on a slot");
    expect(() => s.readers.handoffs()).toThrow("SLOT_P12_UNREAD: handoffs is not read on a slot");
  });

  it("reload, open: the chat drawn and reloaded at each width, /settings opened then reloaded at phone width; every origin kept", async () => {
    const calls: string[] = [];
    const view = { replies: ["one", "two", "three"], masked: "my card is [credential:cred://typed-0123456789abcdef]" };
    let panes = ["General", "Connectors", "Permissions", "Devices", "Messaging channels", "Help & support"];
    const page: P12Page = {
      reload: async (_c, width) => (calls.push(`reload ${width}`), { before: view, after: view, origins: ["https://x.example"] }),
      settings: async (path, width) => (calls.push(`settings ${path} ${width}`), { drawn: true, panes, heading: "General", origins: ["https://x.example"] }),
    };
    const s = p12Slot(() => "c", async () => null, () => [], { activity: async () => ({ tasks: [] }), task: async () => ({}) as never }, "https://x.example", page);
    const w = s.readers as unknown as P12SlotWorld;
    await expect(w.settingsAtPhone()).rejects.toThrow("SLOT_P12_UNREAD: settingsAtPhone");
    for (const t of wallet.turns) if (t.kind === "event") expect(await s.event(t.name, t.payload ?? {})).toBe(true);
    expect(calls).toEqual(["reload desktop", "reload phone", "settings /settings phone", "settings /settings phone"]);
    expect((await w.reloads()).map((r) => `${r.width} ${r.when}`)).toEqual(["desktop before", "desktop after", "phone before", "phone after"]);
    const g = (name: string) => wallet.graders.find((x) => x.name === name)!.check(w);
    expect([await g("after each reload the refusals and the masked row read the same at both widths"), await g("/settings draws after a reload at phone width with no Wallet pane and no not found"), await g("every request went to the slot's own origin")]).toEqual([true, true, true]);
    expect(await s.event("tabs", {})).toBe(false);
    // Planted: a Wallet pane drawn on the reload, and a request that left the slot, each fail their grader.
    panes = [...panes, "Wallet"];
    await s.event("reload", { width: "phone" });
    expect(await g("/settings draws after a reload at phone width with no Wallet pane and no not found")).toBe(false);
    const leak: P12Page = { ...page, reload: async () => ({ before: view, after: view, origins: ["https://pixel.example"] }) };
    const t = p12Slot(() => "c", async () => null, () => [], { activity: async () => ({ tasks: [] }), task: async () => ({}) as never }, "https://x.example", leak);
    await t.event("reload", { width: "desktop" });
    expect(await wallet.graders.find((x) => x.name === "third_party_request")!.check(t.readers as unknown as P12SlotWorld)).toBe(true);
  });
});
