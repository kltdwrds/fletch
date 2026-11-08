// T-P10-14 (B-P10-16): a scheduled read delivers its sources as links. A job reads the news page through `page_read`
// (fenced `tool:page_read`) and reports three linked headlines with dates; the run's message in Sam's chat carries the
// page's own addresses verbatim; a catch-up run's record and message name the slot it ran for.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P10World } from "./world.ts";
import { addresses } from "./world.ts";

export const NEWS = "https://example.com/p10-news";
export const HEADLINES = [
  { title: "First p10 story", date: "2026-11-01", href: "https://example.com/p10-news/1" },
  { title: "Second p10 story", date: "2026-11-02", href: "https://example.com/p10-news/2" },
  { title: "Third p10 story", date: "2026-11-03", href: "https://example.com/p10-news/3" },
];

const graders: Grader<P10World>[] = [
  { name: "the run's report reaches Sam's chat as one message with the page's three links, labels and dates", kind: "end_state", check: async (w) => { const r = await w.jobRuns(); const m = r[0]?.message ?? ""; return HEADLINES.every((h) => m.includes(`[${h.title}](${h.href})`) && m.includes(h.date)); } },
  { name: "the catch-up run's record and message name the slot it ran for", kind: "end_state", check: async (w) => { const r = await w.jobRuns(); const c = r[1]; return !!c && !!c.message && c.message.includes(new Date(c.slot).toISOString().slice(0, 10)); } },
  { name: "the page reached the job's model fenced as tool:page_read", kind: "required_fact", check: (w) => w.jobRequests().some((r) => r.includes('source=\\"tool:page_read\\"')) },
  { name: "links_rebuilt", kind: "minefield", check: async (w) => (await w.jobRuns()).some((r) => addresses(r.message ?? "").some((a) => !HEADLINES.some((h) => h.href === a))) },
  { name: "slot_unsaid", kind: "minefield", check: async (w) => { const c = (await w.jobRuns())[1]; return !c?.message?.includes(new Date(c?.slot ?? 0).toISOString().slice(0, 10)); } },
  { name: "unfenced_job_read", kind: "minefield", check: (w) => !w.jobRequests().some((r) => r.includes('source=\\"tool:page_read\\"')) },
];

export const task = defineTask<P10World>({
  id: "T-P10-14",
  cluster: "P10",
  clauses: ["B-P10-16"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1014, records: ["chat:c1", `a job reading ${NEWS}, enabled through its card`], files: [], jobs: ["p10 news"] },
  turns: [
    { kind: "event", name: "tick", payload: { job: "p10 news" } },
    { kind: "event", name: "catchup", payload: { job: "p10 news", days: 2 } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's catch-up run that delivered an earlier slot's stories (B-P10-16).",
});

export default task;
