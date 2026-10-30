// T-P2-01 (B-P2-01, B-P2-13): a deferred namespace is loaded once, in the turn that first needs it, and its schema
// stays for the rest of the chat. Muse's journal row of the load is fletch's stored `tool_search` result and the
// chat's loaded set (`namespace:c1:probe`); the probe is a test-host fixture (`test/support/p2-fixtures.ts`).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { type P2World, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PROBE = "probe_run";

/** Each assistant row is the answer to the request of the same index: a single chat, one row per request. */
const answered = (w: P2World) => w.rows().filter((r) => r.role === "assistant");

export const task = defineTask<P2World>({
  id: "T-P2-01",
  cluster: "P2",
  clauses: ["B-P2-01", "B-P2-13"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1, records: ["chat:c1", "namespace:probe (deferred, one function)"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: "Take a probe reading for me." },
    { kind: "prompt", by: sam.email, text: "Take another reading." },
  ],
  end_state: ["the first turn's second request carries the probe schema and its first did not", "the second turn's first request already carries it", "one load of the probe, never two"],
  required_facts: ["the load's result names the functions it loaded"],
  minefields: ["eager_everything", "unloaded_call"],
  collateral: { journal: ["mail:c1:1:user", "mail:c1:2:user", "message:c1:1:you", "message:c1:2:agent", "message:c1:3:you", "message:c1:4:agent", "turn:c1:1", "turn:c1:2", "namespace:c1:probe"] },
  graders: [
    {
      name: "the first turn's second request carries the probe schema and its first did not",
      kind: "end_state",
      check: (w) => {
        const [first] = w.turnStarts();
        const r = w.requests();
        return first !== undefined && !r[first]?.schemas.includes(PROBE) && r[first + 1]?.schemas.includes(PROBE) === true;
      },
    },
    {
      name: "the second turn's first request already carries it",
      kind: "end_state",
      check: (w) => {
        const second = w.turnStarts()[1];
        return second !== undefined && w.requests()[second]?.schemas.includes(PROBE) === true;
      },
    },
    {
      name: "one load of the probe, never two",
      kind: "end_state",
      check: (w) => resultsOf(w, "tool_search").filter((r) => /\bloaded [^:]*\bprobe\b/.test(r.text)).length === 1 && w.loaded().includes("probe"),
    },
    { name: "the load's result names the functions it loaded", kind: "required_fact", check: (w) => resultsOf(w, "tool_search").some((r) => /\bloaded [^:]*\bprobe\b/.test(r.text) && r.text.includes(PROBE)) },
    { name: "eager_everything", kind: "minefield", check: (w) => w.requests()[w.turnStarts()[0] ?? 0]?.schemas.includes(PROBE) === true },
    {
      name: "unloaded_call",
      kind: "minefield",
      check: (w) => {
        const r = w.requests();
        return answered(w).some((row, i) => row.calls.includes(PROBE) && !r[i]?.schemas.includes(PROBE));
      },
    },
  ],
  reference: "Muse step 3 (`answers/step-3.md` 1, calls 3 and 7: `load_tool_namespace` once) and step 2 (no reload, `answers/step-2.md` 1).",
});

export default task;
