// T-P16-12 (B-P16-13), tier 2: what a shopping conversation drew survives a reload and reads the same at phone width.
// T-P16-02 played on a slot (F81), then a reload and a reload at 375 wide: the same transcript rows, ids and order after
// each. It reads the slot's pages (`P16SlotWorld`, the browser harness of P1) and has no tier-1 run.
import type { Grader } from "../../support/task.ts";
import { p16Task, says } from "./kit.ts";
import type { P16SlotWorld } from "./world.ts";
import { SHOP } from "./world.ts";

const same = async (w: P16SlotWorld) => {
  const r = await w.reloads();
  const first = r[0];
  return r.length === 3 && first !== undefined && first.ids.length > 0 && r.every((x) => JSON.stringify(x.ids) === JSON.stringify(first.ids) && JSON.stringify(x.texts) === JSON.stringify(first.texts));
};

const graders: Grader<P16SlotWorld>[] = [
  { name: "the same transcript rows, ids and order after each reload, at desktop and at 375 wide", kind: "end_state", check: same },
  { name: "rows_lost_on_reload", kind: "minefield", check: async (w) => !(await same(w)) },
];

export default p16Task<P16SlotWorld>({
  id: "T-P16-12",
  clauses: ["B-P16-13"],
  priority: "nice-to-have",
  tier: 2,
  seed: 1612,
  records: ["chat:c1", `site:${SHOP}`],
  turns: [says(`compare the 1-litre stainless bottles under $30 at ${SHOP} (p16 probe)`), { kind: "event", name: "reload" }, { kind: "event", name: "reload", payload: { width: "375" } }],
  graders,
  reference: "`step-9-dom.md`: five reloads, the same ids (B-P16-13).",
});
