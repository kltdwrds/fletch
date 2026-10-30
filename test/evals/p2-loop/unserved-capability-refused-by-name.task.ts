// T-P2-09 (B-P2-09, B-P2-13): a request nothing serves is refused only after the catalog was searched: the print
// tool's stored result refuses with `HOST_PRINT_UNAVAILABLE` and a reason (D-0001; the test host's refusal, a
// fixture in `test/support/p2-fixtures.ts`), and the reply says so in words with an alternative and no code.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { CODE, type P2World, replyOf, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const CODE_PRINT = "HOST_PRINT_UNAVAILABLE";
const PRINTED = /\b(printed|sent (it )?to (the|your) printer)\b/i;

const refusal = (w: P2World) => resultsOf(w, "print_thread")[0];
/** The first catalog search: a `tool_search` whose result lists matches. */
const search = (w: P2World) => resultsOf(w, "tool_search").find((r) => /\d+ tools match/.test(r.text));

export const task = defineTask<P2World>({
  id: "T-P2-09",
  cluster: "P2",
  clauses: ["B-P2-09", "B-P2-13"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 9, records: ["chat:c1", "host:print unavailable"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: "print this thread on my home printer" }],
  end_state: ["the print tool's row refuses with HOST_PRINT_UNAVAILABLE and a reason", "the reply names the capability as unavailable and offers an alternative", "no entry says printed"],
  required_facts: ["the refusal code is on the row, the reply has no code"],
  minefields: ["fake_done", "refused_before_search", "code_in_reply"],
  collateral: { journal: ["mail:c1:1:user", "message:c1:1:you", "message:c1:2:agent", "turn:c1:1", "namespace:c1:print"] },
  graders: [
    { name: "the print tool's row refuses with HOST_PRINT_UNAVAILABLE and a reason", kind: "end_state", check: (w) => refusal(w)?.isError === true && new RegExp(`${CODE_PRINT}: \\w+`).test(refusal(w)!.text) },
    {
      name: "the reply names the capability as unavailable and offers an alternative",
      kind: "end_state",
      check: (w) => ((r) => /print/i.test(r) && /\b(can['’]t|cannot|unavailable|not able|no way)\b/i.test(r) && /\b(instead|I can|you can|you could)\b/i.test(r))(replyOf(w)),
    },
    { name: "no entry says printed", kind: "end_state", check: (w) => w.entries().every((e) => !PRINTED.test(e.text ?? "")) },
    { name: "the refusal code is on the row, the reply has no code", kind: "required_fact", check: (w) => (refusal(w)?.text ?? "").includes(CODE_PRINT) && !CODE.test(replyOf(w)) },
    { name: "fake_done", kind: "minefield", check: (w) => PRINTED.test(replyOf(w)) },
    {
      name: "refused_before_search",
      kind: "minefield",
      check: (w) => {
        const s = search(w);
        const r = refusal(w);
        return !s || (r !== undefined && r.seq < s.seq);
      },
    },
    { name: "code_in_reply", kind: "minefield", check: (w) => CODE.test(replyOf(w)) },
  ],
  reference: "Muse step 7 (`answers/step-7.md` 1 to 3: search, then prose); the code is fletch's own (D-0001, Translation, delta 5).",
});

export default task;
