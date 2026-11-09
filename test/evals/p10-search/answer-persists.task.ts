// T-P10-15 (B-P10-17): what this cluster draws persists. After T-P10-01's turn the chat's object is evicted and its
// history frame read afresh, as a reload reads it: the reply with its two links is the same, character for character,
// and the shipped page at phone width (the page harness's default layout) draws the links as anchors with the same
// href. The history is the transcript's; the page's text is stored nowhere else. The Activity half of the reload is
// T-P5-15's (`test/evals/p5-activity/reload-and-phone.task.ts`) and is not repeated here.
// Not planted (parts.md F90, scope 2): `drifted` guards against a second copy of the reply fletch does not keep (a
// reload reads the one stored transcript), so it has no guard on the production path to remove and `planted.test.ts`
// has no test for it. `link_lost` is planted on the shipped page script.
// Not planted either: `page_copied` reads the other chat, the files and the Ledger for the page's text; no code copies a
// tool result into any of them (browse memory keeps the domain, engine, state and code only), so no guard on the
// production path can be removed.
import { defineTask, type Grader } from "../../support/task.ts";
import { ASK } from "./page-read-names-source.task.ts";
import type { P10World } from "./world.ts";
import { PROBE, PROBE_LINK, replyOf } from "./world.ts";

const graders: Grader<P10World>[] = [
  { name: "the reply with its two links is returned the same after the reload", kind: "end_state", check: async (w) => { const r = await w.reloaded(); return r.after.length > 0 && r.after.join("\n") === r.before.join("\n") && replyOf(w).includes(PROBE) && replyOf(w).includes(PROBE_LINK); } },
  { name: "at phone width the links are anchors with the same href", kind: "end_state", check: async (w) => { const a = await w.phoneAnchors(); return a.includes(PROBE) && a.includes(PROBE_LINK); } },
  { name: "the page's text is stored nowhere outside the transcript's tool result", kind: "required_fact", check: async (w) => !(await w.elsewhere("c1")).includes("The p10 probe has one link") },
  { name: "link_lost", kind: "minefield", check: async (w) => { const a = await w.phoneAnchors(); return !a.includes(PROBE) || !a.includes(PROBE_LINK); } },
  { name: "drifted", kind: "minefield", check: async (w) => { const r = await w.reloaded(); return r.after.join("\n") !== r.before.join("\n"); } },
  { name: "page_copied", kind: "minefield", check: async (w) => (await w.elsewhere("c1")).includes("The p10 probe has one link") },
];

export const task = defineTask<P10World>({
  id: "T-P10-15",
  cluster: "P10",
  clauses: ["B-P10-17"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1015, records: ["chat:c1 after T-P10-01's turn"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's persisted answer, card and links after reload (B-P10-17).",
});

export default task;
