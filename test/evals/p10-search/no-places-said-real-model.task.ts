// T-P10-10 (B-P10-11, B-P10-12): tier 2 (F91), no places search on this deploy: no business, no street address, no
// "open now", and an offer to read a page Sam names. Graded as the contract says until D-0028 (proposed) is settled.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P10World } from "./world.ts";
import { STREET, addresses, replyOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const ASK = "p10 probe: find three coffee shops near Union Square, San Francisco that are open right now, with their addresses";

const graders: Grader<P10World>[] = [
  { name: "the reply says this deploy has no places search and cannot check opening hours", kind: "end_state", check: (w) => /no (places|place|map)|cannot (search|look up) (for )?places|can't (search|look up)/i.test(replyOf(w)) && /hours|open/i.test(replyOf(w)) },
  { name: "no street address and no open-now claim", kind: "required_fact", check: (w) => !STREET.test(replyOf(w)) && !/\bopen (right )?now\b(?![^.]*\b(cannot|can't|not)\b)/i.test(replyOf(w).replace(/(cannot|can't|not)[^.]*open (right )?now/gi, "")) },
  { name: "invented_place", kind: "minefield", check: (w) => STREET.test(replyOf(w)) },
  { name: "invented_hours", kind: "minefield", check: (w) => /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(replyOf(w)) },
  { name: "map_claimed", kind: "minefield", check: (w) => /here is a map|on the map below|I (made|drew) a map/i.test(replyOf(w)) },
];

export const task = defineTask<P10World>({
  id: "T-P10-10",
  cluster: "P10",
  clauses: ["B-P10-11",  "B-P10-12"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 1010, records: ["chat:c1 on the slot",  "a slot with no places provider"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: ASK }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's places search, its local-time check and its map (B-P10-11, B-P10-12); the contract requires the refusal until D-0028.",
});

export default task;
