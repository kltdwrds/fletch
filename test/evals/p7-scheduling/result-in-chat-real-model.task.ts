// T-P7-10 (B-P7-02): tier 2, T-P7-02 with the real model's run on a slot (`pnpm evals P7`, F30): one notice in c1
// that tells the time in words within the tick, no second message, and the one-shot finished.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { TITLE } from "./one-shot-set.task.ts";
import { jobNamed, noticesOf, type P7World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|o'clock|noon|midnight|past|to|quarter|half)\b/i;

const graders: Grader<P7World>[] = [
  { name: "one notice in c1 that tells the time in words, within the tick", kind: "end_state", check: (w) => noticesOf(w, TITLE).length === 1 && WORDS.test(noticesOf(w, TITLE)[0]!.text) && w.after().length === 1 },
  { name: "the job is finished", kind: "end_state", check: (w) => jobNamed(w, TITLE)?.status === "finished" },
  { name: "the notice contains a time in words, not digits only", kind: "required_fact", check: (w) => WORDS.test(noticesOf(w, TITLE)[0]?.text ?? "") },
  { name: "digits_only", kind: "minefield", check: (w) => noticesOf(w, TITLE).some((n) => !WORDS.test(n.text)) },
  { name: "wrong_chat", kind: "minefield", check: (w) => jobNamed(w, TITLE)?.chat !== "c1" },
  { name: "double_notice", kind: "minefield", check: (w) => w.notices().length > 1 },
];

export const task = defineTask<P7World>({
  id: "T-P7-10",
  cluster: "P7",
  clauses: ["B-P7-02"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 710, records: ["as T-P7-09, the one-shot on", "the runner advances to the slot"], files: [], jobs: [TITLE] },
  turns: [{ kind: "event", name: "tick", payload: { by: sam.email } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["notice:c1:1", `run:${TITLE}:5:notify`] },
  graders,
  reference: "Muse (B-P7-02): the result in thread A within seconds of the slot.",
});

export default task;
