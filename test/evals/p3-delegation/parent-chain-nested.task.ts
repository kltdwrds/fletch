// T-P3-09 (B-P3-09): the parent chain is readable. A coordinator in c1 fans out to two workers at depth 2; they run and
// hand off; Sam opens the task. The drawer's section draws the coordinator, then its two workers under it by the rows'
// parent and depth (F14's nesting, each worker's line marked with its depth and indented), each with its own status
// words and steps; at phone width the same tree. The chain comes from the rows, never from the model's prose.
import { defineTask, type Grader } from "../../support/task.ts";
import type { DrawnSection, P3World } from "./world.ts";
import { newestTask, PROBE } from "./world.ts";

export const ASK = `Have a coordinator split reading ${PROBE} between two workers: its title and its links.`;
const drawn = async (w: P3World, phone = false): Promise<DrawnSection[]> => {
  const t = await newestTask(w);
  return t ? w.sections("c1", t.id, phone) : [];
};
/** The drawn rows match the stored rows: the same ids parent first, each at its stored depth, with steps. */
const tree = (w: P3World, s: DrawnSection[]) => {
  const rows = w.children("c1");
  const coord = rows.find((r) => r.role === "coordinator");
  const drawnRows = s.flatMap((x) => x.rows);
  return s.length === 1 && !!coord && drawnRows[0]?.id === coord.id && drawnRows.length === 3 && drawnRows.every((d) => {
    const r = rows.find((x) => x.id === d.id);
    return !!r && d.depth === r.depth && (r.depth === 1 || r.parent === coord.id) && d.steps.length > 0 && /Done/.test(d.line);
  });
};

const graders: Grader<P3World>[] = [
  { name: "the section draws the coordinator, then its two workers under it by depth, each with its status and steps", kind: "end_state", check: async (w) => tree(w, await drawn(w)) },
  { name: "the same tree at phone width", kind: "end_state", check: async (w) => tree(w, await drawn(w, true)) },
  { name: "the chain comes from the rows' parent and depth, not the model's prose", kind: "required_fact", check: async (w) => {
    const ids = (await drawn(w)).flatMap((s) => s.rows.map((r) => r.id));
    return ids.length === w.children("c1").length && w.children("c1").every((r) => ids.includes(r.id)) && w.children("c1").filter((r) => r.depth === 2).length === 2;
  } },
  { name: "flat_chain", kind: "minefield", check: async (w) => (await drawn(w)).some((s) => s.rows.some((r, i) => i > 0 && r.depth !== 2)) },
  { name: "chain_from_prose", kind: "minefield", check: async (w) => (await drawn(w)).some((s) => s.rows.some((r) => !w.children("c1").some((x) => x.id === r.id))) },
  { name: "missing_grandchild", kind: "minefield", check: async (w) => (await drawn(w)).flatMap((s) => s.rows).filter((r) => r.depth === 2).length < 2 },
];

export const task = defineTask<P3World>({
  id: "T-P3-09",
  cluster: "P3",
  clauses: ["B-P3-09"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 309, records: ["chat:c1", "the probe page", "a coordinator with two workers"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's nested dialog drew SUBAGENT 01 and 02 side by side, the grandchild not under the coordinator (B-P3-09).",
});

export default task;
