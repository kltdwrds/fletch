// F41: the P14 tasks on a preview slot. The runner drives each P14 tier-2 task (Sam's prompts, the drawn name looked at,
// the chat reloaded at two widths, a settings route opened and reloaded); the test host resets Sam's standing files to
// the seed and seeds a second passkey before each trial, and reads her memory, the objects' table counts, the chat
// model calls, her mail rows and the chat's requests with their tool lines and the production guard's answer
// (`scripts/preview-slot/test-host-p14.mjs`); the readers and events over it (`scripts/evals/p14-slot.ts`) answer a P14
// grader as the tier-1 world does. Hermetic: the readers run over Sam's real chat, Person, Ledger and Company in the P14
// tier-1 world, played by the scripted fake model, the op's reads made by the op's own code where it reads storage.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODE_KEY } from "../../packages/agent/src/http/app/settings-panes.ts";
import { PAGE_MODE_KEY } from "../../scripts/evals/p14-page.ts";
import { type P14Page, type P14State, p14Slot } from "../../scripts/evals/p14-slot.ts";
import { CLUSTER_EVENTS, driveable, type Slot, trial } from "../../scripts/evals/runner.ts";
import { counts, P14_PASSKEY, p14Memory, p14Read, p14ResetStanding, p14SeedPasskey, p14Tools, SEED_WRITER, systemsText } from "../../scripts/preview-slot/test-host-p14.mjs";
import { P14Tier1World, sam } from "../evals/p14-identity/harness.ts";
import rename from "../evals/p14-identity/rename-by-chat-changes-nothing-real-model.task.ts";
import { runs } from "../evals/p14-identity/runs.ts";
import settings from "../evals/p14-identity/settings-and-deletion-said-as-they-are-real-model.task.ts";
import signIn from "../evals/p14-identity/sign-in-said-as-it-is-real-model.task.ts";
import account from "../evals/p14-identity/the-agents-account-of-itself-real-model.task.ts";
import type { P14World } from "../evals/p14-identity/world.ts";
import asAgent from "../evals/p14-identity/writes-as-the-agent-real-model.task.ts";
import { EMPTY_SNAPSHOT, type SlotEntry, type SlotWorld } from "../support/evals.ts";
import type { DefinedTask } from "../support/task.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

const ORIGIN = "https://fletch-pv-test.example";
const TIER2 = [rename, signIn, asAgent, settings, account] as unknown as Array<DefinedTask<SlotWorld>>;
const memOf = (w: P14Tier1World) => w.w.host(sam.email).memory.mem;
const bucketOf = (w: P14Tier1World) => (memOf(w).home as unknown as { bucket: R2Bucket }).bucket;
type LoginCall = Parameters<ReturnType<P14Tier1World["w"]["company"]>["loginCall"]>[0];
const login = (w: P14Tier1World) => (c: LoginCall) => w.w.companyHarness().instance.loginCall(c);

/** The `p14` op's read over the tier-1 world, as `scripts/preview-slot/test-host.mjs` answers it on a slot. */
async function p14State(w: P14Tier1World): Promise<P14State> {
  const m = await p14Memory(memOf(w), sam.email);
  const byObject: P14State["counts"] = {};
  for (const [k, n] of Object.entries(w.tables())) {
    const i = k.indexOf("/");
    byObject[k.slice(0, i)] = { ...byObject[k.slice(0, i)], [k.slice(i + 1)]: n };
  }
  const calls = (await w.w.ledger().modelCalls({ person: sam.email })).map((r, i) => ({ id: i + 1, route: r.route, model: r.model })).filter((r) => r.route === "chat");
  const asked = w.asked();
  const systems = w.w.fake.requests.filter((_, i) => asked[i]?.surface === "chat").map((r) => systemsText(r.inputs) ?? "");
  // Assembled by the op's own `p14Read`, so a field the op leaves out is missing here too.
  return p14Read({
    mem: { ...m, counts: byObject.person ?? {} },
    chat: { systems, counts: byObject.c1 ?? {} },
    ledger: { calls: calls.map(({ id, model }) => ({ id, model })), counts: byObject.ledger ?? {} },
    vault: byObject.vault ?? {},
    journal: await w.w.ledger().journalRows({ principal: sam.email }),
  });
}

/** The tier-1 page's reads as Sam's page on a slot: the drawn name from the tier-1 `look`, a reload its eviction. */
const pageOver = (w: P14Tier1World): P14Page => ({
  async look(_c, width) {
    await w.play({ kind: "event", name: "look", payload: { width } });
    const { width: _w, ...drawn } = w.drawn.at(-1)!;
    return { drawn, origins: [ORIGIN] };
  },
  async reload() {
    await w.play({ kind: "event", name: "reload" });
    return { origins: [ORIGIN] };
  },
  async settings(route) {
    const r = await w.w.http(sam.email, "GET", route);
    const html = String(r.body.html ?? "");
    return { drawn: r.status === 200 && html.includes('id="settings"'), heading: /<h2[^>]*>([^<]*)<\/h2>/.exec(html)?.[1] ?? "", mode: { before: null, after: null }, origins: [ORIGIN] };
  },
});

/** A slot whose every trial is a fresh tier-1 world behind the slot's readers, as `scripts/evals/slot.ts` builds them. */
function slotOver(seed?: (w: P14Tier1World) => Promise<void>, worlds: P14Tier1World[] = []): Slot {
  return {
    name: "fletch-pv-test",
    async open(task) {
      const w = new P14Tier1World({ script: runs[task?.id ?? ""]?.().script ?? [] });
      await w.open();
      await memOf(w).standingFiles();
      // A seed here is what an earlier trial left on the slot: the runner's reset must clear it.
      await seed?.(w);
      worlds.push(w);
      const entries = () => w.engine("c1").history().entries as unknown as SlotEntry[];
      const s = p14Slot(
        () => w.chatId("c1"),
        entries,
        async () => entries(),
        async (call) => {
          if (call === "reset") await p14ResetStanding(bucketOf(w), sam.email, w.w.clock.now);
          else if (call === "seed") await p14SeedPasskey(login(w), sam.email);
          else return p14State(w);
          return null;
        },
        pageOver(w),
        ORIGIN,
        sam.email,
      );
      const world = {
        chatId: w.chatId("c1"),
        replies: [] as string[],
        snapshot: () => EMPTY_SNAPSHOT,
        entries,
        reactions: () => [],
        async send(text: string) {
          await w.play({ kind: "prompt", by: sam.email, text });
          await s.refresh();
          return "";
        },
        async event(name: string, payload: Record<string, string>) {
          if (await s.event(name, payload)) return;
          throw new Error(`unplayed ${name}`);
        },
        read: async (path: string) => w.w.http(sam.email, "GET", path),
      };
      Object.defineProperties(world, Object.getOwnPropertyDescriptors(s.readers));
      await s.begin();
      return world as unknown as SlotWorld;
    },
  };
}

const run = (task: DefinedTask<SlotWorld>, seed?: (w: P14Tier1World) => Promise<void>, worlds?: P14Tier1World[]) => trial(task, slotOver(seed, worlds), 1, () => new Date(0));

describe("[F41] P14 on a slot: the resets, the passkey seed, the readers and the events", () => {
  it("every P14 version_hash in the contract is its file's hash, none unfilled; an unfilled one is named", () => {
    const contract = readFileSync(join(repoRoot, "docs/plan-v2/contracts/P14-identity.md"), "utf8");
    expect(staleHashes(contract)).toEqual([]);
    expect(contract).not.toContain("unfilled");
    // Planted: T-P14-04's line put back to unfilled is caught by id.
    const t04 = /T-P14-04 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(t04).toMatch(/^[0-9a-f]{12}$/);
    expect(staleHashes(contract.replace(`version_hash: ${t04}`, "version_hash: unfilled"))).toEqual([`T-P14-04 unfilled ${t04}`]);
  });

  it("drives every P14 tier-2 task (prompts, look, reload, settings); look and settings are P14's alone", () => {
    for (const t of TIER2) expect(driveable(t, sam.email)).toBeNull();
    expect(CLUSTER_EVENTS.P14).toEqual(["look", "settings"]);
    // Planted: T-P14-10's turns under another cluster's id are refused at the look event, before any trial.
    expect(driveable({ ...TIER2[0]!, cluster: "P5" }, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 3 of T-P14-10 is the event look; the runner drives prompts and decide, tick, reload, open, prompt events only");
  });

  it("the readers answer T-P14-10 to 14 as the tier-1 world does: each passes under the scripted fake", async () => {
    for (const task of TIER2) expect([task.id, await run(task)]).toMatchObject([task.id, { status: "pass" }]);
  });

  it("the op's tool lines are the tier-1 world's, each with the production guard's answer; every system message is kept, the envelope's model line among them", async () => {
    const w = new P14Tier1World(runs["T-P14-14"]!());
    await w.open();
    for (const t of account.turns) await w.play(t);
    const st = await p14State(w);
    expect(st.seeded).toEqual(w.seeded);
    expect(st.tools.map(({ name, description }) => ({ name, description }))).toEqual(w.tools());
    expect(st.tools.every((t) => t.guard === w.guard(t))).toBe(true);
    const ids = await w.modelIds();
    expect(st.systems.some((s) => s.includes(`model: ${ids[0]}`))).toBe(true);
    // Planted: the first system message alone (what the `p5` op keeps) carries no envelope, so T-P14-14's fact fails.
    const firstOnly = w.w.fake.requests.map((r) => ((r.inputs as { messages: Array<{ role: string; content: unknown }> }).messages.find((m) => m.role === "system")?.content as string) ?? "");
    expect(firstOnly.some((s) => s.includes(`model: ${ids[0]}`))).toBe(false);
    // Planted: a tool line the guard refuses is answered with its word.
    expect(p14Tools("- settings_set (action): Change a setting.").find((t) => t.name === "settings_set")?.guard).not.toBeNull();
  });

  it("begin: a standing file an earlier trial changed is written back to the seed, so T-P14-10 holds; without the reset it fails", async () => {
    const changed = async (x: P14Tier1World) => {
      await memOf(x).writeStanding("IDENTITY.md", "# IDENTITY.md\n\nName: Probe\n", "agent:sam");
      await memOf(x).home.write("MEMORY.md", "# MEMORY.md\n\n## Preferences\n\n- The person goes by Sam.\n", "agent:sam", x.w.clock.now);
    };
    const left: P14Tier1World[] = [];
    expect(await run(TIER2[0]!, changed, left)).toMatchObject({ status: "pass" });
    const identity = await memOf(left[0]!).home.read("IDENTITY.md");
    expect([identity?.text, identity?.writer]).toEqual(["# IDENTITY.md\n\nName: not chosen yet.\n", SEED_WRITER]);
    // MEMORY.md too: a curated line an earlier trial wrote is not there for the next one to find.
    const memory = await memOf(left[0]!).home.read("MEMORY.md");
    expect([memory?.text, memory?.writer]).toEqual([left[0]!.seeded["MEMORY.md"], SEED_WRITER]);
    // Planted: the same change with no reset fires T-P14-10's standing_file_written.
    const kept = new P14Tier1World(runs["T-P14-10"]!());
    await kept.open();
    await memOf(kept).standingFiles();
    await changed(kept);
    expect(await rename.graders.find((g) => g.name === "standing_file_written")!.check(kept as unknown as P14World)).toBe(true);
  });

  it("the passkey seed adds one inert passkey when the owner holds fewer than two, and none when two are held", async () => {
    const w = new P14Tier1World(runs["T-P14-11"]!());
    await w.open();
    const call = login(w);
    expect(await p14SeedPasskey(call, sam.email)).toEqual({ added: true, count: 1 });
    expect(((await call({ op: "list" })) as Array<{ id: string }>).map((p) => p.id)).toEqual([P14_PASSKEY]);
    await call({ op: "add", id: "sam-own", email: sam.email, publicKey: new Uint8Array(65), counter: 0, transports: [] });
    expect(await p14SeedPasskey(call, sam.email)).toEqual({ added: false, count: 2 });
    expect(((await call({ op: "list" })) as unknown[]).length).toBe(2);
  });

  it("the memory lines, model calls, mail rows and table counts graded are the trial's own; an unread reader is said by name", async () => {
    const base: P14State = { standing: [], seeded: {}, daily: ["2026-10-30#1 an earlier line"], memory: "# MEMORY.md\n\n- an earlier fact\n", memoryWriter: "agent:sam", counts: { c1: { messages: 2 } }, calls: [{ id: 7, model: "@cf/old" }], mail: [{ id: "m0", outcome: "DONE", counterpart: "pat@solo-sam.example" }], systems: [], tools: [] };
    let st = base;
    const page: P14Page = { look: async () => ({ drawn: { header: "", panelName: "", cardName: "", cardNote: "", controls: [], handle: "" }, origins: [] }), reload: async () => ({ origins: [] }), settings: async () => ({ drawn: true, heading: "General", mode: { before: "dark", after: "dark" }, origins: ["https://elsewhere.example"] }) };
    const s = p14Slot(() => "c", () => [], async () => [], async (call) => (call === "read" ? st : null), page, ORIGIN, sam.email);
    await s.begin();
    expect([await s.readers.remembered(), await s.readers.modelIds(), s.readers.handed()]).toEqual([[], [], []]);
    st = { ...base, daily: [...base.daily, "2026-10-30#2 Sam goes by Sam"], memory: `${base.memory}- prefers short drafts\n`, counts: { c1: { messages: 4 } }, calls: [...base.calls, { id: 8, model: "@cf/new" }], mail: [...base.mail, { id: "m1", outcome: "DONE", counterpart: "pat@solo-sam.example" }] };
    await s.refresh();
    expect(await s.readers.remembered()).toEqual(["Sam goes by Sam", "- prefers short drafts"]);
    expect(await s.readers.modelIds()).toEqual(["@cf/new"]);
    expect(s.readers.handed().map((m) => m.to)).toEqual(["pat@solo-sam.example"]);
    expect([s.readers.before, s.readers.tables()]).toEqual([{ "c1/messages": 2 }, { "c1/messages": 4 }]);
    // A settings route opened at phone width is read with the mode around it and every origin; another origin is kept.
    expect(await s.event("settings", { route: "/settings/general", width: "phone" })).toBe(true);
    expect([await s.readers.settingsAtPhone(), s.readers.mode, s.readers.origins()]).toEqual([{ drawn: true, heading: "General" }, { before: "dark", after: "dark" }, ["https://elsewhere.example"]]);
    expect(await s.event("tabs", {})).toBe(false);
    expect(() => s.readers.rowsText()).toThrow("SLOT_P14_UNREAD: rowsText is not read on a slot");
    expect(() => s.readers.loginReach).toThrow("SLOT_P14_UNREAD: loginReach is not read on a slot");
    expect(() => s.readers.thread("c2")).toThrow("SLOT_P14_UNREAD: chat c2 is not opened on a slot");
    expect(() => s.readers.guard({ name: "x", description: "y" })).toThrow("SLOT_P14_UNREAD: no guard was read for x");
  });

  it("the page reads the mode under the key the Settings page stores it", () => {
    expect(PAGE_MODE_KEY).toBe(MODE_KEY);
  });

  it("counts reads every table's rows of an object's SQLite, the runtime's own aside", () => {
    const tables = [{ name: "messages" }, { name: "_cf_KV" }, { name: "sqlite_sequence" }, { name: "cards" }];
    const sql = { exec: (q: string) => ({ toArray: () => (q.startsWith("SELECT name") ? tables : [{ n: q.includes('"messages"') ? 3 : 0 }]) }) };
    expect(counts(sql)).toEqual({ messages: 3, cards: 0 });
  });
});
