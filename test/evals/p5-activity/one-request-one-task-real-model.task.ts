// T-P5-15 (B-P5-01, B-P5-03, B-P5-04): tier 2, the real model on a slot (`pnpm evals P5`, F32) reads the probe page and
// writes its title and link count: one row titled by Sam's words, the drawer's read step the page's own text and the
// write step the file's lines, the reply's count equal to the file's and the page's, the summary code's quoting the
// reply, and no per-call narration in the thread.
import { defineTask, type Grader } from "../../support/task.ts";
import { ASK, fromRequest } from "./request-shows-as-task.task.ts";
import type { P5World } from "./world.ts";
import { newest, PROBE_TITLE, summaryOf, work } from "./world.ts";

const detail = async (w: P5World) => w.task("c1", (await newest(w))!.id);
const count = (s: string) => /\b(\d+|one|two|three)\s+links?\b/i.exec(s)?.[1]?.toLowerCase().replace("one", "1").replace("two", "2").replace("three", "3") ?? null;
const file = async (w: P5World) => work(await detail(w)).find((s) => s.tool === "file_write")?.detail.files[0]?.preview ?? "";
const page = async (w: P5World) => /\((?:via \w+, )?(\d+) links?\)/.exec(work(await detail(w)).find((s) => s.tool === "browse_open")?.detail.result?.text ?? "")?.[1] ?? null;

const graders: Grader<P5World>[] = [
  { name: "one row for the request, titled with Sam's words", kind: "end_state", check: async (w) => (await w.activity()).tasks.length === 1 && fromRequest((await newest(w))!.title, ASK) },
  { name: "the read step shows the page's own text and the write step the file's lines", kind: "end_state", check: async (w) => (work(await detail(w)).find((s) => s.tool === "browse_open")?.detail.result?.text ?? "").includes(PROBE_TITLE) && (await file(w)).length > 0 },
  { name: "the reply's link count equals the file's and the page's", kind: "end_state", check: async (w) => count(w.replies().at(-1) ?? "") === (await page(w)) && count(await file(w)) === (await page(w)) },
  { name: "the summary is code's and quotes the reply", kind: "end_state", check: async (w) => summaryOf(await detail(w))?.detail.blocks[0]?.text === w.replies().at(-1) },
  { name: "the record's fields are code's on the real model too", kind: "required_fact", check: async (w) => work(await detail(w)).every((s) => !w.replies().some((r) => r && s.title.includes(r))) },
  { name: "row_per_turn", kind: "minefield", check: async (w) => (await w.activity()).tasks.length > 1 },
  { name: "title_from_model", kind: "minefield", check: async (w) => !fromRequest((await newest(w))!.title, ASK) },
  { name: "count_disagrees", kind: "minefield", check: async (w) => count(w.replies().at(-1) ?? "") !== (await page(w)) || count(await file(w)) !== (await page(w)) },
  { name: "narrated_calls", kind: "minefield", check: (w) => w.thread().some((e) => /\b(browse_open|file_write|tool_search)\b|Read the page|Wrote `/.test(e.text)) },
];

export const task = defineTask<P5World>({
  id: "T-P5-15",
  cluster: "P5",
  clauses: ["B-P5-01", "B-P5-03", "B-P5-04"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 515, records: ["chat:c1 on the slot", "the slot's probe page with one link"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { r2: ["p5-probe.md"] },
  graders,
  reference: "Muse's turn whose record said \"two links\" over a file that said one (B-P5-01, B-P5-03, B-P5-04).",
});

export default task;
