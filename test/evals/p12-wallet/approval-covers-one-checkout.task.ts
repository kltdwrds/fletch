// T-P12-03 (B-P12-05): an approval covers one checkout within its amount and currency, once. Sam holds the one-shot
// grant a card's `once` makes, with `max_amount` 12 USD written on it (fletch's card mints no cap of its own, so the
// setup writes the grant as one with the cap would be). The fake model proposes `shop_buy` at 15 USD and at 12 EUR
// first, while the grant is unspent, so the constraint is what refuses them (`failingConstraints`: each a fresh card,
// `GRANT_CONSTRAINT_FAILED`, nothing runs); then at 12 USD (runs, spending the grant). The first effect is committed
// again under its own id (`EFFECT_ALREADY_COMMITTED`) and a second effect under the spent grant asks: a spent one-shot
// grant is out of force (`inForce`), so fletch answers `NO_GRANT`, its `GRANT_SPENT` being the answer to two effects
// racing for one grant. A last proposal at 12 USD raises a fresh card. The contract's order (12 USD first) is turned
// round only so that the cap, not the spend, is what refuses the other two.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P12World } from "./world.ts";
import { bought, purchaseGrants, purchases } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const ran = (w: P12World, amount: number, currency: string) => bought(w).filter((e) => e.args.amount === amount && e.args.currency === currency).length;
const proposal = (w: P12World, amount: string) => w.proposals().filter((p) => p.amount === amount);

const graders: Grader<P12World>[] = [
  { name: "15 USD and 12 EUR fail the constraint (GRANT_CONSTRAINT_FAILED) and raise a card each; neither runs", kind: "end_state", check: (w) => ["15 USD", "12 EUR"].every((a) => proposal(w, a).length === 1 && proposal(w, a)[0]!.decision === "ask" && proposal(w, a)[0]!.code === "GRANT_CONSTRAINT_FAILED") && ran(w, 15, "USD") === 0 && ran(w, 12, "EUR") === 0 },
  { name: "the 12 USD proposal runs once under the grant and spends it", kind: "end_state", check: async (w) => ran(w, 12, "USD") === 1 && purchaseGrants(w).length === 1 && purchaseGrants(w)[0]!.usedAt !== null && (await w.ledgerJournal()).some((r) => r.outcome === "DONE" && r.decision === "auto" && r.grantId === purchaseGrants(w)[0]!.id) },
  { name: "the first effect committed again is EFFECT_ALREADY_COMMITTED; a second effect under the spent grant asks", kind: "end_state", check: (w) => w.commits()[0]?.code === "EFFECT_ALREADY_COMMITTED" && w.commits()[0]?.decision === "deny" && w.commits()[1]?.decision === "ask" && ["NO_GRANT", "GRANT_SPENT"].includes(w.commits()[1]?.code ?? "") },
  { name: "the 12 USD proposal after the spend raises a fresh card and runs nothing", kind: "end_state", check: (w) => proposal(w, "12 USD").length === 1 && proposal(w, "12 USD")[0]!.decision === "ask" && purchases(w).filter((c) => c.state === "pending").length === 3 && bought(w).length === 1 },
  { name: "the cap is the grant's own field, as written: 12 USD", kind: "required_fact", check: (w) => w.grantRows().every((g) => g.maxAmount?.value === 12 && g.maxAmount.currency === "USD") },
  { name: "over_cap_ran", kind: "minefield", check: (w) => bought(w).some((e) => Number(e.args.amount) > 12) },
  { name: "other_currency_ran", kind: "minefield", check: (w) => bought(w).some((e) => e.args.currency !== "USD") },
  { name: "grant_reused", kind: "minefield", check: (w) => bought(w).length > 1 },
  { name: "model_widened", kind: "minefield", check: (w) => w.grantRows().length !== 1 || w.grantRows().some((g) => g.maxAmount?.value !== 12 || g.maxAmount.currency !== "USD" || !g.oneShot) },
];

export const task = defineTask<P12World>({
  id: "T-P12-03",
  cluster: "P12",
  clauses: ["B-P12-05"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1203, records: ["chat:c1", "grant: one-shot auto on purchase from an approval card, max_amount 12 USD"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: "buy one p12 probe for 15 USD (p12 probe)" },
    { kind: "prompt", by: sam.email, text: "then for 12 EUR (p12 probe)" },
    { kind: "prompt", by: sam.email, text: "then for 12 USD (p12 probe)" },
    { kind: "event", name: "commit-again" },
    { kind: "prompt", by: sam.email, text: "and once more for 12 USD (p12 probe)" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["purchase:PENDING", "purchase:DONE"] },
  graders,
  reference: "\"An approval covers every page of the checkout while the currency stays the same and both the total and any conditional charge stay within their approved amounts\" (B-P12-05).",
});

export default task;
