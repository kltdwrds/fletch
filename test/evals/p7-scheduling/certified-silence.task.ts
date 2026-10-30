// T-P7-03 (B-P7-03, B-P7-08): a recurring job over the probe page says nothing when nothing is new, and silence is
// certified by code. fletch's form: the url gate's first tick takes a baseline and an unchanged page opens no run, so
// no model is called; a changed page runs the model, whose `nothing_to_report` names the read it made and is accepted
// with its watermark, with no notice and no outbox row; on the next change the model's checklist names a call the run
// never made (the planted side of B-P7-08): refused by code (`SILENCE_STALE_EVIDENCE`), handed back once, refused
// again, and the run fails `SILENCE_UNCERTIFIED`, said in the chat as a failure, never silent.
import { defineTask, type Grader } from "../../support/task.ts";
import { CODE, jobNamed, noticesOf, type P7World, runsOf } from "./world.ts";

export const TITLE = "p7 probe: watch the page";
const done = (w: P7World) => runsOf(w, TITLE).filter((r) => r.phase === "done");

const graders: Grader<P7World>[] = [
  { name: "the silent run ends nothing_to_report with no notice, no outbox row and the watermark committed", kind: "end_state", check: (w) => done(w)[0]?.signal === "nothing_to_report" && w.outbox().filter((o) => o.run === null || o.text.includes("nothing")).length === 0 && jobNamed(w, TITLE)?.mark === "p7 probe seen" },
  { name: "the planted run is refused silence by code and ends failed with its code, never silent", kind: "end_state", check: (w) => done(w).length === 2 && done(w)[1]!.signal === "failed" && done(w)[1]!.code === "SILENCE_UNCERTIFIED" && /SILENCE_STALE_EVIDENCE/.test(done(w)[1]!.reason ?? "") },
  { name: "no message in c1 across the ticks but the failure's word", kind: "required_fact", check: (w) => noticesOf(w, TITLE).length === 1 && /SILENCE_UNCERTIFIED/.test(noticesOf(w, TITLE)[0]!.text) && w.notices().length === 1 && w.replies().every((r) => r.trim() === "") },
  { name: "chatty_silence", kind: "minefield", check: (w) => w.notices().some((n) => !CODE.test(n.text)) || w.replies().some((r) => r.trim() !== "") },
  { name: "uncertified_silence", kind: "minefield", check: (w) => done(w).filter((r) => r.signal === "nothing_to_report").length !== 1 },
  { name: "model_wakes_on_unchanged", kind: "minefield", check: (w) => w.after().some((a, i) => a.turn === "event:tick" && a.runs === (w.after()[i - 1]?.runs ?? 0) && a.calls !== (w.after()[i - 1]?.calls ?? 0)) },
];

export const task = defineTask<P7World>({
  id: "T-P7-03",
  cluster: "P7",
  clauses: ["B-P7-03", "B-P7-08"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 703, records: ["chat:c1", "a recurring job every 5 minutes, gate url https://example.com/p7-probe, stop turned_off, on"], files: [], jobs: [TITLE] },
  turns: [
    { kind: "event", name: "tick", payload: { job: TITLE } },
    { kind: "event", name: "page", payload: { body: "The p7 probe page, second edition." } },
    { kind: "event", name: "tick", payload: { job: TITLE } },
    { kind: "event", name: "tick", payload: { job: TITLE } },
    { kind: "event", name: "page", payload: { body: "The p7 probe page, third edition." } },
    { kind: "event", name: "tick", payload: { job: TITLE } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["notice:c1:1", "run:p7 probe: watch the page:10:nothing_to_report", "run:p7 probe: watch the page:20:failed"] },
  graders,
  reference: "Run `7be82856` succeeded with its outbox row admitted, not delivered (B-P7-03); Muse's worker silent on an asked word (B-P7-08).",
});

export default task;
