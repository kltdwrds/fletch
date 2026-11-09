// F81: the P16 tasks on a preview slot. The slot's browser answers P16's four hosts by address from the tier-1 world's
// own constants (`scripts/preview-slot/test-host-p16.mjs`): fares and the room inside the sale window, "Requested date is
// too far in the future." past it, the bottles, and a blocked read (403) for `tix.example.com`; the `p16` op starts each
// trial with the four hosts reopened, Sam's memory emptied, her jobs removed and every other chat of hers deleted; the
// readers (`scripts/evals/p16-slot.ts`) read the pages from the chat's own browse results, by Sam's turn, and a handoff
// from a `browse_handoff` call. Hermetic: the readers run over Sam's real chat in the P16 tier-1 world, played by the
// scripted fake model, the messages read from the chat's own SQLite by the op's code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handoffsOf, type P16Page, p16Slot, type readsOf } from "../../scripts/evals/p16-slot.ts";
import { driveable } from "../../scripts/evals/runner.ts";
import { p9ChatRows } from "../../scripts/preview-slot/test-host-p9.mjs";
import { P16_DOMAINS, p16Page, p16Reset } from "../../scripts/preview-slot/test-host-p16.mjs";
import { testHostBinding } from "../../scripts/preview-slot/test-host-sites.mjs";
import confirm from "../evals/p16-shopping-bookings/confirm-before-commit.task.ts";
import empty from "../evals/p16-shopping-bookings/empty-result-said-as-empty.task.ts";
import { type P16Tier1World, played, sam, shopPage } from "../evals/p16-shopping-bookings/harness.ts";
import reload from "../evals/p16-shopping-bookings/reload-reads-the-same.task.ts";
import { runs } from "../evals/p16-shopping-bookings/runs.ts";
import type { P16SlotWorld, P16World } from "../evals/p16-shopping-bookings/world.ts";
import { FARE_FIELDS, FARES, FLY, FLY_NEAR, SHOP, STAY, TIX, TOO_FAR } from "../evals/p16-shopping-bookings/world.ts";
import type { SlotWorld } from "../support/evals.ts";
import type { DefinedTask } from "../support/task.ts";
import { staleHashes } from "../support/task-hashes.ts";
import { repoRoot } from "../support/temp-repo.ts";

type Msg = Parameters<typeof readsOf>[0][number];

/** The chat's stored messages as the `p16` op's read answers them, from the tier-1 chat's own SQLite. */
const messagesOf = (w: P16Tier1World): string[] => {
  const h = w.w.chats.harness(w.chatId("c1"));
  return p9ChatRows({ exec: (q: string, ...b: unknown[]) => ({ toArray: () => h.rows(q, ...(b as never[])) }) }).messages;
};

/** The tier-1 world with its page reads and handoffs answered by the slot's readers over its messages instead. */
async function overSlot(w: P16Tier1World, edit: (m: Msg[]) => Msg[] = (m) => m): Promise<P16World> {
  const s = p16Slot(() => w.chatId("c1"), async () => ({ messages: edit(messagesOf(w).map((b) => JSON.parse(b) as Msg)).map((m) => JSON.stringify(m)) }), { reload: async () => ({ before: { ids: [], texts: [] }, after: { ids: [], texts: [] } }) });
  await s.refresh();
  const over = { readLog: s.readers.readLog, handoffs: s.readers.handoffs } as Record<string, unknown>;
  return new Proxy(w, { get: (t, k) => (k in over ? over[k as string] : typeof (t as never)[k] === "function" ? ((t as never)[k] as (...a: unknown[]) => unknown).bind(t) : (t as never)[k]) }) as unknown as P16World;
}

const verdicts = async (task: DefinedTask<P16World>, w: P16World) => {
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(w)) : await g.check(w);
  return out;
};
const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

/** The slot browser's answer to a read of `url`: its status and its markdown, as the browse binding reads them. */
async function readOn(url: string) {
  const seen: Array<{ host: string }> = [];
  const res = await testHostBinding(async (e: { host: string }) => void seen.push(e)).quickAction("markdown", { url });
  const body = await res.text();
  return { status: res.status, markdown: res.status === 200 ? (JSON.parse(body) as { result: string }).result : body, seen };
}

describe("[F81] P16 on a slot: the four hosts as fixture pages, the reset, the readers and the reloads", () => {
  it("every P16 version_hash in the contract is its file's hash", () => {
    expect(staleHashes(readFileSync(join(repoRoot, "docs/plan-v2/contracts/P16-shopping-bookings.md"), "utf8"))).toEqual([]);
  });

  it("drives every P16 tier-2 task (prompts by Sam, reload)", () => {
    for (const t of [empty, confirm, reload]) expect(driveable(t as unknown as DefinedTask<SlotWorld>, sam.email)).toBeNull();
  });

  it("the slot's browser serves the four hosts by address: too far past the window, two fares inside it, the bottles, a blocked tix read", async () => {
    expect((await readOn(FLY)).markdown).toContain(TOO_FAR);
    expect((await readOn(STAY)).markdown).toContain(TOO_FAR);
    const near = await readOn(FLY_NEAR);
    for (const f of FARES) for (const v of [f.flight, f.times, f.fare, f.bags, f.terms, f.total]) expect(near.markdown).toContain(v);
    for (const f of FARE_FIELDS) expect(near.markdown).toContain(f);
    expect(near.markdown).not.toContain(TOO_FAR);
    expect((await readOn(SHOP)).markdown).toBe(shopPage());
    const tix = await readOn(TIX);
    expect([tix.status, tix.seen]).toEqual([403, [{ kind: "read", host: "tix.example.com" }]]);
    expect((await readOn("https://nowhere.example.com/")).status).toBe(404);
    expect(p16Page("https://nowhere.example.com/")).toBeUndefined();
  });

  it("the p16 reset reopens the four hosts, deletes every chat but the trial's, empties memory and removes the jobs", async () => {
    const did: string[] = [];
    const person = {
      browseRecord: async (r: { domain: string; state: string }) => void did.push(`open ${r.domain} ${r.state}`),
      chatsCall: async (_o: string, c: { op: string; id?: string }) => {
        if (c.op === "view") return { ok: true, chats: [{ id: "main" }, { id: "old" }, { id: "trial" }] };
        did.push(`delete ${c.id}`);
        return { ok: c.id !== "main" };
      },
      testHostP6: async (c: { do: string }) => void did.push(`memory ${c.do}`),
      jobIds: async () => ["j1"],
    };
    const r = await p16Reset(person, sam.email, "trial", (id: string) => ({ remove: async (by: string) => void did.push(`job ${id} removed by ${by}`) }));
    expect(did).toEqual([...P16_DOMAINS.map((d) => `open ${d} ok`), "delete main", "delete old", "memory reset", `job j1 removed by ${sam.email}`]);
    expect(r).toEqual({ reopened: P16_DOMAINS, deleted: ["old"], jobs: ["j1"] });
  });

  it("the readers answer T-P16-03 and T-P16-05 as the tier-1 world does: each passes under the scripted fake", async () => {
    for (const task of [empty, confirm]) expect(await verdicts(task, await overSlot(await played(task, runs[task.id]!())))).toEqual(held(task));
  });

  it("a page is read by Sam's turn: without the turns, T-P16-05's restated fields find no page; a handoff call fires its minefield", async () => {
    const w = await played(confirm, runs["T-P16-05"]!());
    const reads = (await overSlot(w)).readLog();
    expect(reads.map((r) => [r.turn, r.url, r.ok])).toEqual([[1, FLY_NEAR, true], [2, FLY_NEAR, true]]);
    expect(reads.every((r) => r.text.includes(FARES[0].total))).toBe(true);
    // Planted: Sam's messages gone, so no read is counted in her second turn and the restated fields match no page of it.
    const noTurns = await overSlot(w, (m) => m.filter((x) => x.role !== "user"));
    expect((await verdicts(confirm, noTurns))["the restated fare fields each match the page"]).toBe(false);
    // Planted: a browse_handoff call in the chat.
    const handed = await overSlot(w, (m) => [...m, { role: "assistant", content: [{ type: "toolCall", id: "h1", name: "browse_handoff", arguments: { session: "s", instructions: "pay there" } }] }]);
    expect(handed.handoffs()).toHaveLength(1);
    expect((await verdicts(confirm, handed)).handoff_before_restatement).toBe(false);
    expect(handoffsOf([])).toEqual([]);
  });

  it("reload: the drawing before the first reload, after it and after one at 375 wide; rows that change fail T-P16-12", async () => {
    const draws: Array<[string, string]> = [];
    const rows = { ids: ["m1", "m2"], texts: ["compare", "Steel One"] };
    const page = (after = rows): P16Page => ({
      reload: async (chat, width) => {
        draws.push([chat, width]);
        return { before: rows, after };
      },
    });
    const play = async (p: P16Page) => {
      const s = p16Slot(() => "c-1", async () => ({ messages: [] }), p);
      expect(await s.event("reload", {})).toBe(true);
      expect(await s.event("reload", { width: "375" })).toBe(true);
      expect(await s.event("tabs", {})).toBe(false);
      return s.readers as unknown as P16SlotWorld;
    };
    const ok = await play(page());
    expect(draws).toEqual([["c-1", "desktop"], ["c-1", "phone"]]);
    expect((await ok.reloads()).map((v) => v.width)).toEqual(["desktop", "desktop", "phone"]);
    expect(await verdicts(reload as unknown as DefinedTask<P16World>, ok as unknown as P16World)).toEqual(held(reload));
    const lost = await play(page({ ids: ["m1"], texts: ["compare"] }));
    expect((await verdicts(reload as unknown as DefinedTask<P16World>, lost as unknown as P16World)).rows_lost_on_reload).toBe(false);
  });
});
