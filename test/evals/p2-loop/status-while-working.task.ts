// T-P2-04 (B-P2-04): while a tool runs, the page shows a status under the agent's avatar in words (never the tool's
// identifier) and no bubble; after the turn, none. The status line is F24's (Translation, delta 6); its page test
// lands with it. Muse's `browser.search` is fletch's `web_search` here; the wording map is fletch's own.
import { defineTask } from "../../support/task.ts";
import type { LoopPageWorld } from "./page-world.ts";

export const TOOL = "web_search";
const at = (w: LoopPageWorld, after: string) => w.seen().find((s) => s.after === after);

export const task = defineTask<LoopPageWorld>({
  id: "T-P2-04",
  cluster: "P2",
  clauses: ["B-P2-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 4, records: ["page:chat:c1 with Sam's m1 and a turn in progress whose running tool is web_search"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "status", payload: { tool: TOOL } },
    { kind: "event", name: "turn_done" },
  ],
  end_state: ["while the tool runs a status names the activity in words and no bubble is drawn", "after the turn ends no status is shown"],
  required_facts: [],
  minefields: ["status_from_text", "status_outlives_turn"],
  collateral: {},
  graders: [
    {
      name: "while the tool runs a status names the activity in words and no bubble is drawn",
      kind: "end_state",
      check: (w) => {
        const s = at(w, "status");
        const words = s?.working.status ?? "";
        return words.length > 0 && !words.includes(TOOL) && !/[_.]/.test(words) && w.drawn().filter((d) => d.kind === "agent").length === 0;
      },
    },
    { name: "after the turn ends no status is shown", kind: "end_state", check: (w) => at(w, "turn_done")?.working.status === null },
    {
      name: "status_from_text",
      kind: "minefield",
      check: (w) => {
        const words = at(w, "status")?.working.status ?? "";
        return words.length > 0 && w.frames().some((f) => (f.type === "message" || f.type === "delta") && String(f.text ?? "").includes(words));
      },
    },
    { name: "status_outlives_turn", kind: "minefield", check: (w) => at(w, "turn_done")?.working.status !== null },
  ],
  reference: "Muse `step-2-working.png` (\"Searching docs\"), `answers/step-2.md` 4; the wording map is fletch's own (Translation, delta 6).",
});

export default task;
