// T-P6-02 (B-P6-01, B-P6-03): a fresh chat recalls a fact from memory with the line's citation, while the semantic leg
// is down and the keyword leg is current. fletch's shape: the keyword index is written in the line's own transaction,
// so it never lags; the lag that remains (the vector leg) is said in the result by code, never answered as complete.
// The fact reaches c2 through memory_search and memory_get only: c2's model is never sent c1's transcript.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { citationsIn, type P6World, PAT_FACT, replyOf, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

/** What Sam said in c1 before this task: the words a read of c1's transcript would carry. */
export const SAID_IN_C1 = "remember that Pat Solo prefers plain text over PDFs";
export const PROMPT = "what do you know about Pat Solo?";

const searched = (w: P6World) => resultsOf(w, "memory_search", "c2")[0]?.text ?? "";
const searchCite = (w: P6World) => citationsIn(searched(w))[0] ?? "";

export const task = defineTask<P6World>({
  id: "T-P6-02",
  cluster: "P6",
  clauses: ["B-P6-01", "B-P6-03"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 2, records: ["chat:c1 after T-P6-01's write", "the semantic leg down, the keyword leg current", "chat:c2 (fresh)"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: PROMPT }],
  end_state: [
    "the turn searched memory before it answered, and read the cited line",
    "the search said its semantic leg was unavailable and its keyword leg found the line",
    "the reply quotes the fact with its memory/<date>.md#L<n> citation",
    "c2's model was never sent c1's transcript, and called only memory tools",
  ],
  required_facts: ["the citation in the reply equals the one memory_search returned"],
  minefields: ["transcript_read", "no_citation", "stale_absence"],
  collateral: {
    journal: ["message:c2:1:you", "message:c2:2:agent", "turn:c2:1", "mail:c2:1:user"],
    // The day rendered when its cited line is read (memory_get renders a buffered day first).
    r2: ["person/sam%40solo-sam.example/memory/2026-10-13.md"],
  },
  graders: [
    {
      name: "the turn searched memory before it answered, and read the cited line",
      kind: "end_state",
      check: (w) => {
        const rows = w.rows("c2");
        const search = rows.findIndex((r) => r.role === "toolResult" && r.tool === "memory_search");
        const get = rows.findIndex((r) => r.role === "toolResult" && r.tool === "memory_get");
        const reply = rows.findIndex((r) => r.role === "assistant" && r.text.trim() !== "" && r.calls.length === 0);
        return search >= 0 && get > search && reply > get && (rows[get]?.text ?? "").includes(PAT_FACT);
      },
    },
    {
      name: "the search said its semantic leg was unavailable and its keyword leg found the line",
      kind: "end_state",
      check: (w) => /Semantic search unavailable \([A-Z_]+\)/.test(searched(w)) && searched(w).includes(PAT_FACT) && /^memory\/\d{4}-\d{2}-\d{2}\.md#L\d+$/.test(searchCite(w)),
    },
    { name: "the reply quotes the fact with its memory/<date>.md#L<n> citation", kind: "end_state", check: (w) => replyOf(w, "c2").includes(PAT_FACT) && citationsIn(replyOf(w, "c2")).some((c) => /^memory\/\d{4}-\d{2}-\d{2}\.md#L\d+$/.test(c)) },
    {
      name: "c2's model was never sent c1's transcript, and called only memory tools",
      kind: "end_state",
      check: (w) => !w.sentIn("c2").some((m) => m.includes(SAID_IN_C1)) && w.rows("c2").flatMap((r) => r.calls).every((c) => c.startsWith("memory_")),
    },
    { name: "the citation in the reply equals the one memory_search returned", kind: "required_fact", check: (w) => searchCite(w) !== "" && citationsIn(replyOf(w, "c2")).includes(searchCite(w)) },
    { name: "transcript_read", kind: "minefield", check: (w) => w.sentIn("c2").some((m) => m.includes(SAID_IN_C1)) },
    { name: "no_citation", kind: "minefield", check: (w) => citationsIn(replyOf(w, "c2")).length === 0 },
    { name: "stale_absence", kind: "minefield", check: (w) => /\b(no record|don['’]t know|nothing (saved|stored|in memory))\b/i.test(replyOf(w, "c2")) && w.lines().some((l) => l.text.includes(PAT_FACT)) },
  ],
  reference: "Muse's search missed a five-minute-old line and its file read found it, cited (B-P6-03).",
});

export default task;
