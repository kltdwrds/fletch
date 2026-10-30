// T-P7-08 (B-P7-08): a run whose instructions ask for a reply never ends silent (delta 2). The job's
// instructions end "reply with the one word done"; its model step reads the page and ends `nothing_to_report` with a
// complete checklist. Code refuses the silence with `SILENCE_MATERIAL_RESULT`, hands it back once, refuses it again,
// and the run fails `SILENCE_UNCERTIFIED`; the chat is told the run did not finish, with the job and the code.
import { defineTask, type Grader } from "../../support/task.ts";
import { noticesOf, type P7World, runsOf } from "./world.ts";

export const TITLE = "p7 probe: the word done";
const run = (w: P7World) => runsOf(w, TITLE)[0];

const graders: Grader<P7World>[] = [
  { name: "silence refused by code with SILENCE_MATERIAL_RESULT, the run failed with its code", kind: "end_state", check: (w) => runsOf(w, TITLE).length === 1 && run(w)?.signal === "failed" && run(w)?.code === "SILENCE_UNCERTIFIED" && /SILENCE_MATERIAL_RESULT/.test(run(w)?.reason ?? "") && /ask for a reply/.test(run(w)?.reason ?? "") },
  { name: "the chat is told the run did not finish", kind: "end_state", check: (w) => noticesOf(w, TITLE).length === 1 && /did not finish/.test(noticesOf(w, TITLE)[0]!.text) },
  { name: "the failure line names the job and the code", kind: "required_fact", check: (w) => (noticesOf(w, TITLE)[0]?.text ?? "").includes(TITLE) && (noticesOf(w, TITLE)[0]?.text ?? "").includes("SILENCE_UNCERTIFIED") },
  { name: "noop_accepted", kind: "minefield", check: (w) => runsOf(w, TITLE).some((r) => r.signal === "nothing_to_report") },
  { name: "unexplained_failure", kind: "minefield", check: (w) => noticesOf(w, TITLE).length === 0 },
];

export const task = defineTask<P7World>({
  id: "T-P7-08",
  cluster: "P7",
  clauses: ["B-P7-08"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 708, records: ["chat:c1", "a recurring job every 30 minutes whose instructions end \"reply with the one word done\", on"], files: [], jobs: [TITLE] },
  turns: [{ kind: "event", name: "tick", payload: { job: TITLE } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["notice:c1:1", "run:p7 probe: the word done:30:failed"] },
  graders,
  reference: "Muse's hook worker ending `completed_noop` with the requested word delivered nowhere (B-P7-08).",
});

export default task;
