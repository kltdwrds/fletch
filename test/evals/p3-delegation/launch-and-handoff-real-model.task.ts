// T-P3-14 (B-P3-01): tier 2, the real model on a slot (`pnpm evals P3`, F34) asked to delegate one read and say when it
// is launched and when it has reported. The first reply says a sub-agent was started and what it will find out, with
// no done words, no title and no promise of progress; the second, once, carries the title and the verdict in words; one
// section with a `pass` or `unverified` verdict. Under the scripted fake its graders answer as shipped fletch does
// (`tier2-fake.test.ts`).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World } from "./world.ts";
import { DONE_WORDS, newestTask, PROBE, RELAY_WORDS, UNCONFIRMED } from "./world.ts";

export const ASK = `Have a sub-agent read ${PROBE} and tell me its title; tell me when it is launched and again when it has reported.`;
const ack = (w: P3World) => w.replies("c1")[0] ?? "";
const handoff = (w: P3World) => w.replies("c1")[1] ?? "";
const verdict = (w: P3World) => w.children("c1")[0]?.verdict ?? null;
/** The verdict said in words: `UNCONFIRMED`, or a check named between the negation and the verb, as the real model words it on a slot (F34). */
export const SAID_UNCONFIRMED = (text: string) => UNCONFIRMED.test(text) || /(\bnot|n't) (been )?(independently |machine[- ]|separately )?(confirm|verif|check)/i.test(text);

const graders: Grader<P3World>[] = [
  { name: "the first reply says a sub-agent was started, with no done words, no title and no promised progress", kind: "end_state", check: (w) => /\b(started|launched|asked)\b/i.test(ack(w)) && !DONE_WORDS.test(ack(w)) && !ack(w).includes(w.probeTitle) && !RELAY_WORDS.test(ack(w)) },
  { name: "the second reply, once, carries the title and the verdict in words", kind: "end_state", check: (w) => w.replies("c1").length === 2 && (verdict(w) === "pass" ? handoff(w).includes(w.probeTitle) : SAID_UNCONFIRMED(handoff(w))) },
  { name: "the record shows one section with a pass or unverified verdict step", kind: "end_state", check: async (w) => {
    const t = await newestTask(w);
    const d = t ? await w.task("c1", t.id) : null;
    return d?.subagents.length === 1 && ["pass", "unverified"].includes(verdict(w) ?? "") && d.steps.some((s) => s.kind === "verdict");
  } },
  { name: "the words are the model's under WORK_WORDS", kind: "required_fact", check: (w) => w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "done_before_result", kind: "minefield", check: (w) => DONE_WORDS.test(ack(w)) },
  { name: "promised_relay", kind: "minefield", check: (w) => RELAY_WORDS.test(ack(w)) },
  { name: "handoff_twice", kind: "minefield", check: (w) => w.replies("c1").length > 2 },
  { name: "title_in_ack", kind: "minefield", check: (w) => ack(w).includes(w.probeTitle) },
  { name: "verdict_unsaid", kind: "minefield", check: (w) => verdict(w) !== "pass" && handoff(w).includes(w.probeTitle) && !SAID_UNCONFIRMED(handoff(w)) },
];

export const task = defineTask<P3World>({
  id: "T-P3-14",
  cluster: "P3",
  clauses: ["B-P3-01"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 314, records: ["chat:c1 on the slot", "the slot's probe page with a title and three links"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's launch and handoff in thread A (B-P3-01).",
});

export default task;
