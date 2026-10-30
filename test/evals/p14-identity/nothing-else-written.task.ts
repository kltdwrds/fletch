// T-P14-08 (B-P14-02, B-P14-10): a conversation about identity leaves only its transcript and the memory lines it asked
// for. T-P14-01's rename and T-P14-02's first turn run in one chat with every table counted before; then Sam asks what
// it all left. Only the chat's rows and two memory lines (with their index) grew; the standing files are the seed's;
// no profile, settings, passkey, session or grant row; and the reply names those rows and says the lines are Sam's to
// edit or forget.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P14World } from "./world.ts";
import { grown, unseeded } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const ASK = "what did all that leave? (p14 probe)";
/** The tables the turns may grow: the chat's own, the Ledger's model calls, the memory lines with their index and
 * vector queue, and an object's schema bookkeeping the first turn creates (its migrations, full-text config, cursor). */
export const ALLOWED = /^(c1\/|ledger\/model_calls$|person:[^/]+\/(daily_lines|chunks\w*|vector_queue)$|[^/]+\/(migrations|\w+_fts_(data|config|idx|docsize)|delivery_state)$)/;
const extra = (w: P14World) => grown(w).filter((k) => !ALLOWED.test(k));

const graders: Grader<P14World>[] = [
  { name: "only the chat's rows and the memory lines grew", kind: "end_state", check: (w) => grown(w).some((k) => k.startsWith("c1/")) && extra(w).length === 0 },
  { name: "two memory lines: the one naming the agent and the one with what to call Sam", kind: "end_state", check: async (w) => (await w.remembered()).length === 2 },
  { name: "the standing files are the seed's, written by qyvr:seed", kind: "end_state", check: async (w) => (await unseeded(w)).length === 0 },
  { name: "no profile, settings, passkey, session or grant row", kind: "end_state", check: (w) => !grown(w).some((k) => /profile|setting|passkey|session|grant/i.test(k)) },
  { name: "the reply names the rows and says the memory lines are Sam's to edit or forget", kind: "end_state", check: (w) => { const r = w.replies("c1").at(-1) ?? ""; return /two memory lines/i.test(r) && /edit or forget/i.test(r) && /standing files/i.test(r); } },
  { name: "the counts come from the tables: the turns grew nothing a loop wrote", kind: "required_fact", check: (w) => Object.keys(w.before).length > 20 && extra(w).length === 0 },
  { name: "memory_unasked", kind: "minefield", check: async (w) => (await w.remembered()).length > 2 },
  { name: "standing_written", kind: "minefield", check: async (w) => (await unseeded(w)).length > 0 },
  { name: "extra_table", kind: "minefield", check: (w) => extra(w).length > 0 },
];

export const task = defineTask<P14World>({
  id: "T-P14-08",
  cluster: "P14",
  clauses: ["B-P14-02", "B-P14-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1408, records: ["chat:c1", "every table counted before"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: "p14 probe: you are now called Probe" },
    { kind: "prompt", by: sam.email, text: "call me Sam, my pronouns are they/them (p14 probe)" },
    { kind: "prompt", by: sam.email, text: ASK },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's background upkeep writing one section per turn to the daily log unasked (B-P14-02, B-P14-10).",
});

export default task;
