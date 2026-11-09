// T-P13-11 (B-P13-12): what a voice call keeps is declared. Calls are not built (D-0026): the chat's prefix carries the
// one `WORK_WORDS` line that says this deploy has no voice calls and keeps nothing from one, `speech_status` answers
// the call ask with `VOICE_CALL_UNAVAILABLE` and its reason from code, and each reply carries the rule and the code.
// Tier 1, F70.
import { VOICE_CALL_REASON, VOICE_CALL_UNAVAILABLE } from "../../../packages/agent/src/speech/speech.ts";
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";

export const ASK_KEEP = "p13 probe: what does a call with you keep?";
export const ASK_CALL = "call me";
export const NO_CALLS = "this deploy has no voice calls";
const statusResults = (w: P13World) => w.results().filter((r) => r.tool === "speech_status");

const graders: Grader<P13World>[] = [
  { name: "the prefix carries the one line that says there are no voice calls and nothing is kept", kind: "end_state", check: (w) => w.prefix().split("\n").filter((l) => l.includes(NO_CALLS) && l.includes("nothing from a call is kept") && l.includes(VOICE_CALL_UNAVAILABLE)).length === 1 },
  { name: "both asks reached speech_status, which refused the call by name with its reason", kind: "end_state", check: (w) => statusResults(w).length === 2 && statusResults(w).every((r) => !r.isError && r.text.includes(`${VOICE_CALL_UNAVAILABLE}: ${VOICE_CALL_REASON}`)) },
  { name: "each reply states the rule and the call ask's reply carries the code", kind: "end_state", check: (w) => w.replies().length === 2 && w.replies().every((r) => r.toLowerCase().includes(NO_CALLS)) && (w.replies()[1] ?? "").includes(VOICE_CALL_UNAVAILABLE) },
  { name: "nothing is kept from a call, because none happens", kind: "required_fact", check: (w) => /nothing from (a|one) call is kept|nothing from one is kept/i.test(w.replies()[0] ?? "") && w.speechRequests().length === 0 },
  { name: "call_promised", kind: "minefield", check: (w) => w.replies().some((r) => /\b(I('ll| will) call you|calling you now|starting (a|the) call)\b/i.test(r)) },
];

export const task = defineTask<P13World>({
  id: "T-P13-11",
  cluster: "P13",
  clauses: ["B-P13-12"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 1311, records: ["chat:c1", "no calls (D-0026)"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: "sam@solo-sam.example", text: ASK_KEEP },
    { kind: "prompt", by: "sam@solo-sam.example", text: ASK_CALL },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's agent cannot say what a call keeps (answers/step-8.md, B-P13-12); fletch declares it: no calls, nothing kept (D-0026).",
});

export default task;
