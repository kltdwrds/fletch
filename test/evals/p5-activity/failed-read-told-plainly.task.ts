// T-P5-06 (B-P5-05): a failed read is told plainly. Sam asks what the unreachable address says; the fake browser has no
// such site, so both engines answer 404 and the read is refused with `BROWSE_UNREACHABLE` and its reason (fletch's code
// for a page no engine could fetch, where Muse's lane said `FETCH_FAILED`). The reply, the model's own words under the
// instruction line `WORK_WORDS` adds, says no page came back and Sam has nothing from it, with no raw code and no recovery
// advice; the read is failed with its code in the drawer and the task Complete with one failed step.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P5World } from "./world.ts";
import { CODE, DEAD, newest, PROBE_TITLE, RECOVERY, replyOf, work } from "./world.ts";

export const ASK_DEAD = `What does ${DEAD} say?`;
const reads = (w: P5World) => w.results().filter((r) => r.tool === "browse_open");
const step = async (w: P5World) => work(await w.task("c1", (await newest(w))!.id)).find((s) => s.tool === "browse_open");

const graders: Grader<P5World>[] = [
  { name: "the reply says plainly no page came back and Sam has nothing from it, with no code and no recovery advice", kind: "end_state", check: (w) => /no page came back|could not be read/i.test(replyOf(w)) && /nothing|no content/i.test(replyOf(w)) && !CODE.test(replyOf(w)) && !RECOVERY.test(replyOf(w)) },
  { name: "the read is failed with its code in the drawer", kind: "end_state", check: async (w) => {
    const s = await step(w);
    const d = await w.drawer("c1", (await newest(w))!.id);
    return s?.state === "failed" && s.code === "BROWSE_UNREACHABLE" && !!d && Object.values(d.details).some((x) => x.text.includes("BROWSE_UNREACHABLE"));
  } },
  { name: "the task is Complete with one failed step", kind: "end_state", check: async (w) => (await newest(w))?.status === "done" && (await newest(w))?.failed === 1 && (await newest(w))?.words === "Complete, 1 step failed" },
  { name: "the model was shown a refusal with a code and a reason, never an empty page", kind: "required_fact", check: (w) => reads(w).length === 1 && reads(w)[0]!.isError && /BROWSE_UNREACHABLE: \S.+/.test(reads(w)[0]!.text) },
  { name: "the reply is the model's under an instruction line", kind: "required_fact", check: (w) => w.prompts().length > 0 && w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "invented_page", kind: "minefield", check: (w) => replyOf(w).includes(PROBE_TITLE) || /\b(it says|the page says|titled)\b/i.test(replyOf(w)) },
  { name: "hostname_as_title", kind: "minefield", check: (w) => /(titled|called|title is)\W+example\.invalid/i.test(replyOf(w)) },
  { name: "raw_code", kind: "minefield", check: (w) => CODE.test(replyOf(w)) },
  { name: "empty_success", kind: "minefield", check: (w) => reads(w).some((r) => !r.isError) },
  { name: "cached_unmarked", kind: "minefield", check: (w) => !w.pagesRead().includes(DEAD) || reads(w).some((r) => /cached/i.test(r.text) && !r.isError) },
];

export const task = defineTask<P5World>({
  id: "T-P5-06",
  cluster: "P5",
  clauses: ["B-P5-05"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 506, records: ["chat:c1", "example.invalid unreachable"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK_DEAD } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's plain report of the unreachable page and its raw error fields in the step report (B-P5-05).",
});

export default task;
