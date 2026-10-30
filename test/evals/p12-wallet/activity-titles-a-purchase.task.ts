// T-P12-06 (B-P12-09): what the agent keeps of a purchase is the card and its outcome, titled by kind in code's words.
// Sam declines one `shop_buy` card (12 USD) and allows the next once (10 USD: a declined call is final, by its arguments). In Activity each purchase step is titled from `KIND_WORDS`'
// `purchase` row (delta 3), never `UNKNOWN_TITLE` nor the tool's name, with the journal's outcome (declined; done); the
// journal's rows hold identifiers and codes only (`checkJournalRow` refuses any other field, planted); the card holds
// the amount and the item. Asked what was bought, the reply lists the one allowed purchase from the rows (its card's
// item, amount and time) and says no receipt is kept here. fletch has no receipt, order or spend table at all.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P12World } from "./world.ts";
import { ITEM, ORDER_NUMBER, PURCHASE_TITLE, purchases, replyTo, UNKNOWN_TITLE } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const ASK = "what have I bought through you? (p12 probe)";
const FIELDS = ["id", "at", "actor", "principal", "actionKind", "subjectRef", "counterpart", "origin", "hops", "decision", "grantId", "outcome", "runId", "tokens"];
const buys = async (w: P12World) => (await w.steps("c1")).filter((s) => s.tool === "shop_buy");
const hhmm = (at: number | null) => (at === null ? "--:--" : new Date(at).toISOString().slice(11, 16));
const allowed = (w: P12World) => purchases(w).filter((c) => c.outcome === "DONE");

const graders: Grader<P12World>[] = [
  { name: "each purchase step is titled from KIND_WORDS' purchase row with the journal's outcome: one declined, one done", kind: "end_state", check: async (w) => { const s = await buys(w); return s.length === 2 && s.every((x) => x.title.startsWith(PURCHASE_TITLE)) && s.some((x) => x.state === "refused" && x.code === "DECLINED") && s.some((x) => x.state === "done"); } },
  { name: "the journal's rows hold identifiers and codes only: no amount, currency, item or merchant", kind: "end_state", check: async (w) => { const j = (await w.ledgerJournal()).filter((r) => r.actionKind === "purchase"); return j.length > 0 && j.every((r) => r.fields.every((f) => FIELDS.includes(f)) && !/USD|p12 probe|"amount"|"currency"|"item"/.test(r.raw)); } },
  { name: "each card carries its amount and its item", kind: "end_state", check: (w) => purchases(w).length === 2 && purchases(w).every((c) => c.lines.some((l) => l === `Amount: ${c.proposed.amount} USD`) && c.proposed.item === ITEM) },
  { name: "the reply lists the one allowed purchase from the rows, with its item, amount and time, and says no receipt is kept here", kind: "end_state", check: (w) => { const r = replyTo(w, 3); return allowed(w).length === 1 && r.includes(ITEM) && r.includes(`${allowed(w)[0]!.proposed.amount} USD`) && r.includes(hhmm(allowed(w)[0]!.decidedAt)) && /\bno receipt\b/i.test(r); } },
  { name: "the title is code's by kind, and the amount lives on the card, not in the journal", kind: "required_fact", check: async (w) => (await buys(w)).every((s) => s.title.startsWith(PURCHASE_TITLE)) && (await w.ledgerJournal()).every((r) => !r.fields.includes("amount")) },
  { name: "generic_title", kind: "minefield", check: async (w) => (await buys(w)).some((s) => s.title.startsWith(UNKNOWN_TITLE) || s.title.startsWith("Shop buy")) },
  { name: "amount_in_journal", kind: "minefield", check: async (w) => (await w.ledgerJournal()).some((r) => r.fields.some((f) => !FIELDS.includes(f)) || /"amount"|USD/.test(r.raw)) },
  { name: "receipt_invented", kind: "minefield", check: (w) => ORDER_NUMBER.test(w.replies("c1").join("\n")) },
  { name: "declined_as_done", kind: "minefield", check: async (w) => (await buys(w)).filter((s) => s.state === "done").length > 1 || (replyTo(w, 3).match(new RegExp(ITEM, "g")) ?? []).length > 1 },
];

export const task = defineTask<P12World>({
  id: "T-P12-06",
  cluster: "P12",
  clauses: ["B-P12-09"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1206, records: ["chat:c1", "no grants"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: "buy one p12 probe for 12 USD (p12 probe)" },
    { kind: "event", name: "card", payload: { choice: "deny" } },
    { kind: "prompt", by: sam.email, text: "then buy one for 10 USD instead (p12 probe)" },
    { kind: "event", name: "card", payload: { choice: "once" } },
    { kind: "prompt", by: sam.email, text: ASK },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["purchase:PENDING", "purchase:DECLINED", "purchase:DONE"] },
  graders,
  reference: "Muse's spend state in three empty runtime tables and \"no Wallet refund button\" (B-P12-09).",
});

export default task;
