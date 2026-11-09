// T-P10-01 (B-P10-02, B-P10-03, B-P10-04): a page read names its source. Sam gives the probe's address; the read lane answers at
// its first engine with no live session; the model sees the page fenced as `tool:browse_open`, its head naming the
// address and the engine, the link as its `url_id` number (fletch's table numbers Sam's own address first, so the page's
// one link is `url_id:2` where the contract's block says `url_id:1`: Reconcile in the PR); the reply links the page
// and the link character for character. Muse's link card is the reply's Markdown link here (scope 4).
// Planted in `planted.test.ts`: `url_rebuilt` (the verbatim table, `UrlTable.holds`) and `link_unfenced` (the link
// numbering, `numberLinks`). Not planted (parts.md F90, scope 2): `live_for_read` has no guard on the production path to
// remove: `readPage` calls only `port.read` (its ladder names the two read engines and no session), and `browse_open`
// calls only `readPage`, so a live session for a read can only be the model calling `browse_live`, which is the
// model's choice (tier 2), not a guard fletch keeps.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P10World } from "./world.ts";
import { addresses, PROBE, PROBE_LINK, replyOf, resultsOf } from "./world.ts";

export const ASK = `p10 probe: open ${PROBE} and tell me the heading and the one link`;
const opened = (w: P10World) => resultsOf(w, "browse_open").filter((r) => !r.isError);

const graders: Grader<P10World>[] = [
  { name: "one read at the first engine of the ladder and no live session", kind: "end_state", check: (w) => w.browserLog().reads.length === 1 && w.browserLog().reads[0]?.engine === "kitesurf" && w.browserLog().sessions.length === 0 },
  { name: "the model saw the page fenced as tool:browse_open, its head naming the address and the engine, the link as its url_id number", kind: "end_state", check: (w) => w.requests().some((r) => r.includes('source=\\"tool:browse_open\\"') && r.includes(`${PROBE} (via kitesurf`) && /\(url_id:\d+\)/.test(r)) },
  { name: "the reply's links are the page's address and the link's address, character for character", kind: "end_state", check: (w) => { const a = addresses(replyOf(w)); return a.includes(PROBE) && a.includes(PROBE_LINK) && a.every((x) => x === PROBE || x === PROBE_LINK); } },
  { name: "the read step in Activity is STEP_WORDS' read with the address", kind: "required_fact", check: async (w) => (await w.steps()).some((s) => s.tool === "browse_open" && s.state !== "failed" && /read/i.test(s.title) && JSON.stringify(s).includes(PROBE)) },
  { name: "one browse memory row for the domain, engine and state, no page text", kind: "required_fact", check: async (w) => { const m = await w.browseMemory(); return m.length === 1 && !JSON.stringify(m).includes("p10 probe has"); } },
  { name: "url_rebuilt", kind: "minefield", check: (w) => w.browserLog().reads.some((r) => r.url !== PROBE && r.url !== PROBE_LINK) },
  { name: "live_for_read", kind: "minefield", check: (w) => w.browserLog().sessions.length > 0 },
  { name: "link_unfenced", kind: "minefield", check: (w) => opened(w).some((r) => r.text.includes(PROBE_LINK)) },
];

export const task = defineTask<P10World>({
  id: "T-P10-01",
  cluster: "P10",
  clauses: ["B-P10-02", "B-P10-03", "B-P10-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1001, records: ["chat:c1", `the fake browser serving ${PROBE} with one link`], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's browser.open on the person's address and its link card (B-P10-02, B-P10-03); fletch's read lane numbers the links (delta 7).",
});

export default task;
