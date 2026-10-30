// T-P6-08 (B-P6-01, B-P6-13): a second chat of Sam's reads the shared memory by search, with citations, and never c1's
// transcript; a sub-agent gets no memory (delta 5). fletch's shape: the sub-agent is run as its facet runs it
// (`runSubAgent`), offered the production `subAgentReads`, which hold no memory tool, and, as the M7.2 wiring did, the
// memory reads besides: its gate refuses `memory_search` by code (`SUBAGENT_MEMORY_REFUSED`) and Sam's memory store
// is never called. Its brief is what c2's reply found, as the main agent would write it.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { citationsIn, type P6World, PAT_FACT, replyOf, resolves, SAM_FACT } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

/** What Sam said in c1 before this task: the words a read of c1's transcript would carry. */
export const SAID_IN_C1 = `remember that ${PAT_FACT}, and that ${SAM_FACT}`;
export const PROMPT = "what do you know about Pat Solo and Sam Solo?";
export const BRIEF = "Find what the person's memory says about Pat Solo and Sam Solo, and report it with citations.";

const cites = (w: P6World) => citationsIn(replyOf(w, "c2"));
const lineOf = (w: P6World, fact: string) => w.lines().find((l) => l.text === fact)?.citation ?? "-";

export const task = defineTask<P6World>({
  id: "T-P6-08",
  cluster: "P6",
  clauses: ["B-P6-01", "B-P6-13"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 8, records: ["the Pat and Sam lines as claims, said in chat:c1", "chat:c2 (fresh)", "a sub-agent spawned from c2"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: PROMPT },
    { kind: "event", name: "subagent", payload: { brief: BRIEF, offer: "memory" } },
  ],
  end_state: [
    "c2's reply cites both lines from memory",
    "c2's model was never sent c1's transcript, and called only memory tools",
    "the sub-agent is offered no memory tool by the production wiring",
    "the sub-agent's memory_search is refused by code and never reaches Sam's memory",
  ],
  required_facts: ["both citations resolve"],
  minefields: ["transcript_read", "subagent_read_memory", "uncited_claim"],
  collateral: {
    journal: ["message:c2:1:you", "message:c2:2:agent", "turn:c2:1", "mail:c2:1:user"],
    // The day rendered when its cited line is read (memory_get renders a buffered day first).
    r2: ["person/sam%40solo-sam.example/memory/2026-10-13.md"],
  },
  graders: [
    { name: "c2's reply cites both lines from memory", kind: "end_state", check: (w) => cites(w).includes(lineOf(w, PAT_FACT)) && cites(w).includes(lineOf(w, SAM_FACT)) },
    {
      name: "c2's model was never sent c1's transcript, and called only memory tools",
      kind: "end_state",
      check: (w) => !w.sentIn("c2").some((m) => m.includes(SAID_IN_C1)) && w.rows("c2").flatMap((r) => r.calls).length > 0 && w.rows("c2").flatMap((r) => r.calls).every((c) => c.startsWith("memory_")),
    },
    { name: "the sub-agent is offered no memory tool by the production wiring", kind: "end_state", check: (w) => ((s) => !!s && !s.offered.some((t) => t.startsWith("memory_")))(w.subagent()) },
    {
      name: "the sub-agent's memory_search is refused by code and never reaches Sam's memory",
      kind: "end_state",
      check: (w) => ((s) => !!s && s.results.length === 1 && s.results[0]!.tool === "memory_search" && s.results[0]!.code === "SUBAGENT_MEMORY_REFUSED" && s.memoryCalls === 0)(w.subagent()),
    },
    { name: "both citations resolve", kind: "required_fact", check: async (w) => (await resolves(w, lineOf(w, PAT_FACT), PAT_FACT)) && (await resolves(w, lineOf(w, SAM_FACT), SAM_FACT)) },
    { name: "transcript_read", kind: "minefield", check: (w) => w.sentIn("c2").some((m) => m.includes(SAID_IN_C1)) },
    { name: "subagent_read_memory", kind: "minefield", check: (w) => ((s) => !s || s.memoryCalls > 0 || s.results.some((r) => r.tool.startsWith("memory_") && r.code === null) || /plain text|Thursdays/.test(s.handoff))(w.subagent()) },
    { name: "uncited_claim", kind: "minefield", check: (w) => /Pat Solo|Sam Solo/.test(replyOf(w, "c2")) && cites(w).length === 0 },
  ],
  reference: "Muse's side chat B read the shared file at once and a sub-agent inherits it at spawn (B-P6-13).",
});

export default task;
