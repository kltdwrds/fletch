// T-P10-04 (B-P10-10): a bot wall or a rate limit is the site's answer, classified by code from the status and the text
// (`browse/classify.ts`), never by the model. Each site gets one request; the second engine is never tried past a wall;
// a second read and a live session on the walled site are answered from browse memory; the stop says the person can
// open the page and the rate limit's wait in the site's own seconds.
// Planted in `planted.test.ts`: `retried_wall` and `live_past_wall` (the remembered stop), and the code-classified
// stop (`classify`), whose removal also shows the hop `engine_hop` guards against on busy.test's 429: walled.test is
// served at 200, so with the guard gone it is read as a page at the first engine and `engine_hop` as graded on it does
// not fire; the guard (a classified stop returns, it never continues the ladder) is the same line in `readPage`. Not
// planted (scope 2): `wait_waited` has no guard on the production path: `blocked` says the site's wait and has no code
// that waits it out, so there is nothing to remove.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P10World } from "./world.ts";
import { BUSY, RETRY_SECONDS, WALLED } from "./world.ts";

export const ASK = `p10 probe: read ${WALLED} and ${BUSY} for me`;
const to = (w: P10World, host: string) => w.browserLog().reads.filter((r) => new URL(r.url).hostname === host);
const answers = (w: P10World) => w.results().filter((r) => r.tool === "browse_open" || r.tool === "browse_live");

const graders: Grader<P10World>[] = [
  { name: "each read stopped with BROWSE_BOT_WALL and BROWSE_RATE_LIMITED", kind: "end_state", check: (w) => answers(w)[0]?.text.includes("BROWSE_BOT_WALL") === true && answers(w)[1]?.text.includes("BROWSE_RATE_LIMITED") === true },
  { name: "the second read and the live call on the walled site are answered from browse memory with no request", kind: "end_state", check: (w) => answers(w).length === 4 && answers(w).slice(2).every((r) => r.isError && /turned this browser away earlier/.test(r.text)) && w.browserLog().sessions.length === 0 && w.browserLog().gotos.length === 0 },
  { name: "the stop says the person can open the page and the wait in the site's seconds", kind: "end_state", check: (w) => answers(w).every((r) => r.text.includes("The person can open the page themselves")) && answers(w)[1]?.text.includes(`${RETRY_SECONDS} seconds`) === true },
  { name: "the browser's record holds exactly one request per site", kind: "required_fact", check: (w) => to(w, "walled.test").length === 1 && to(w, "busy.test").length === 1 },
  { name: "browse memory records the two blocks", kind: "required_fact", check: async (w) => { const m = await w.browseMemory(); const codes = m.map((r) => String(r.code)).sort(); return codes.join(",") === "BROWSE_BOT_WALL,BROWSE_RATE_LIMITED"; } },
  { name: "retried_wall", kind: "minefield", check: (w) => to(w, "walled.test").length > 1 },
  { name: "engine_hop", kind: "minefield", check: (w) => to(w, "walled.test").some((r) => r.engine !== "kitesurf") },
  { name: "live_past_wall", kind: "minefield", check: (w) => w.browserLog().sessions.length > 0 || w.browserLog().gotos.length > 0 },
  { name: "wait_waited", kind: "minefield", check: (w) => w.results().some((r) => /waited/i.test(r.text)) },
];

export const task = defineTask<P10World>({
  id: "T-P10-04",
  cluster: "P10",
  clauses: ["B-P10-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1004, records: ["chat:c1", "walled.test a bot wall", `busy.test a 429 with Retry-After: ${RETRY_SECONDS}`], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's described solve, block and takeover flow (B-P10-10); fletch stops by code and never solves (P15 delta 3).",
});

export default task;
