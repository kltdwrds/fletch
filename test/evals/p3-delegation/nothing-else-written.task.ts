// T-P3-13 (B-P3-03, B-P3-13): a delegation writes only what the person can see. Sam asks c1 for two delegations, one of them a
// coordinator with two workers and one child failing its read, then one more; every child settles and the handoffs
// reply. Every table of every Durable Object the world built is counted before and after (`tables()`, the schema's own
// setup tables aside), and the diff holds only: the transcript turns and their effects, the `subagents` and
// `subagent_groups` rows, the mailbox's `internal_handoff` rows, each child's facet transcript, the Ledger's model-call
// rows, and the empty MEMORY.md scaffold's heading lines that Sam's first turn indexes (no memory content). No memory
// row, reaction, file or journal row; the sub-agent rows bounded by MAX_OPEN; the drawer draws every row diffed.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P3World } from "./world.ts";

export const ASKS = ["Have one sub-agent read https://example.invalid/p3-probe, and a coordinator split the probe page between two workers.", "Now have a sub-agent read the probe page for its title."];
const SCHEMA = /\/(migrations|\w*_fts(_\w+)?|delivery_state)$/;
export const MAY_WRITE = /^(c1\/(messages|turns|chat_meta|projections|mailbox|outbox|subagents|subagent_groups)|person:[^/]+\/(chunks|vector_queue)|[0-9a-f]+-d\d+(\.\d+)+\/subagent_transcript|ledger\/model_calls)$/;
const changed = (w: P3World) => Object.entries(w.tables()).filter(([k, n]) => n !== (w.before[k] ?? 0) && !SCHEMA.test(k)).map(([k]) => k);
const delta = (w: P3World, k: string) => (w.tables()[k] ?? 0) - (w.before[k] ?? 0);
const drawnRows = async (w: P3World) => {
  let n = 0;
  for (const t of (await w.activity()).tasks.filter((x) => x.chat === "c1")) for (const s of await w.sections("c1", t.id)) n += s.rows.length;
  return n;
};

const graders: Grader<P3World>[] = [
  { name: "the diff holds only the transcript, the sub-agent rows, the handoff rows, the facet transcripts and the Ledger's calls", kind: "end_state", check: (w) => changed(w).length > 0 && changed(w).every((k) => MAY_WRITE.test(k)) },
  { name: "one subagents row per child and one subagent_groups row per delegation", kind: "end_state", check: (w) => delta(w, "c1/subagents") === w.children("c1").length && w.children("c1").length === 5 && delta(w, "c1/subagent_groups") === new Set(w.children("c1").map((c) => c.grp)).size },
  { name: "the mailbox's new rows are the turns' messages and one internal_handoff per delegation", kind: "end_state", check: (w) => w.mailbox("c1").filter((m) => m.kind === "internal_handoff").length === 2 && delta(w, "c1/mailbox") === w.mailbox("c1").length },
  { name: "each child's facet holds its transcript", kind: "end_state", check: (w) => w.children("c1").every((c) => (w.tables()[`${c.id}/subagent_transcript`] ?? 0) > 0) },
  { name: "the Ledger's new rows are model calls on the chat's, the children's and the verifier's routes", kind: "end_state", check: async (w) => {
    const rows = await w.ledgerCalls();
    return rows.length === delta(w, "ledger/model_calls") && w.children("c1").every((c) => rows.some((r) => r.runId === `subagent:${c.id}` && r.route === "subagent")) && rows.some((r) => r.route === "verifier");
  } },
  { name: "the sub-agent rows are bounded by MAX_OPEN and the drawer draws every one", kind: "end_state", check: async (w) => w.children("c1").length <= 12 && (await drawnRows(w)) === w.children("c1").length },
  { name: "Sam's chunk index holds only the MEMORY.md scaffold's headings: no memory content", kind: "required_fact", check: (w) => w.chunkLines().every((l) => /^#+ /.test(l)) },
  { name: "memory_unasked", kind: "minefield", check: (w) => w.chunkLines().some((l) => !/^#+ /.test(l)) || changed(w).some((k) => /\/(daily_lines|memory_meta)$/.test(k)) },
  { name: "reaction_unasked", kind: "minefield", check: (w) => changed(w).some((k) => /react/.test(k)) },
  { name: "hidden_store", kind: "minefield", check: (w) => changed(w).some((k) => !MAY_WRITE.test(k)) },
  { name: "file_written", kind: "minefield", check: (w) => changed(w).some((k) => /\/(files|_?vfs_\w+)$/.test(k)) },
  { name: "unbounded_rows", kind: "minefield", check: (w) => delta(w, "c1/subagents") > 12 },
];

export const task = defineTask<P3World>({
  id: "T-P3-13",
  cluster: "P3",
  clauses: ["B-P3-03", "B-P3-13"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 313, records: ["chat:c1", "the probe page", "the unreachable address", "every table counted"], files: [], jobs: [] },
  turns: ASKS.map((text) => ({ kind: "event" as const, name: "prompt", payload: { text } })),
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's 3,083 context items, memory sections per turn, thumbs-up rows, and six scheduler tables over a schedule the tools call gone (B-P3-13).",
});

export default task;
