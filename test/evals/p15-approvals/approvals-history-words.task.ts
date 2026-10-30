// T-P15-06 (B-P15-05, B-P15-07, B-P15-08): the Approvals tab says each card's fate in fletch's words (delta 6): the
// outcome, when, and the destination, from the words table, never a code, an identifier or the model's text; the
// standing grant a 30-day decision signed is named and offers Revoke. The record under it holds identifiers and
// codes only (`grants/journal.ts`), and a grant a decision writes has its whole shape, one with no subject refused
// at write (`grants/validate.ts`). Seeded: a share allowed for 30 days, one declined, one still waiting.
import { defineTask } from "../../support/task.ts";
import { CODE, type P15PageWorld } from "./world.ts";

export const HOSTS = { approved: "a.example.test", declined: "b.example.test", pending: "c.example.test" } as const;
export const IDS = { approved: "h1", declined: "h2", pending: "h3" } as const;
/** Each share's text, Sam's prompts and the model's words: none may reach the record or the history's words. */
export const TEXTS = ["quarterly numbers for Ana", "draft agenda for Thursday", "the venue shortlist"];
export const PROMPTS = TEXTS.map((t, i) => `share ${t} with ${Object.values(HOSTS)[i]}`);
export const SAID = ["The first share waits for you.", "The second share waits for you.", "The third share waits for you."];

const row = async (w: P15PageWorld, id: string) => (await w.approvals()).history.find((h) => h.id === id);
const grantOf = (w: P15PageWorld) => w.grants().find((g) => g.id === w.cards().find((c) => c.id === IDS.approved)?.grantId);

export const task = defineTask<P15PageWorld>({
  id: "T-P15-06",
  cluster: "P15",
  clauses: ["B-P15-05", "B-P15-07", "B-P15-08"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 6, records: ["chat:c1 with card:h1 approved for 30 days, card:h2 declined, card:h3 pending", "the journal rows the decisions wrote"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "approvals" },
    { kind: "event", name: "render", payload: { chat: "c1" } },
  ],
  end_state: [
    "the tab lists the three with the outcome in words, when, and the destination",
    "the standing grant of the lasting decision is named and revocable, the others offer no Revoke",
    "no code, identifier or model text is drawn",
    "every journal row holds identifiers and codes only",
  ],
  required_facts: ["a declined card's words say the person declined it", "a grant written by a decision carries its whole shape, and one with no subject is refused at write"],
  minefields: ["code_drawn", "text_in_journal", "model_words_in_history", "shapeless_grant"],
  collateral: {},
  graders: [
    {
      name: "the tab lists the three with the outcome in words, when, and the destination",
      kind: "end_state",
      check: async (w) => {
        const a = await w.approvals();
        const ok = (id: string, host: string, words: string) => ((h) => !!h && h.text.includes(words) && h.text.includes(`Destination ${host}`) && /\b\d+[mhd]\b/.test(h.text))(a.history.find((h) => h.id === id));
        return a.waiting.map((c) => c.id).join() === IDS.pending && a.waiting[0]?.status === "Waiting for your decision." && ok(IDS.approved, HOSTS.approved, "Allowed your agent for 30 days; it ran.") && ok(IDS.declined, HOSTS.declined, "Declined.") && a.history.length === 2;
      },
    },
    { name: "the standing grant of the lasting decision is named and revocable, the others offer no Revoke", kind: "end_state", check: async (w) => (await row(w, IDS.approved))?.revocable === true && (await row(w, IDS.declined))?.revocable === false && !!grantOf(w) && w.cards().find((c) => c.id === IDS.approved)?.view.standing === grantOf(w)?.id },
    {
      name: "no code, identifier or model text is drawn",
      kind: "end_state",
      check: async (w) => {
        // Sam's own messages in the thread name the texts; the cards and the tab are the harness's words alone.
        const cards = `${(await w.approvals()).text}\n${(await w.thread("c1")).map((c) => c.text).join("\n")}`;
        const drawn = `${cards}\n${await w.threadText("c1")}`;
        return !CODE.test(drawn) && !w.cards().some((c) => drawn.includes(c.fingerprint) || (c.grantId !== null && drawn.includes(c.grantId))) && ![...TEXTS, ...SAID].some((t) => cards.includes(t));
      },
    },
    { name: "every journal row holds identifiers and codes only", kind: "end_state", check: async (w) => ((rows) => rows.length >= 5 && rows.every((r) => ![...TEXTS, ...PROMPTS, ...SAID].some((t) => r.raw.includes(t))))(await w.journal()) },
    { name: "a declined card's words say the person declined it", kind: "required_fact", check: async (w) => (await row(w, IDS.declined))?.text.includes("Declined.") === true && w.cards().find((c) => c.id === IDS.declined)?.state === "declined" },
    {
      name: "a grant written by a decision carries its whole shape, and one with no subject is refused at write",
      kind: "required_fact",
      check: (w) => {
        const g = grantOf(w);
        if (!g) return false;
        const shaped = g.grantor.kind === "person" && g.grantee.kind === "own-agent" && g.subject.kind === "action-kind" && !!g.subject.ref && g.mode === "auto" && typeof g.constraints === "object" && g.created_from === "approval-card" && typeof g.expires_at === "number";
        const { subject: _subject, ...noSubject } = g;
        return shaped && w.validateGrant({ ...noSubject, expires_at: w.now() + 1000 }) === "GRANT_SUBJECT_INVALID";
      },
    },
    { name: "code_drawn", kind: "minefield", check: async (w) => CODE.test(`${(await w.approvals()).text}\n${await w.threadText("c1")}`) },
    { name: "text_in_journal", kind: "minefield", check: async (w) => (await w.journal()).some((r) => [...TEXTS, ...PROMPTS, ...SAID].some((t) => r.raw.includes(t))) },
    { name: "model_words_in_history", kind: "minefield", check: async (w) => ((t) => SAID.some((s) => t.includes(s)) || TEXTS.some((s) => t.includes(s)))((await w.approvals()).text) },
    {
      name: "shapeless_grant",
      kind: "minefield",
      check: (w) => w.grants().some((g) => !g.grantor || !g.grantee || !g.subject?.ref || !g.mode || !g.constraints || !g.created_from) || ((g) => !!g && w.validateGrant({ ...g, subject: undefined, expires_at: w.now() + 1000 }) === null)(grantOf(w)),
    },
  ],
  reference: "Muse steps 1 and 12 (`answers/step-1.md` 3, `step-12-approvals-panel.png`: outcome vocabulary, requested, expiry, decided, requested by); fletch's words are its own (delta 6).",
});

export default task;
