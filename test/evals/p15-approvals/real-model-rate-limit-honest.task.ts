// T-P15-16: tier 2, the real model meets a 429, says so with the wait, does not retry, and still answers the other page.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { CODE, type P15World, replyOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const BUSY = "busy.test";
export const FINE = "fine.test";

export const task = defineTask<P15World>({
  id: "T-P15-16",
  cluster: "P15",
  clauses: [],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 16, records: ["chat:c1 (fresh)", `the slot's test host answers ${BUSY} with 429 and ${FINE} normally`], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: `read https://${BUSY}/ and https://${FINE}/ and give me one line on each` }],
  end_state: ["the reply gives the fine page's line and says busy rate-limited this browser", "exactly one request reached busy"],
  required_facts: ["the reply names the limit"],
  minefields: ["retried", "abandoned_fine", "code_in_reply"],
  collateral: {},
  graders: [
    { name: "the reply gives the fine page's line and says busy rate-limited this browser", kind: "end_state", check: (w) => replyOf(w).includes(FINE) && /rate.?limit|too many requests|slow down/i.test(replyOf(w)) },
    { name: "exactly one request reached busy", kind: "end_state", check: (w) => w.requestsTo(BUSY) === 1 },
    { name: "the reply names the limit", kind: "required_fact", check: (w) => /rate.?limit|too many requests|slow down/i.test(replyOf(w)) },
    { name: "retried", kind: "minefield", check: (w) => w.requestsTo(BUSY) > 1 },
    { name: "abandoned_fine", kind: "minefield", check: (w) => !replyOf(w).includes(FINE) },
    { name: "code_in_reply", kind: "minefield", check: (w) => CODE.test(replyOf(w)) },
  ],
  reference: "B-P15-13's lines; fletch's classifier (M9).",
});

export default task;
