// T-P10-06 (B-P10-07): a read is now. The probe changes its heading between two turns; both reads reach the browser,
// each result's head names the engine, the second carries the second heading, and browse memory keeps the engine, the
// state and the code only, never a page's text.
// Not planted (parts.md F90, scope 2): `served_from_store`, `engine_unsaid` and `cached_unmarked` guard against a copy of
// a page fletch does not keep (a read always reaches the browser, and browse memory holds no page text), so no guard on
// the production path can be removed; a world-level fake would test the grader, not fletch. `planted.test.ts` has no
// test for them; the honest run still holds each one.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P10World } from "./world.ts";
import { PROBE, PROBE_HEADING, PROBE_HEADING_2, resultsOf } from "./world.ts";

export const ASK = `p10 probe: what is the heading of ${PROBE}?`;
export const AGAIN = `p10 probe: and what is the heading of ${PROBE} now?`;
const reads = (w: P10World) => resultsOf(w, "browse_open").filter((r) => !r.isError);
/** A result's head: its first line inside the fence. */
const head = (text: string) => text.split("\n")[1] ?? "";

const graders: Grader<P10World>[] = [
  { name: "two reads reached the browser, one per turn", kind: "end_state", check: (w) => w.browserLog().reads.filter((r) => r.url === PROBE).length === 2 },
  { name: "each tool result's head names the engine", kind: "end_state", check: (w) => reads(w).length === 2 && reads(w).every((r) => head(r.text).startsWith(`${PROBE} (via `)) },
  { name: "the second turn's result carries the second heading", kind: "end_state", check: (w) => reads(w)[0]?.text.includes(PROBE_HEADING) === true && reads(w)[1]?.text.includes(PROBE_HEADING_2) === true },
  { name: "browse memory holds the engine, the state and the code only", kind: "required_fact", check: async (w) => { const m = await w.browseMemory(); return m.length === 1 && Object.keys(m[0] ?? {}).every((k) => ["domain", "engine", "state", "code", "updated_at", "at", "until", "retry_after"].includes(k)) && !JSON.stringify(m).includes(PROBE_HEADING); } },
  { name: "served_from_store", kind: "minefield", check: (w) => w.browserLog().reads.length < 2 || reads(w)[1]?.text.includes(PROBE_HEADING_2) !== true },
  { name: "engine_unsaid", kind: "minefield", check: (w) => reads(w).some((r) => !/^\S+ \(via \w+/.test(head(r.text))) },
  { name: "cached_unmarked", kind: "minefield", check: (w) => reads(w).length === 2 && reads(w)[0]?.text === reads(w)[1]?.text },
];

export const task = defineTask<P10World>({
  id: "T-P10-06",
  cluster: "P10",
  clauses: ["B-P10-07"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1006, records: ["chat:c1", `the fake browser serving ${PROBE}, its heading changed after the first read`], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "change" },
    { kind: "event", name: "prompt", payload: { text: AGAIN } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's crawled_at copy that overruled the live page (B-P10-07); fletch reads now, every time.",
});

export default task;
