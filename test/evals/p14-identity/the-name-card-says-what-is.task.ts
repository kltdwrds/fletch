// T-P14-09 (B-P14-01): the name card says what is. The Identity tab's card says in delta 2's words that no name is
// chosen and a chat message cannot name the agent, with no Edit control; the page's title and the manifest's names say
// `fletch`, and the handle line is still `<person>/agent`. The words are code's constants (`panel.ts`, `page.ts`).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P14World } from "./world.ts";
import { AGENT_NAME, NAME_NOTE } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const card = (w: P14World) => w.drawn[0];

const graders: Grader<P14World>[] = [
  { name: "the name card says no name is chosen and a chat message cannot name the agent, with no Edit", kind: "end_state", check: (w) => card(w)?.cardName === AGENT_NAME && card(w)?.cardNote === NAME_NOTE && !card(w)?.controls.some((c) => /\bedit\b/i.test(c)) },
  { name: "the title and the manifest's names say fletch", kind: "end_state", check: (w) => w.shell?.title === "fletch" && w.shell.manifest.every((n) => n === "fletch") && w.shell.manifest.length === 2 },
  { name: "the handle line is still <person>/agent", kind: "end_state", check: (w) => w.shell?.handle === `${sam.email}/agent` && card(w)?.handle === `${sam.email}/agent` },
  { name: "the words are code's constants", kind: "required_fact", check: (w) => card(w)?.cardNote === NAME_NOTE && card(w)?.header === AGENT_NAME },
  { name: "naming_promised", kind: "minefield", check: (w) => /\b(comes later|coming soon|will (be able|let you)|later)\b/i.test(card(w)?.cardNote ?? "later") },
  { name: "qyvr_title", kind: "minefield", check: (w) => /qyvr/i.test([w.shell?.title ?? "qyvr", ...(w.shell?.manifest ?? [])].join(" ")) },
];

export const task = defineTask<P14World>({
  id: "T-P14-09",
  cluster: "P14",
  clauses: ["B-P14-01"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 1409, records: ["the page as served to Sam"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "look", payload: { width: "desktop" } },
    { kind: "event", name: "shell" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's \"default given name until changed\" drawn from state (B-P14-01).",
});

export default task;
