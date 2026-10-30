// T-P2-02 (B-P2-02): every turn's first request opens with the operating block as its stable prefix, byte-identical
// across turns, and carries a never-stored runtime envelope before Sam's latest text that names that turn's date
// (Translation, delta 1: fletch's shape for Muse's dated system row). The clock is the harness's: 13 October, then 14.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { envelopeOf, type P2World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

/** The operating block's first line (`IDENTITY_LINES[0]` in `packages/agent/src/chat/operating-block.ts`; the test checks). */
export const BLOCK_LINE = "You are the person's own agent at their company, working for them alone.";
export const ENVELOPE = "# Runtime envelope";
export const DAY1 = "now: 2026-10-13T";
export const DAY2 = "now: 2026-10-14T";

const prefixes = (w: P2World) => w.turnStarts().map((i) => w.requests()[i]?.messages[0]);
const seen = (w: P2World) => [...w.rows().map((r) => r.text), ...w.entries().map((e) => e.text ?? ""), ...w.frames().map((f) => JSON.stringify(f))];

export const task = defineTask<P2World>({
  id: "T-P2-02",
  cluster: "P2",
  clauses: ["B-P2-02"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 2, records: ["chat:c1", "clock:2026-10-13T10:00Z, then a day on"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: "What should I focus on today?" },
    { kind: "prompt", by: sam.email, text: "And today?" },
  ],
  end_state: [
    "each turn's first request opens with the operating block, byte-identical across the two turns",
    "each turn's envelope, before Sam's latest text, names that turn's date",
    "neither the block nor the envelope is in any transcript row, entry or frame",
  ],
  required_facts: ["the second turn's envelope carries the second date, not the first"],
  minefields: ["block_in_transcript", "block_in_frame", "prefix_drift"],
  collateral: { journal: ["mail:c1:1:user", "mail:c1:2:user", "message:c1:1:you", "message:c1:2:agent", "message:c1:3:you", "message:c1:4:agent", "turn:c1:1", "turn:c1:2"] },
  graders: [
    {
      name: "each turn's first request opens with the operating block, byte-identical across the two turns",
      kind: "end_state",
      check: (w) => {
        const [a, b] = prefixes(w);
        return a?.role === "system" && a.text.includes(BLOCK_LINE) && a.text === b?.text;
      },
    },
    {
      name: "each turn's envelope, before Sam's latest text, names that turn's date",
      kind: "end_state",
      check: (w) => {
        const [a, b] = w.turnStarts().map((i) => envelopeOf(w.requests()[i]));
        return !!a?.startsWith(ENVELOPE) && a.includes(DAY1) && !!b?.startsWith(ENVELOPE) && b.includes(DAY2);
      },
    },
    { name: "neither the block nor the envelope is in any transcript row, entry or frame", kind: "end_state", check: (w) => seen(w).every((s) => !s.includes(BLOCK_LINE) && !s.includes(ENVELOPE)) },
    { name: "the second turn's envelope carries the second date, not the first", kind: "required_fact", check: (w) => ((e) => e.includes(DAY2) && !e.includes(DAY1))(envelopeOf(w.requests()[w.turnStarts()[1] ?? -1])) },
    { name: "block_in_transcript", kind: "minefield", check: (w) => w.rows().some((r) => r.text.includes(BLOCK_LINE) || r.text.includes(ENVELOPE)) },
    { name: "block_in_frame", kind: "minefield", check: (w) => w.frames().some((f) => JSON.stringify(f).includes(BLOCK_LINE) || JSON.stringify(f).includes(ENVELOPE)) },
    {
      name: "prefix_drift",
      kind: "minefield",
      check: (w) => {
        const [a, b] = prefixes(w);
        return a?.text !== b?.text;
      },
    },
  ],
  reference: "Muse step 1 (`runtime.messages:deaf909b-…` and `:0309f229-…` before the user row, `answers/step-1.md` 2; `dump/operating-block-B.md`); fletch's shape is the Translation's delta 1.",
});

export default task;
