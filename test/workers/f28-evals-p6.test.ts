// F28: the P6 tasks on a preview slot. The runner sends each prompt into the chat its turn names and opens the world for
// the task; the slot's test host empties Sam's memory, seeds the task's setup through the Person's own seams and reads
// her memory and the chats' stored rows (`scripts/preview-slot/test-host-p6.mjs`); the readers over it
// (`scripts/evals/p6-slot.ts`) answer a P6 grader as the tier-1 world does. Hermetic: the test host's calls run on
// Sam's real memory store in the P6 tier-1 world, its chats played by the scripted fake model.
import { describe, expect, it } from "vitest";
import { P6_SEEDS, type P6Call, p6Slot } from "../../scripts/evals/p6-slot.ts";
import { trial } from "../../scripts/evals/runner.ts";
import { chatRows, p6Person } from "../../scripts/preview-slot/test-host-p6.mjs";
import { type P6HarnessOptions, type P6Tier1World, p6Harness, writeDaily } from "../evals/p6-memory/harness.ts";
import inPassing from "../evals/p6-memory/in-passing-announced.task.ts";
import across from "../evals/p6-memory/remember-and-recall-across-chats.task.ts";
import { scripted } from "../evals/p6-memory/runs.ts";
import { type ChatLabel, type P6World, PAT_FACT, SAM_FACT } from "../evals/p6-memory/world.ts";
import { EMPTY_SNAPSHOT, type SlotEntry, type SlotWorld } from "../support/evals.ts";
import { Seeded } from "../support/seeded.ts";
import { asBucket } from "../workers/support/fake-r2.ts";

async function played(o: P6HarnessOptions, turns = inPassing.turns) {
  const h = p6Harness(o);
  const rng = new Seeded(inPassing.setup.seed);
  const world = await h.setup(rng, inPassing);
  for (const t of turns) await h.play(world, t, rng);
  return world;
}

/** The test host's `p6` op over the tier-1 world: `p6Person` on Sam's real memory, `chatRows` on each chat's SQLite. */
function hostOver(w: P6Tier1World): { call: P6Call; chats: Map<ChatLabel, string> } {
  const svc = w.svc;
  const person = { name: svc.mem.owner, env: { AGENT_BUCKET: asBucket(w.w.r2) }, personMemory: svc.mem, memory: svc, memoryWrite: svc.memoryWrite.bind(svc), forgetConfirm: svc.forgetConfirm.bind(svc) };
  const chats = new Map<ChatLabel, string>();
  for (const l of ["c1", "c2"] as ChatLabel[]) {
    try {
      chats.set(l, w.harness(l).name);
    } catch {
      // A chat the run never opened.
    }
  }
  const labelOf = (id: string) => [...chats].find(([, v]) => v === id)?.[0] as ChatLabel;
  const call: P6Call = async (c, ids) => ({
    answer: (await p6Person(person, c)) as Record<string, unknown>,
    rows: Object.fromEntries(ids.map((id) => [id, chatRows({ exec: (q: string) => ({ toArray: () => w.harness(labelOf(id)).rows(q) }) })])),
  });
  return { call, chats };
}

const entriesFrom = (w: P6Tier1World) => (l: ChatLabel) => w.entries(l) as SlotEntry[];
const verdicts = async (world: P6World) => Object.fromEntries(await Promise.all(inPassing.graders.map(async (g) => [g.name, g.kind === "minefield" ? !(await g.check(world)) : await g.check(world)])));

describe("[F28] P6 on a slot: the test host's memory world and the runner's chats", () => {
  it("the runner opens the world for the task and sends each prompt into the chat its turn names", async () => {
    const sent: string[] = [];
    let opened = "";
    const world: SlotWorld = {
      chatId: "chat-1",
      replies: [],
      snapshot: () => EMPTY_SNAPSHOT,
      entries: () => [],
      reactions: () => [],
      send: async (t, chat) => (sent.push(`${chat ?? "-"}:${t}`), t),
      read: async () => ({ status: 200, body: {} }),
      event: async () => {},
    };
    const t = await trial({ ...across, graders: [] } as never, { name: "fletch-pv-9", open: async (task) => {
          opened = `${task?.cluster}/${task?.id}`;
          return world;
        },
      }, 1, () => new Date(0));
    expect(t.status).toBe("pass");
    expect(opened).toBe("P6/T-P6-09");
    expect(sent.map((s) => s.split(":")[0])).toEqual(["c1", "c2", "c1", "c2"]);
  });

  it("the readers over the test host read what the tier-1 world reads, and grade T-P6-04 alike", async () => {
    const w = await played(scripted["T-P6-04"]!());
    const { call, chats } = hostOver(w);
    const slot = p6Slot(call, () => chats, entriesFrom(w));
    await slot.refresh("prompt:c1");
    const r = slot.readers as unknown as P6World;
    expect(r.lines()).toEqual(w.lines());
    expect(r.claims()).toEqual(w.claims());
    expect(r.chunks()).toEqual(w.chunks());
    expect(r.rows("c1")).toEqual(w.rows("c1"));
    expect(r.writes()).toEqual(w.writes());
    expect(r.paths().sort()).toEqual(w.paths().sort());
    expect(await r.get(w.lines()[0]!.citation.split("#L")[0]!, 3, 1)).toEqual(await w.get(w.lines()[0]!.citation.split("#L")[0]!, 3, 1));
    expect(await r.search(["Thursdays"])).toEqual(await w.search(["Thursdays"]));
    expect(r.after()).toEqual([{ turn: "prompt:c1", paths: r.paths() }]);
    expect(() => r.plan()).toThrow(/SLOT_P6_UNREAD: plan/);
    expect(await verdicts(r)).toEqual(Object.fromEntries(inPassing.graders.map((g) => [g.name, true])));

    // Planted: the passing fact saved and the reply "Noted", read over the slot's readers, trips silent_save.
    const silent = await played({ script: [writeDaily("call_sam", SAM_FACT), { text: "Noted." }] });
    const s = hostOver(silent);
    const planted = p6Slot(s.call, () => s.chats, entriesFrom(silent));
    await planted.refresh();
    expect((await verdicts(planted.readers as unknown as P6World)).silent_save).toBe(false);
  });

  it("begin empties Sam's memory, then seeds T-P6-12's setup through the Person: two lines, their claims, the Pat claim forgotten", async () => {
    const w = await played({ script: [writeDaily("call_old", "Sam Solo walks to work on Tuesdays"), { text: "Saved." }] });
    expect(w.lines()).toHaveLength(1);
    const { call, chats } = hostOver(w);
    const slot = p6Slot(call, () => chats, entriesFrom(w));
    await slot.begin("T-P6-12");
    const r = slot.readers as unknown as P6World;
    // The earlier line, its chunk and the rendered note are gone; the seed's two lines are said in c1.
    expect(r.lines().map((l) => [l.text, l.source])).toEqual([
      ["[forgotten]", "chat:c1"],
      [SAM_FACT, "chat:c1"],
    ]);
    expect(r.chunks().some((c) => /Tuesdays|plain text/.test(c.text))).toBe(false);
    expect(r.claims().map((c) => c.quote)).toEqual([SAM_FACT]);
    expect((await r.search(["Pat Solo plain text"])).hits.filter((h) => h.text.includes(PAT_FACT))).toEqual([]);
    expect(P6_SEEDS["T-P6-03"]).toEqual([{ do: "write", text: PAT_FACT, source: "c1", dedupe: "seed_pat" }]);
  });

  it("a seed step the Person refuses stops the trial by name, before any turn", async () => {
    const slot = p6Slot(async (c) => ({ answer: c.do === "reset" ? { ok: true } : { ok: false, code: "MEMORY_VALUE_REFUSED" }, rows: {} }), () => new Map([["c1", "chat-1"]]), () => []);
    await expect(slot.begin("T-P6-03")).rejects.toThrow("P6_SEED_REFUSED: write MEMORY_VALUE_REFUSED");
    const unreset = p6Slot(async () => ({ answer: { ok: false, code: "P6_OP_UNKNOWN" }, rows: {} }), () => new Map(), () => []);
    await expect(unreset.begin("T-P6-04")).rejects.toThrow("P6_SEED_REFUSED: reset P6_OP_UNKNOWN");
  });
});
