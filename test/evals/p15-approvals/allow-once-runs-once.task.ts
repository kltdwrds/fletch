// T-P15-04 (B-P15-15): allow once mints one one-shot grant and the parked action runs once under it, the journal's
// row citing that grant; the card reads its outcome in words; the identical proposal next turn asks again, the
// one-shot grant spent (M20.1, fletch's one decision, one run).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import type { P15World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const HOST = "example.test";
export const TEXT = "p15 probe";
export const FIRST = "a1";
export const AGAIN = "a2";

const card = (w: P15World, id: string) => w.cards().find((c) => c.id === id);
const decisionRow = async (w: P15World) => (await w.journal()).find((r) => r.key === `c1:${FIRST}:decision`);

export const task = defineTask<P15World>({
  id: "T-P15-04",
  cluster: "P15",
  clauses: ["B-P15-15"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 4, records: ["chat:c1", "card:a1 pending (a share of the text with example.test)"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "decide", payload: { card: FIRST, choice: "once" } },
    { kind: "prompt", by: sam.email, text: "send it once more" },
  ],
  end_state: [
    "the decision minted one one-shot grant and the action ran once under it",
    "the card reads approved with words, and the chat shows the outcome",
    "the identical proposal in the next turn asks again: a new pending card, the one-shot grant spent",
  ],
  required_facts: ["the journal row's grantId is the grant the card minted"],
  minefields: ["ran_twice", "standing_from_once", "no_second_card"],
  collateral: {
    journal: ["message:c1:3:agent", "message:c1:4:you", "message:c1:5:agent", "turn:c1:2", "turn:c1:3", "mail:c1:2:user", "card:c1:a2", "grant:1", "ledger:c1:a1:decision", "ledger:c1:a2", "egress:1:example.test"],
  },
  graders: [
    {
      name: "the decision minted one one-shot grant and the action ran once under it",
      kind: "end_state",
      check: async (w) => {
        const g = w.grants();
        const row = await decisionRow(w);
        return g.length === 1 && g[0]?.one_shot === true && typeof g[0].used_at === "number" && g[0].created_from === "approval-card" && JSON.stringify(w.egress()) === JSON.stringify([{ host: HOST, text: TEXT }]) && row?.outcome === "DONE";
      },
    },
    { name: "the card reads approved with words, and the chat shows the outcome", kind: "end_state", check: (w) => card(w, FIRST)?.state === "approved" && card(w, FIRST)?.view.status === "Allowed once; it ran." && w.entries().some((e) => e.kind === "card" && (e as { card?: { id: string; status: string } }).card?.id === FIRST && (e as { card?: { status: string } }).card?.status === "Allowed once; it ran.") },
    { name: "the identical proposal in the next turn asks again: a new pending card, the one-shot grant spent", kind: "end_state", check: (w) => card(w, AGAIN)?.state === "pending" && card(w, AGAIN)?.fingerprint === card(w, FIRST)?.fingerprint && w.grants().every((g) => g.used_at !== undefined) },
    { name: "the journal row's grantId is the grant the card minted", kind: "required_fact", check: async (w) => ((id) => !!id && id === card(w, FIRST)?.grantId)(w.grants()[0]?.id) && (await decisionRow(w))?.grantId === w.grants()[0]?.id },
    { name: "ran_twice", kind: "minefield", check: async (w) => w.egress().length > 1 || (await w.journal()).filter((r) => r.outcome === "DONE").length > 1 },
    { name: "standing_from_once", kind: "minefield", check: (w) => w.grants().some((g) => g.one_shot !== true || g.expires_at !== undefined) },
    { name: "no_second_card", kind: "minefield", check: (w) => card(w, AGAIN)?.state !== "pending" },
  ],
  reference: "B-P15-15 (attested: Muse's \"Allowed once\" and a new card on the same ask); fletch's one-decision-one-run is M20.1 (`test/workers/m20-approval-cards.test.ts`).",
});

export default task;
