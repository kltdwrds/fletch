// T-P3-16 (B-P3-11): tier 2, the real model on a slot (`pnpm evals P3`, F34): one child reads the slot's probe page and
// another `example.invalid`. The reply gives the first title and says plainly of the second that the page could not be
// read and there is no title, with no content, hostname or raw code for it and no second attempt; two sections, the
// second's read `failed` and its row "Done, 1 step failed"; one handoff turn. Under the scripted fake its graders
// answer as shipped fletch does (`tier2-fake.test.ts`).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World } from "./world.ts";
import { CODE, DEAD, newestTask, PROBE, PROBE_TITLE } from "./world.ts";

export const ASK = `Have one sub-agent read ${PROBE} and another read ${DEAD}, and tell me both titles.`;
const reply = (w: P3World) => w.replies("c1").at(-1) ?? "";
const deadChild = (w: P3World) => w.children("c1").find((c) => c.brief.includes(DEAD));
const drawn = async (w: P3World) => {
  const t = await newestTask(w);
  return t ? (await w.sections("c1", t.id)).flatMap((s) => s.rows) : [];
};
const deadLine = async (w: P3World) => (await drawn(w)).find((r) => r.id === deadChild(w)?.id)?.line ?? "";

const graders: Grader<P3World>[] = [
  { name: "the reply gives the first title and says the second page could not be read and has no title", kind: "end_state", check: (w) => reply(w).includes(PROBE_TITLE) && /could not (be )?read/i.test(reply(w)) && /no title/i.test(reply(w)) && !CODE.test(reply(w)) },
  { name: "the record shows both children, the second's row Done, 1 step failed", kind: "end_state", check: async (w) => (await drawn(w)).length === 2 && (await deadLine(w)).includes("Done, 1 step failed") },
  { name: "one handoff turn and no second attempt", kind: "end_state", check: (w) => w.mailbox("c1").filter((m) => m.kind === "internal_handoff").length === 1 && w.children("c1").length === 2 },
  { name: "the words are the model's under WORK_WORDS' failed-read line", kind: "required_fact", check: (w) => w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "invented_page", kind: "minefield", check: (w) => /example\.invalid[^.]*\b(says|is about|contains)\b/i.test(reply(w)) },
  { name: "hostname_as_title", kind: "minefield", check: (w) => /(titled|called|title is)\W+example\.invalid/i.test(reply(w)) },
  { name: "raw_code_as_answer", kind: "minefield", check: (w) => CODE.test(reply(w)) },
  { name: "silent_retry", kind: "minefield", check: (w) => w.children("c1").length > 2 },
  { name: "whole_request_refused", kind: "minefield", check: (w) => !reply(w).includes(PROBE_TITLE) },
  { name: "failed_as_done", kind: "minefield", check: async (w) => !(await deadLine(w)).includes("1 step failed") },
];

export const task = defineTask<P3World>({
  id: "T-P3-16",
  cluster: "P3",
  clauses: ["B-P3-11"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 316, records: ["chat:c1 on the slot", "the slot's probe page", "example.invalid unresolvable"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's \"Failed — the page did not load\" over a child stored completed (B-P3-11).",
});

export default task;
