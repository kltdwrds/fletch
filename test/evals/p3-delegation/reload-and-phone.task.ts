// T-P3-17 (B-P3-14): tier 2 on a slot (`pnpm evals P3`, F34): after a delegation that reported and one that was
// stopped, the thread is reloaded and the drawer opened at desktop and phone width. Every entry comes back with the
// same id, the stopped entry among them; the drawer's rows say what the stored rows say; at phone width the sections
// and the stopped entry are still drawn. Under the scripted fake its graders answer as shipped fletch does
// (`tier2-fake.test.ts`).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World } from "./world.ts";
import { PROBE, PROBE_2 } from "./world.ts";

export const ASK = `Have a sub-agent read ${PROBE} for its title.`;
export const ASK_TWO = `Have a sub-agent read ${PROBE} then ${PROBE_2} for their titles.`;
const STATUS_WORD: Record<string, RegExp> = { done: /\bDone\b/, failed: /\bFailed\b/ };
const rowsAgree = async (w: P3World, phone: boolean) => {
  for (const t of (await w.activity()).tasks.filter((x) => x.chat === "c1" && x.groups.length)) {
    for (const r of (await w.sections("c1", t.id, phone)).flatMap((s) => s.rows)) {
      const c = w.children("c1").find((x) => x.id === r.id);
      if (!c || !STATUS_WORD[c.status]?.test(r.line)) return false;
    }
  }
  return true;
};
const drawnCount = async (w: P3World, phone: boolean) => {
  let n = 0;
  for (const t of (await w.activity()).tasks.filter((x) => x.chat === "c1")) n += (await w.sections("c1", t.id, phone)).flatMap((s) => s.rows).length;
  return n;
};

const graders: Grader<P3World>[] = [
  { name: "every entry is back with the same id after the reload, the stopped entry among them", kind: "end_state", check: (w) => !!w.reloaded && JSON.stringify(w.entryIds("c1")) === JSON.stringify(w.reloaded.entries) && w.entryIds("c1").some((e) => e.startsWith("stopped:")) },
  { name: "the rows are as they stood, and the drawer says what the stored rows say", kind: "end_state", check: async (w) => !!w.reloaded && JSON.stringify(w.children("c1").map((c) => `${c.id}:${c.status}:${c.code ?? ""}`)) === JSON.stringify(w.reloaded.statuses) && (await rowsAgree(w, false)) },
  { name: "at phone width the sections and the stopped entry are drawn", kind: "end_state", check: async (w) => (await rowsAgree(w, true)) && (await drawnCount(w, true)) === w.children("c1").length && (await w.threadDom("c1", true)).kinds.some((k) => k.split(" ").includes("stopped")) },
  { name: "the thread and the drawer are read from the stores on every load", kind: "required_fact", check: async (w) => (await drawnCount(w, false)) === w.children("c1").length },
  { name: "stop_entry_lost", kind: "minefield", check: (w) => !w.entryIds("c1").some((e) => e.startsWith("stopped:")) },
  { name: "status_optimistic", kind: "minefield", check: async (w) => !(await rowsAgree(w, false)) },
  { name: "section_lost", kind: "minefield", check: async (w) => (await drawnCount(w, false)) < w.children("c1").length },
  { name: "overflow_at_phone", kind: "minefield", check: async (w) => (await drawnCount(w, true)) < w.children("c1").length },
];

export const task = defineTask<P3World>({
  id: "T-P3-17",
  cluster: "P3",
  clauses: ["B-P3-14"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 317, records: ["chat:c1 on the slot", "a delegation that reported", "a delegation that was stopped"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "prompt", payload: { text: ASK_TWO, wait: "yes" } },
    { kind: "event", name: "midchild", payload: { stop: "yes" } },
    { kind: "event", name: "children" },
    { kind: "event", name: "reload" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's stopped turn with no item after reload, the stale card, two of five reactions (B-P3-14).",
});

export default task;
