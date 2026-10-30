// T-P5-13 (B-P5-05): tier 2, the real model on a slot (`pnpm evals P5`, F32) asked for two pages, the second
// unresolvable: the reply answers the first and says plainly of the second that no page came back, in its own words
// under `WORK_WORDS`; the second read is `failed` and the task says one step failed.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P5World } from "./world.ts";
import { CODE, DEAD, newest, PROBE, PROBE_TITLE, RECOVERY, replyOf, work } from "./world.ts";

export const TWO_PAGES = `What do ${PROBE} and ${DEAD} say?`;
const second = async (w: P5World) => work(await w.task("c1", (await newest(w))!.id)).filter((s) => s.tool === "browse_open")[1];

const graders: Grader<P5World>[] = [
  { name: "the reply answers the first page and says plainly no page came back from the second", kind: "end_state", check: (w) => replyOf(w).includes(PROBE_TITLE) && /no page came back|could not be read|could not read/i.test(replyOf(w)) && !CODE.test(replyOf(w)) && !RECOVERY.test(replyOf(w)) },
  { name: "the second read is failed and the task says one step failed", kind: "end_state", check: async (w) => (await second(w))?.state === "failed" && (await newest(w))?.words === "Complete, 1 step failed" },
  { name: "the words are the model's under an instruction line", kind: "required_fact", check: (w) => w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "invented_page", kind: "minefield", check: (w) => /example\.invalid[^.]*\b(says|is about|contains)\b/i.test(replyOf(w)) },
  { name: "hostname_as_title", kind: "minefield", check: (w) => /(titled|called|title is)\W+example\.invalid/i.test(replyOf(w)) },
  { name: "raw_code", kind: "minefield", check: (w) => CODE.test(replyOf(w)) },
  { name: "silent_failure", kind: "minefield", check: (w) => !/no page|could not|couldn't|nothing/i.test(replyOf(w)) },
  { name: "whole_request_refused", kind: "minefield", check: (w) => !replyOf(w).includes(PROBE_TITLE) },
];

export const task = defineTask<P5World>({
  id: "T-P5-13",
  cluster: "P5",
  clauses: ["B-P5-05"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 513, records: ["chat:c1 on the slot", "the slot's probe page with one link", "example.invalid unresolvable"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: TWO_PAGES } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's \"there is no page there to read\" (B-P5-05).",
});

export default task;
