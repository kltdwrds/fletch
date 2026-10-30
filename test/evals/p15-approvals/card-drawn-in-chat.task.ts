// T-P15-02 (B-P15-02, B-P15-03): the card is drawn in the chat it came from and nowhere else, with the harness's
// words, the destination named and the choices the matrix gives its kind; the Approvals tab lists it waiting with the
// same words. fletch's shapes: no cross-chat review bar (delta 7), the choices are fletch's own (delta 6), and the
// composer is not paused because the turn has ended (delta 1). The arguments the model proposed travel as the card's
// data (`proposed`); the card and the Approvals tab draw none of them as words (Sam's own message, which names them,
// is hers).
import { defineTask } from "../../support/task.ts";
import { CODE, type DrawnCard, type P15PageWorld, PURCHASE_CHOICES, SHARE_CHOICES } from "./world.ts";

export const HOST = "example.test";
export const TEXT = "p15 probe";
export const CARD = "s1";

const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const drawnIn = async (w: P15PageWorld, chat: "c1" | "c2", id: string): Promise<DrawnCard | undefined> => (await w.thread(chat)).find((c) => c.id === id);

export const task = defineTask<P15PageWorld>({
  id: "T-P15-02",
  cluster: "P15",
  clauses: ["B-P15-02", "B-P15-03"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 2, records: ["chat:c1 with Sam's m1 and card:s1 pending (a share with example.test)", "chat:c2 with no card"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "render", payload: { chat: "c1" } },
    { kind: "event", name: "render", payload: { chat: "c2" } },
    { kind: "event", name: "approvals" },
  ],
  end_state: [
    "c1 draws the card with the harness's question naming the destination, waiting, with the matrix's choices",
    "the proposed arguments are the card's data and are not drawn as words",
    "c2 draws no card and no review bar",
    "the Approvals tab lists the card waiting with the same words",
  ],
  required_facts: ["no code or identifier is drawn as words"],
  minefields: ["code_drawn", "card_in_other_chat", "choices_wrong"],
  collateral: {},
  graders: [
    {
      name: "c1 draws the card with the harness's question naming the destination, waiting, with the matrix's choices",
      kind: "end_state",
      check: async (w) => {
        const d = await drawnIn(w, "c1", CARD);
        const c = w.cards().find((x) => x.id === CARD);
        return !!d && !!c && (await w.thread("c1")).length === 1 && d.title === c.view.title && d.text.includes(HOST) && d.status === "Waiting for your decision." && sameSet(d.choices, SHARE_CHOICES);
      },
    },
    { name: "the proposed arguments are the card's data and are not drawn as words", kind: "end_state", check: async (w) => JSON.stringify(w.cards()[0]?.view.proposed) === JSON.stringify({ host: HOST, text: TEXT }) && !(await drawnIn(w, "c1", CARD))?.text.includes(TEXT) && !(await w.approvals()).text.includes(TEXT) },
    { name: "c2 draws no card and no review bar", kind: "end_state", check: async (w) => (await w.thread("c2")).length === 0 && !/\b(needs? review|waiting for your decision|approval)/i.test(await w.threadText("c2")) },
    {
      name: "the Approvals tab lists the card waiting with the same words",
      kind: "end_state",
      check: async (w) => {
        const a = await w.approvals();
        const d = await drawnIn(w, "c1", CARD);
        return a.waiting.length === 1 && a.waiting[0]?.id === CARD && a.waiting[0].title === d?.title && a.waiting[0].status === d.status && sameSet(a.waiting[0].choices, d.choices);
      },
    },
    {
      name: "no code or identifier is drawn as words",
      kind: "required_fact",
      check: async (w) => {
        const drawn = `${await w.threadText("c1")}\n${(await w.approvals()).text}`;
        const c = w.cards()[0];
        return !CODE.test(drawn) && !!c && !drawn.includes(c.fingerprint) && !drawn.includes(c.kind) && !drawn.includes("share_post");
      },
    },
    { name: "code_drawn", kind: "minefield", check: async (w) => CODE.test(`${await w.threadText("c1")}\n${await w.threadText("c2")}\n${(await w.approvals()).text}`) },
    { name: "card_in_other_chat", kind: "minefield", check: async (w) => (await w.thread("c2")).length > 0 },
    {
      name: "choices_wrong",
      kind: "minefield",
      check: async (w) => {
        const kinds = new Map(w.cards().map((c) => [c.id, c.kind]));
        const drawn = [...(await w.thread("c1")), ...(await w.approvals()).waiting];
        return drawn.some((d) => d.choices.length > 0 && !sameSet(d.choices, kinds.get(d.id) === "purchase" ? PURCHASE_CHOICES : SHARE_CHOICES));
      },
    },
  ],
  reference: "Muse steps 2 and 3 (`step-2-dom.md`, `step-3-dom.md`, `step-2-approvals-panel.png`); the choices are fletch's own (delta 6).",
});

export default task;
