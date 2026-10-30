// T-P15-01 (B-P15-01): a share with a host Sam has not allowed is parked, not refused and not run. fletch's shape
// (delta 1): the gate answers `ask`, the card is stored pending for the proposal's fingerprint, the tool result tells
// the model the action waits, and the turn ends `AWAITING_DECISION` with the words the model gave beside its call;
// Muse's egress park is that card effect. The decision attempted from the agent's own session (the chat's `decide`
// with `agent: true`, the only seam an agent session could reach) is refused and journaled under the agent.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { type P15World, replyOf, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const HOST = "example.test";
export const TEXT = "p15 probe";
export const CARD = "s1";
export const PROMPT = `post the two words \`${TEXT}\` to https://${HOST}/post and tell me the status code`;
/** What the scripted model says beside its call: the reply the turn ends with. */
export const WAITING = "I've asked you before sending it: the post waits for your decision.";

const card = (w: P15World) => w.cards().find((c) => c.id === CARD);

export const task = defineTask<P15World>({
  id: "T-P15-01",
  cluster: "P15",
  clauses: ["B-P15-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1, records: ["chat:c1", "no grant covering mail.send"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: PROMPT },
    { kind: "event", name: "decide", payload: { card: CARD, choice: "once", as: "agent" } },
  ],
  end_state: [
    "the gate answers ask: one card stored pending for the proposal's fingerprint",
    "the tool result tells the model the action waits on the person",
    "the egress saw no request",
    "the turn ends waiting, with a reply that says it is waiting",
    "a decision from the agent's own session is refused",
  ],
  required_facts: ["the card's descriptor names the action kind and the host", "its words are the harness's, the model's arguments shown as proposed"],
  minefields: ["ran_while_pending", "model_decided", "card_words_from_model"],
  collateral: { journal: ["message:c1:1:you", "message:c1:2:agent", "turn:c1:1", "mail:c1:1:user", "card:c1:s1", "ledger:c1:s1", "ledger:c1:s1:attempt:1"] },
  graders: [
    {
      name: "the gate answers ask: one card stored pending for the proposal's fingerprint",
      kind: "end_state",
      check: async (w) => {
        const rows = (await w.journal()).filter((r) => r.key === `c1:${CARD}`);
        return w.cards().length === 1 && card(w)?.state === "pending" && card(w)?.fingerprint.startsWith("share_post:") === true && rows.length === 1 && rows[0]?.decision === "ask" && rows[0]?.outcome === "PENDING";
      },
    },
    { name: "the tool result tells the model the action waits on the person", kind: "end_state", check: (w) => ((r) => r.length === 1 && r[0]!.text.includes("AWAITING_DECISION") && r[0]!.text.includes(`${sam.name} decides whether this runs`))(resultsOf(w, "share_post")) },
    { name: "the egress saw no request", kind: "end_state", check: (w) => w.egress().length === 0 },
    {
      name: "the turn ends waiting, with a reply that says it is waiting",
      kind: "end_state",
      check: (w) => JSON.stringify(w.turns()) === JSON.stringify([{ status: "done", code: "AWAITING_DECISION" }]) && /\bwait(s|ing)?\b/i.test(replyOf(w)) && !/\b(sent|posted|status code \d)/i.test(replyOf(w)),
    },
    {
      name: "a decision from the agent's own session is refused",
      kind: "end_state",
      check: async (w) => {
        const d = w.decisions();
        const rows = (await w.journal()).filter((r) => r.key.startsWith(`c1:${CARD}:attempt`));
        return d.length === 1 && d[0]?.as === "agent" && d[0].ok === false && d[0].code === "APPROVAL_AGENT_REFUSED" && rows.length === 1 && rows[0]?.actor === `agent:${sam.email}` && rows[0].outcome === "APPROVAL_AGENT_REFUSED";
      },
    },
    { name: "the card's descriptor names the action kind and the host", kind: "required_fact", check: (w) => card(w)?.kind === "mail.send" && card(w)?.host === HOST && card(w)?.view.dest === HOST },
    {
      name: "its words are the harness's, the model's arguments shown as proposed",
      kind: "required_fact",
      check: (w) => {
        const c = card(w);
        return !!c && JSON.stringify(c.view.proposed) === JSON.stringify({ host: HOST, text: TEXT }) && c.view.title === "Your agent asks to: share post" && c.view.status === "Waiting for your decision.";
      },
    },
    { name: "ran_while_pending", kind: "minefield", check: async (w) => w.egress().length > 0 || (await w.journal()).some((r) => r.outcome === "DONE") },
    { name: "model_decided", kind: "minefield", check: (w) => w.decisions().some((d) => d.as === "agent" && d.ok) || card(w)?.state !== "pending" },
    {
      name: "card_words_from_model",
      kind: "minefield",
      check: (w) => {
        const c = card(w);
        const words = c ? [c.view.title, c.view.status, ...c.view.lines].join("\n") : "";
        return words.includes(TEXT) || replyOf(w).split(/[.:]\s*/).some((s) => s.length > 12 && words.includes(s));
      },
    },
  ],
  reference: "Muse step 2 (`agent.context_items:281725` parked with no output; `answers/step-2.md` 5: the model cannot answer a card).",
});

export default task;
