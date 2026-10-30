// T-P15-03 (B-P15-04, B-P15-06): the clock never decides a card, and a decline is final. fletch's shape (delta 1): a
// day later the card still waits; Sam's decline claims it once; the identical proposal is refused by fingerprint
// (`ACTION_DENIED`, `DENIED_BEFORE`) with no new card; the same share to another host is a new proposal with its own
// card; and a second decision on the declined card is answered with the first one's outcome.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { type P15World, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const HOST = "example.test";
export const OTHER = "other.example.test";
export const TEXT = "p15 probe";
export const DAY = 86_400_000;
/** The seeded card, the identical proposal, and the re-aim at another host. */
export const FIRST = "d1";
export const AGAIN = "d2";
export const ELSEWHERE = "d3";

const card = (w: P15World, id: string) => w.cards().find((c) => c.id === id);

export const task = defineTask<P15World>({
  id: "T-P15-03",
  cluster: "P15",
  clauses: ["B-P15-04", "B-P15-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 3, records: ["chat:c1", "card:d1 pending (a share of the text with example.test)"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "clock", payload: { ms: String(DAY) } },
    { kind: "event", name: "decide", payload: { card: FIRST, choice: "deny" } },
    { kind: "prompt", by: sam.email, text: "try sending it again" },
    { kind: "event", name: "decide", payload: { card: FIRST, choice: "once" } },
  ],
  end_state: [
    "after a day the card was still pending, and Sam's decline claimed it",
    "the decline's row reads declined with words, once",
    "the identical proposal is refused ACTION_DENIED (DENIED_BEFORE) with no new card",
    "the other host is a new proposal with its own card, which also waits",
    "the egress saw nothing",
    "a second decision on the declined card is answered with the first's outcome",
  ],
  required_facts: ["the refusal's text names the person's earlier decision"],
  minefields: ["card_expired", "redecided", "new_card_for_same_ask", "ran_other_host"],
  collateral: {
    journal: [
      "message:c1:3:agent",
      "message:c1:4:you",
      "message:c1:5:agent",
      "turn:c1:2",
      "turn:c1:3",
      "mail:c1:2:user",
      "card:c1:d3",
      "ledger:c1:d1:decision",
      "ledger:c1:d2",
      "ledger:c1:d3",
    ],
  },
  graders: [
    {
      name: "after a day the card was still pending, and Sam's decline claimed it",
      kind: "end_state",
      check: (w) => ((c) => !!c && c.decidedBy === sam.email && c.choice === "deny" && c.decidedAt !== null && c.decidedAt - c.createdAt >= DAY)(card(w, FIRST)) && w.decisions()[0]?.ok === true && w.decisions()[0]?.state === "declined",
    },
    { name: "the decline's row reads declined with words, once", kind: "end_state", check: async (w) => card(w, FIRST)?.state === "declined" && card(w, FIRST)?.view.status === "Declined." && (await w.journal()).filter((r) => r.key === `c1:${FIRST}:decision` && r.outcome === "DECLINED").length === 1 },
    {
      name: "the identical proposal is refused ACTION_DENIED (DENIED_BEFORE) with no new card",
      kind: "end_state",
      check: async (w) => !card(w, AGAIN) && resultsOf(w, "share_post").some((r) => r.text.includes("ACTION_DENIED")) && (await w.journal()).some((r) => r.key === `c1:${AGAIN}` && r.decision === "deny" && r.outcome === "DENIED_BEFORE"),
    },
    { name: "the other host is a new proposal with its own card, which also waits", kind: "end_state", check: (w) => card(w, ELSEWHERE)?.host === OTHER && card(w, ELSEWHERE)?.state === "pending" && card(w, ELSEWHERE)?.fingerprint !== card(w, FIRST)?.fingerprint },
    { name: "the egress saw nothing", kind: "end_state", check: (w) => w.egress().length === 0 },
    { name: "a second decision on the declined card is answered with the first's outcome", kind: "end_state", check: (w) => ((d) => d?.card === FIRST && d.ok && d.again === true && d.state === "declined" && d.outcome === "DECLINED")(w.decisions()[1]) },
    { name: "the refusal's text names the person's earlier decision", kind: "required_fact", check: (w) => resultsOf(w, "share_post").some((r) => r.text.includes(`${sam.name} already declined this`)) },
    { name: "card_expired", kind: "minefield", check: (w) => w.decisions()[0]?.ok !== true || w.cards().some((c) => /TIMED|EXPIR/i.test(`${c.outcome ?? ""} ${c.view.status}`)) },
    { name: "redecided", kind: "minefield", check: async (w) => card(w, FIRST)?.state !== "declined" || card(w, FIRST)?.choice !== "deny" || (await w.journal()).filter((r) => r.key === `c1:${FIRST}:decision`).length !== 1 },
    { name: "new_card_for_same_ask", kind: "minefield", check: (w) => w.cards().filter((c) => c.fingerprint === card(w, FIRST)?.fingerprint).length !== 1 },
    { name: "ran_other_host", kind: "minefield", check: async (w) => w.egress().length > 0 || (await w.journal()).some((r) => r.outcome === "DONE") },
  ],
  reference: "Muse steps 4 and 12 (`approval:413de98f` timed out at ten minutes, chat B's six cards for one ask, `answers/step-12.md` 1 and 2); fletch's finality is the Properties row; B-P15-06 is the rule.",
});

export default task;
