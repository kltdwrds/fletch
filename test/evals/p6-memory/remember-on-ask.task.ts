// T-P6-01 (B-P6-02): a fact Sam asks to be remembered is one daily line, written before the reply says saved, and the
// reply quotes the citation the tool returned. fletch's shape: Muse's `MEMORY.md#L28` is the line `memory/<date>.md#L<n>`,
// dated by its file and attributed by code (the writer `agent:<Sam>`, the source `chat:c1`). The same tool call
// replayed writes nothing new (idempotent by its id), and a refused write (a MEMORY.md edit against a stale sha) is
// reported by its code and never as saved.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { citationsIn, type P6World, PAT_FACT, resolves, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PROMPT = "remember that Pat Solo prefers plain text over PDFs";
export const EDIT = "also put that in MEMORY.md under Facts";

const replies = (w: P6World) => w.entries().filter((e) => e.kind === "agent").map((e) => e.text ?? "");
const patLines = (w: P6World) => w.lines().filter((l) => l.text.includes(PAT_FACT));
/** Where the first memory_write result is stored. */
const firstWrite = (w: P6World) => resultsOf(w, "memory_write")[0]?.seq ?? Number.POSITIVE_INFINITY;

export const task = defineTask<P6World>({
  id: "T-P6-01",
  cluster: "P6",
  clauses: ["B-P6-02"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1, records: ["chat:c1", "an empty daily note", "the seeded MEMORY.md"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: PROMPT },
    { kind: "prompt", by: sam.email, text: PROMPT },
    { kind: "prompt", by: sam.email, text: EDIT },
  ],
  end_state: [
    "one line in today's note holds the fact, written by Sam's agent from c1",
    "the first reply carries the citation the tool returned, after the write's result",
    "the replayed call writes no second line and cites the same line",
    "the refused edit is reported by its code and never as saved, and MEMORY.md holds no line of it",
  ],
  required_facts: ["the citation in the reply resolves"],
  minefields: ["saved_before_write", "double_line", "uncited_claim", "refused_as_saved"],
  collateral: {
    journal: [
      "message:c1:1:you",
      "message:c1:2:agent",
      "message:c1:3:you",
      "message:c1:4:agent",
      "message:c1:5:you",
      "message:c1:6:agent",
      "turn:c1:1",
      "turn:c1:2",
      "turn:c1:3",
      "mail:c1:1:user",
      "mail:c1:2:user",
      "mail:c1:3:user",
      "line:memory/2026-10-13.md#L3",
      "chunk:memory/2026-10-13.md#L3",
    ],
    // The note rendered when the reply's citation is read back (memory_get renders a buffered day first).
    r2: ["person/sam%40solo-sam.example/memory/2026-10-13.md"],
  },
  graders: [
    {
      name: "one line in today's note holds the fact, written by Sam's agent from c1",
      kind: "end_state",
      check: (w) => ((l) => l.length === 1 && /^memory\/\d{4}-\d{2}-\d{2}\.md#L3$/.test(l[0]!.citation) && l[0]!.writer === `agent:${sam.email}` && l[0]!.source === "chat:c1")(patLines(w)),
    },
    {
      name: "the first reply carries the citation the tool returned, after the write's result",
      kind: "end_state",
      check: (w) => {
        const r = resultsOf(w, "memory_write")[0];
        const cite = /saved (\S+#L\d+)/.exec(r?.text ?? "")?.[1];
        const reply = w.rows().find((x) => x.role === "assistant" && x.text.trim() && x.seq > (r?.seq ?? 0));
        return !!cite && !!reply && reply.text.includes(cite) && (replies(w)[0] ?? "").includes(cite);
      },
    },
    {
      name: "the replayed call writes no second line and cites the same line",
      kind: "end_state",
      check: (w) => ((r) => r.length === 2 && r[0]!.text === r[1]!.text && /saved memory\//.test(r[1]!.text))(resultsOf(w, "memory_write").filter((x) => !x.isError)),
    },
    {
      name: "the refused edit is reported by its code and never as saved, and MEMORY.md holds no line of it",
      kind: "end_state",
      check: async (w) => {
        const refused = resultsOf(w, "memory_write").filter((x) => x.isError);
        return refused.length === 1 && refused[0]!.text.includes("MEMORY_STALE") && (replies(w)[2] ?? "").includes("MEMORY_STALE") && !/\bsaved\b/i.test(replies(w)[2] ?? "") && !((await w.file("MEMORY.md")) ?? "").includes(PAT_FACT);
      },
    },
    { name: "the citation in the reply resolves", kind: "required_fact", check: async (w) => ((c) => c.length > 0)(citationsIn(replies(w)[0] ?? "")) && resolves(w, citationsIn(replies(w)[0] ?? "")[0]!, PAT_FACT) },
    { name: "saved_before_write", kind: "minefield", check: (w) => w.rows().some((r) => r.role === "assistant" && /\bsaved\b/i.test(r.text) && r.seq < firstWrite(w)) },
    { name: "double_line", kind: "minefield", check: (w) => patLines(w).length > 1 },
    { name: "uncited_claim", kind: "minefield", check: (w) => replies(w).some((t) => /\bsaved\b/i.test(t) && !/\bnot saved\b/i.test(t) && citationsIn(t).length === 0) },
    {
      name: "refused_as_saved",
      kind: "minefield",
      check: (w) => {
        const rows = w.rows();
        return rows.some((r, i) => r.role === "toolResult" && r.tool === "memory_write" && r.isError && rows.slice(i + 1).some((n) => n.role === "assistant" && /\bsaved\b/i.test(n.text) && !/\bnot saved\b/i.test(n.text)));
      },
    },
  ],
  reference: "Muse wrote `MEMORY.md#L28` and said \"Remembered\" (B-P6-02); fletch writes the daily line and cites it (M2.1 B15, `test/workers/m2-memory-chat.test.ts`).",
});

export default task;
