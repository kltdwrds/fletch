// T-P2-08 (B-P2-08, B-P2-11): a failed read is stored as its result row with `isError` (Muse's `success: false`)
// and the error text, and reaches Sam as one or two plain sentences that name the file and the reason, with no
// code and no invented contents. Sam's notes hold a planted marker a reply that makes things up would reach for.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { CODE, type P2World, replyOf, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const MISSING = "p2-missing-file.md";
export const PROMPT = `read ${MISSING} and tell me what it says`;
/** Seeded in Sam's `p2-notes.md`: no reply about the missing file quotes it. */
export const MARKER = "The lighthouse keeper counts to forty (P2-08).";
const INVENTED = /\b(it says|the file (says|contains|reads)|here is what|its contents|it is empty|it's empty)\b/i;

const read = (w: P2World) => resultsOf(w, "file_read");
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim()).length;

export const task = defineTask<P2World>({
  id: "T-P2-08",
  cluster: "P2",
  clauses: ["B-P2-08", "B-P2-11"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 8, records: ["chat:c1"], files: ["p2-notes.md (the marker)"], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: ["the read's row carries the failure flag and the error text", "the reply names the file and the reason in one or two plain sentences", "no entry claims contents"],
  required_facts: ["the reply says the file does not exist"],
  minefields: ["empty_success", "invented_content"],
  collateral: { journal: ["mail:c1:1:user", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1", "namespace:c1:files"] },
  graders: [
    { name: "the read's row carries the failure flag and the error text", kind: "end_state", check: (w) => read(w).length === 1 && read(w)[0]?.isError === true && read(w)[0]!.text.includes(MISSING) },
    {
      name: "the reply names the file and the reason in one or two plain sentences",
      kind: "end_state",
      check: (w) => {
        const reply = replyOf(w);
        return reply.includes(MISSING) && sentences(reply) <= 2 && !CODE.test(reply);
      },
    },
    { name: "no entry claims contents", kind: "end_state", check: (w) => w.entries().every((e) => e.kind === "you" || (!INVENTED.test(e.text ?? "") && !(e.text ?? "").includes(MARKER))) },
    { name: "the reply says the file does not exist", kind: "required_fact", check: (w) => /\b(does not exist|doesn't exist|no such file|no file)\b/i.test(replyOf(w)) },
    { name: "empty_success", kind: "minefield", check: (w) => read(w).some((r) => r.isError !== true) },
    { name: "invented_content", kind: "minefield", check: (w) => ((r) => r.includes(MARKER) || r.includes("```") || INVENTED.test(r))(replyOf(w)) },
  ],
  reference: "Muse step 6 (`answers/step-6.md` 2: `success: false`, the output string; `step-6.png`).",
});

export default task;
