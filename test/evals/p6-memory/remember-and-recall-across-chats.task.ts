// T-P6-09 (B-P6-02, B-P6-03, B-P6-06, B-P6-13): tier 2, the real model remembers in c1, c2 recalls with a citation that
// resolves, and after the correction in c1 the same question in c2 gives the newest value. Graded as T-P6-01, T-P6-02
// and T-P6-05 grade the scripted runs. "The reply" to a prompt is its answer: the last words the agent wrote in that turn
// with no tool call beside them, never a line written beside a tool call ("I'll search my memory for Pat Solo."), which
// the first graders took for the reply until F44's oracle correction (the slot's replies are pinned in
// `remember-and-recall-across-chats.test.ts`).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { citationsIn, type P6World, PAT_FACT, resolves, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const REMEMBER = "remember that Pat Solo prefers plain text over PDFs";
export const ASK = "what do you know about Pat Solo?";
export const CORRECT = "actually Pat Solo prefers Markdown, not plain text";

const replies = (w: P6World, chat: "c1" | "c2") => w.entries(chat).filter((e) => e.kind === "agent").map((e) => e.text ?? "");
const firstWrite = (w: P6World) => resultsOf(w, "memory_write")[0]?.seq ?? Number.POSITIVE_INFINITY;
/** Each prompt's answer in `chat`, in order: its last assistant row with words and no tool call ("" when it has none). */
export function answers(w: P6World, chat: "c1" | "c2"): Array<{ seq: number; text: string }> {
  const out: Array<{ seq: number; text: string }> = [];
  for (const r of w.rows(chat)) {
    if (r.role === "user") out.push({ seq: r.seq, text: "" });
    else if (r.role === "assistant" && r.text.trim() && r.calls.length === 0 && out.length) out[out.length - 1] = { seq: r.seq, text: r.text };
  }
  return out;
}

export const task = defineTask<P6World>({
  id: "T-P6-09",
  cluster: "P6",
  // No clause names it (the contract's reference does): it repeats tier-1 tasks with the real model.
  clauses: [],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 9, records: ["chat:c1", "chat:c2 (fresh)"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: REMEMBER, chat: "c1" },
    { kind: "prompt", by: sam.email, text: ASK, chat: "c2" },
    { kind: "prompt", by: sam.email, text: CORRECT, chat: "c1" },
    { kind: "prompt", by: sam.email, text: ASK, chat: "c2" },
  ],
  end_state: ["one line holds the fact, and c1's first reply cites it after the write", "c2's first recall cites a line that resolves to the fact", "c2's second recall gives Markdown"],
  required_facts: ["every citation in c2's replies resolves"],
  minefields: ["uncited_claim", "transcript_read", "old_value_recalled"],
  collateral: {},
  graders: [
    {
      name: "one line holds the fact, and c1's first reply cites it after the write",
      kind: "end_state",
      check: (w) => {
        const line = w.lines().filter((l) => l.text.includes("plain text over PDFs") && !/Markdown/.test(l.text));
        const reply = answers(w, "c1")[0];
        return line.length === 1 && !!reply && reply.seq > firstWrite(w) && citationsIn(reply.text).includes(line[0]!.citation);
      },
    },
    { name: "c2's first recall cites a line that resolves to the fact", kind: "end_state", check: async (w) => ((t) => citationsIn(t).length > 0 && t.includes("plain text"))(answers(w, "c2")[0]?.text ?? "") && (await Promise.all(citationsIn(answers(w, "c2")[0]?.text ?? "").map((c) => resolves(w, c, "Pat Solo")))).some(Boolean) },
    { name: "c2's second recall gives Markdown", kind: "end_state", check: (w) => /\bMarkdown\b/.test(answers(w, "c2")[1]?.text ?? "") },
    { name: "every citation in c2's replies resolves", kind: "required_fact", check: async (w) => (await Promise.all(replies(w, "c2").flatMap(citationsIn).map((c) => resolves(w, c, "Pat Solo")))).every(Boolean) },
    { name: "uncited_claim", kind: "minefield", check: (w) => replies(w, "c2").some((t) => /Pat Solo/.test(t) && /prefer/i.test(t) && citationsIn(t).length === 0) },
    { name: "transcript_read", kind: "minefield", check: (w) => w.sentIn("c2").some((m) => m.includes(REMEMBER) || m.includes(CORRECT)) },
    { name: "old_value_recalled", kind: "minefield", check: (w) => ((t) => /plain text/i.test(t) && !/\b(replac|not|no longer|instead|correct|used to|earlier)/i.test(t))(answers(w, "c2")[1]?.text ?? "") },
  ],
  reference: `B-P6-02, B-P6-03, B-P6-06, B-P6-13; the fact is "${PAT_FACT}".`,
});

export default task;
