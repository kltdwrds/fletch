// T-P15-11 (B-P15-02, B-P15-05, B-P15-14): after the chat object restarts and the page loads again, the waiting card
// is drawn waiting with its choices and the decided ones with their outcome in words and no choices (fletch keeps a
// decided card's words in the thread, delta 5); nothing optimistic is drawn; the Approvals tab agrees. The page draws
// the whole history on load, so "scroll to the top" is that load.
import { defineTask } from "../../support/task.ts";
import { type DrawnCard, type P15PageWorld, SHARE_CHOICES } from "./world.ts";

export const IDS = { approved: "r1", declined: "r2", pending: "r3" } as const;
export const HOSTS = { approved: "a.example.test", declined: "b.example.test", pending: "c.example.test" } as const;
export const STATUS = { approved: "Allowed once; it ran.", declined: "Declined.", pending: "Waiting for your decision." } as const;

const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const drawn = async (w: P15PageWorld): Promise<Map<string, DrawnCard>> => new Map((await w.thread("c1")).map((c) => [c.id, c]));

export const task = defineTask<P15PageWorld>({
  id: "T-P15-11",
  cluster: "P15",
  clauses: ["B-P15-02", "B-P15-05", "B-P15-14"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 11, records: ["chat:c1 with card:r1 approved once, card:r2 declined, card:r3 pending, among messages"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "reload" },
    { kind: "event", name: "render", payload: { chat: "c1" } },
  ],
  end_state: ["the waiting card is drawn again as waiting, with its choices", "the decided cards are drawn with their outcome in words and no choices", "nothing optimistic is drawn", "the Approvals tab agrees with the thread"],
  required_facts: [],
  minefields: ["pending_lost", "decided_redrawn_pending", "choices_on_decided"],
  collateral: {},
  graders: [
    { name: "the waiting card is drawn again as waiting, with its choices", kind: "end_state", check: async (w) => ((c) => c?.status === STATUS.pending && sameSet(c.choices, SHARE_CHOICES))((await drawn(w)).get(IDS.pending)) },
    {
      name: "the decided cards are drawn with their outcome in words and no choices",
      kind: "end_state",
      check: async (w) => {
        const d = await drawn(w);
        return d.get(IDS.approved)?.status === STATUS.approved && d.get(IDS.declined)?.status === STATUS.declined && d.get(IDS.approved)?.choices.length === 0 && d.get(IDS.declined)?.choices.length === 0 && d.size === 3;
      },
    },
    { name: "nothing optimistic is drawn", kind: "end_state", check: async (w) => !/Deciding…|Being decided now|Stopping|is working/i.test(await w.threadText("c1")) },
    {
      name: "the Approvals tab agrees with the thread",
      kind: "end_state",
      check: async (w) => {
        const a = await w.approvals();
        const d = await drawn(w);
        return a.waiting.map((c) => c.id).join() === IDS.pending && a.waiting[0]?.status === d.get(IDS.pending)?.status && [IDS.approved, IDS.declined].every((id) => a.history.find((h) => h.id === id)?.text.includes(d.get(id)?.status ?? "\u0000"));
      },
    },
    { name: "pending_lost", kind: "minefield", check: async (w) => (await drawn(w)).get(IDS.pending)?.status !== STATUS.pending },
    { name: "decided_redrawn_pending", kind: "minefield", check: async (w) => ((d) => [IDS.approved, IDS.declined].some((id) => d.get(id)?.status === STATUS.pending))(await drawn(w)) },
    { name: "choices_on_decided", kind: "minefield", check: async (w) => ((d) => [IDS.approved, IDS.declined].some((id) => (d.get(id)?.choices.length ?? 0) > 0))(await drawn(w)) },
  ],
  reference: "Muse steps 2 and 12 (`step-2-reload.png`: the pending card survives; `step-12-chatB.png`: nothing of a resolved card remains, the history alone); fletch keeps the decided card's words in the thread (delta 5).",
});

export default task;
