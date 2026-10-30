// F26: the tier-2 runner drives a decision on a card (`SLOT_EVENTS`), in turn order with the prompts, and the slot's
// test host readers (`testHostReaders`, `scripts/evals/test-host.ts`) give a P15 grader the chat's cards from its history,
// the test host's requests and egress, and the Vault's audit and grants counted from the trial's start. Hermetic: the
// slot is scripted; the readers run over a scripted history and test-host state.
import { describe, expect, it } from "vitest";
import { driveable, trial } from "../../scripts/evals/runner.ts";
import { type TestHostState, testHostReaders } from "../../scripts/evals/test-host.ts";
import { EMPTY_SNAPSHOT, type SlotEntry, type SlotWorld } from "../support/evals.ts";
import people from "../fixtures/people.json" with { type: "json" };
import { defineTask } from "../support/task.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

const decideTask = defineTask<SlotWorld>({
  id: "T-P0-21",
  cluster: "P0",
  clauses: ["B-P0-21"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 21, records: [], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: "post it" },
    { kind: "event", name: "decide", payload: { card: "first", choice: "deny" } },
    { kind: "prompt", by: sam.email, text: "and now?" },
  ],
  end_state: ["the turns ran in order"],
  required_facts: [],
  minefields: [],
  collateral: {},
  graders: [{ name: "the turns ran in order", kind: "end_state", check: (w) => w.replies.join(",") === "post it,decide first deny,and now?" }],
  reference: "F26's runner events.",
});

describe("[F26] the tier-2 runner drives a decision, and the test host's readers", () => {
  it("drives a decide event between prompts through the world, and still refuses any other event", async () => {
    expect(driveable(decideTask, sam.email)).toBeNull();
    const replies: string[] = [];
    const world: SlotWorld = {
      chatId: "chat-1",
      replies,
      snapshot: () => EMPTY_SNAPSHOT,
      entries: () => [],
      reactions: () => [],
      send: async (t) => (replies.push(t), t),
      read: async () => ({ status: 200, body: {} }),
      event: async (name, p) => void replies.push(`${name} ${p.card} ${p.choice}`),
    };
    const t = await trial(decideTask, { name: "fletch-pv-9", open: async () => world }, 1, () => new Date(0));
    expect(t.status).toBe("pass");
    const other = defineTask<SlotWorld>({ ...decideTask, turns: [{ kind: "event", name: "clock", payload: { ms: "1" } }] });
    expect(driveable(other, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 1 of T-P0-21 is the event clock; the runner drives prompts and decide, tick, reload, open, prompt events only");
  });

  it("reads cards from the history, requests and egress from the test host, and the Vault's rows from the trial's start", async () => {
    const entries: SlotEntry[] = [
      { kind: "you", text: "post it" },
      { kind: "card", card: { id: "s1", state: "declined", title: "t", proposed: { host: "httpbin.test", text: "p15 probe" }, dest: "httpbin.test", status: "Declined." } },
      { kind: "agent", text: "You declined it." },
    ];
    const state: TestHostState = {
      log: { reads: [{ host: "walled.test" }, { host: "fine.test" }, { host: "walled.test" }], egress: [{ host: "httpbin.test", text: "p15 probe" }] },
      audit: [{ ref: "cred://old" }, { ref: "cred://new" }],
      grants: [{ nonce: "n-old", hosts: ["a"], oneShot: true, usedAt: null }, { nonce: "n-new", hosts: ["b"], oneShot: false, usedAt: 5 }],
      sinks: { journal: "[]" },
    };
    const r = testHostReaders(() => entries, () => state, { audit: [JSON.stringify({ ref: "cred://old" })], grants: ["n-old"] });
    expect(r.cards()).toEqual([{ id: "s1", state: "declined", host: "httpbin.test" }]);
    expect([r.requestsTo("walled.test"), r.requestsTo("fine.test"), r.requestsTo("busy.test")]).toEqual([2, 1, 0]);
    expect(r.egress()).toEqual([{ host: "httpbin.test", text: "p15 probe" }]);
    expect([r.opened(), r.typed()]).toEqual([[], []]);
    expect(r.audit()).toEqual([{ ref: "cred://new" }]);
    expect(r.vaultGrants()).toEqual([{ nonce: "n-new", hosts: ["b"], oneShot: false, usedAt: 5 }]);
    expect(await r.sinks()).toEqual({ journal: "[]" });
  });

  it("a slot with no test host answers every reader with SLOT_NO_TEST_HOST, never an empty world", () => {
    const r = testHostReaders(() => [], () => null, { audit: [], grants: [] });
    for (const read of [() => r.egress(), () => r.requestsTo("x"), () => r.opened(), () => r.typed(), () => r.audit(), () => r.vaultGrants()]) expect(read).toThrow(/^SLOT_NO_TEST_HOST/);
    expect(r.cards()).toEqual([]);
  });
});
