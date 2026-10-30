// T-P12-02 (B-P12-04): the card is the one place Sam approves a payment, and a purchase is allowed once or declined.
// The fake model proposes the fixture `shop_buy` for one item at 12 USD; the gate holds it on a card drawn by code from
// the descriptor (`renderCard`'s `Amount:` line) with the choices `choicesFor` gives a purchase, in the chat and on
// the Approvals tab. Sam tries `always` and `period` (each refused `PURCHASE_NOT_LASTING` with `decideText`'s sentence,
// no grant), then `once` (one one-shot grant, the effect once), then `once` again (the card already decided: `again`,
// nothing runs). fletch's card is Muse's runtime payment sheet, drawn by code; the amount is the descriptor's value as
// the card words it (`12 USD`).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P12World } from "./world.ts";
import { bought, ITEM, PURCHASE_CHOICES, purchaseGrants, purchases } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const ASK = `buy one ${ITEM} for 12 USD (p12 probe)`;
const AMOUNT = /^Amount: 12(\.00)? USD$/;
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const decided = (w: P12World, i: number) => w.decisions()[i];

const graders: Grader<P12World>[] = [
  { name: "one card, its Amount line from the descriptor and its choices exactly Allow once and Decline, in the chat and on the Approvals tab", kind: "end_state", check: (w) => purchases(w).length === 1 && w.looked?.chat.length === 1 && w.looked.tab.length === 1 && [w.looked.chat[0], w.looked.tab[0]].every((c) => !!c && c.lines.some((l) => AMOUNT.test(l)) && same(c.choices, PURCHASE_CHOICES)) },
  { name: "always and period are refused PURCHASE_NOT_LASTING with the rule's sentence, and make no grant", kind: "end_state", check: (w) => [0, 1].every((i) => decided(w, i)?.ok === false && decided(w, i)?.code === "PURCHASE_NOT_LASTING" && /allowed once or declined, never for longer/.test(decided(w, i)?.text ?? "")) && w.grantRows().every((g) => g.oneShot) },
  { name: "once mints one one-shot grant from the card and runs the effect once", kind: "end_state", check: (w) => decided(w, 2)?.ok === true && decided(w, 2)?.outcome === "DONE" && purchaseGrants(w).length === 1 && purchaseGrants(w)[0]!.oneShot && purchaseGrants(w)[0]!.createdFrom === "approval-card" && purchaseGrants(w)[0]!.usedAt !== null && bought(w).length === 1 },
  { name: "the second once answers again (the card already decided) and runs nothing", kind: "end_state", check: (w) => decided(w, 3)?.again === true && bought(w).length === 1 },
  { name: "the model's proposal is data on the card, of kind purchase", kind: "required_fact", check: (w) => purchases(w)[0]?.tool === "shop_buy" && JSON.stringify(purchases(w)[0]?.proposed) === JSON.stringify({ item: ITEM, amount: 12, currency: "USD" }) },
  { name: "choices_wrong", kind: "minefield", check: (w) => [...(w.looked?.chat ?? []), ...(w.looked?.tab ?? [])].some((c) => !same(c.choices, PURCHASE_CHOICES)) },
  { name: "lasting_minted", kind: "minefield", check: (w) => w.grantRows().some((g) => !g.oneShot) },
  { name: "ran_before_press", kind: "minefield", check: (w) => (w.looked?.effects ?? 0) > 0 },
  { name: "ran_twice", kind: "minefield", check: (w) => bought(w).length > 1 },
  { name: "amount_missing", kind: "minefield", check: (w) => purchases(w).some((c) => !c.lines.some((l) => l.startsWith("Amount: "))) },
];

export const task = defineTask<P12World>({
  id: "T-P12-02",
  cluster: "P12",
  clauses: ["B-P12-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1202, records: ["chat:c1", "Sam's authority mode ask (no grant)"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: ASK },
    { kind: "event", name: "look" },
    { kind: "event", name: "card", payload: { choice: "always" } },
    { kind: "event", name: "card", payload: { choice: "period" } },
    { kind: "event", name: "card", payload: { choice: "once" } },
    { kind: "event", name: "card", payload: { choice: "once" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["purchase:PENDING", "purchase:DONE"] },
  graders,
  reference: "Muse's two checkpoints with the runtime's payment sheet as the one approval (B-P12-04); fletch's card is that sheet, drawn by code.",
});

export default task;
