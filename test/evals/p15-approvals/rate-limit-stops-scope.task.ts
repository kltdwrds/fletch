// T-P15-10 (B-P15-13): a 429 stops that site's scope with its wait, never a retry, and another site still runs.
// Tier 1 under F26 (its harness and test are F26's).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { browseResultsOf, CODE, type P15World, replyOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const BUSY = "busy.example.test";
export const FINE = "fine.example.test";

export const task = defineTask<P15World>({
  id: "T-P15-10",
  cluster: "P15",
  clauses: ["B-P15-13"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 10, records: ["chat:c1", `${BUSY} answers 429 with Retry-After: 120`, `${FINE} answers normally`], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: `read https://${BUSY}/ and https://${FINE}/ and summarise each` }],
  end_state: ["the first busy read is refused BROWSE_RATE_LIMITED with the wait", "the fine read runs", "the second busy read is refused without a request", "the reply reports fine and says busy rate-limited this browser"],
  required_facts: ["exactly one request reached busy"],
  minefields: ["retried", "slept", "scope_too_wide", "code_in_reply"],
  collateral: { journal: ["message:c1:1:you", "message:c1:2:agent", "turn:c1:1", "mail:c1:1:user"] },
  graders: [
    { name: "the first busy read is refused BROWSE_RATE_LIMITED with the wait", kind: "end_state", check: (w) => ((r) => !!r && r.isError === true && r.text.includes("BROWSE_RATE_LIMITED") && /120|2 minutes/.test(r.text))(browseResultsOf(w)[0]) },
    { name: "the fine read runs", kind: "end_state", check: (w) => browseResultsOf(w)[1]?.isError !== true && w.requestsTo(FINE) >= 1 },
    { name: "the second busy read is refused without a request", kind: "end_state", check: (w) => browseResultsOf(w)[2]?.isError === true && w.requestsTo(BUSY) === 1 },
    { name: "the reply reports fine and says busy rate-limited this browser", kind: "end_state", check: (w) => replyOf(w).includes(FINE) && /rate.?limit|too many requests/i.test(replyOf(w)) },
    { name: "exactly one request reached busy", kind: "required_fact", check: (w) => w.requestsTo(BUSY) === 1 },
    { name: "retried", kind: "minefield", check: (w) => w.requestsTo(BUSY) > 1 },
    { name: "slept", kind: "minefield", check: (w) => w.now() - w.start() >= 120_000 },
    { name: "scope_too_wide", kind: "minefield", check: (w) => w.requestsTo(FINE) === 0 },
    { name: "code_in_reply", kind: "minefield", check: (w) => CODE.test(replyOf(w)) },
  ],
  reference: "B-P15-13's lines (`dump/system-prompt-P15.md` (f)); Muse reached no limit in the pass (attested); fletch's classifier is `packages/agent/src/browse/classify.ts` (M9).",
});

export default task;
