// T-P5-11 (B-P5-12): spend is said per task and per day. Sam has three turns in two tasks (a mail that pauses on a card
// and resumes, then a question), and the first task carries a Ledger row on a second model (the embedding model, as a
// memory search's embedding is kept). fletch's forms: the day's usage line is the person's usage route
// (`/app/usage.json?days=1`), the rollup Settings' Usage group draws, its calls, tokens and money as numbers; the
// drawer's head says the task's model calls and tokens from the Ledger rows keyed by its turn ids (delta 7).
import { defineTask, type Grader } from "../../support/task.ts";
import { MAIL, OTHER } from "./request-shows-as-task.task.ts";
import type { ModelRow, P5World, TaskView } from "./world.ts";

const tasks = async (w: P5World): Promise<TaskView[]> => (await w.activity()).tasks;
const first = async (w: P5World) => (await tasks(w)).find((t) => t.title === MAIL)!;
const mine = async (w: P5World, t: TaskView): Promise<ModelRow[]> => (await w.ledgerRows()).filter((r) => t.turnIds.includes(r.runId));
const sum = (rows: ModelRow[], f: (r: ModelRow) => number) => rows.reduce((n, r) => n + f(r), 0);
const tokens = (r: ModelRow) => r.inputTokens + r.outputTokens;

const graders: Grader<P5World>[] = [
  { name: "the day's usage says calls, tokens and money as numbers, equal to the sum of the Ledger's rows", kind: "end_state", check: async (w) => {
    const d = await w.dayUsage();
    const rows = await w.ledgerRows();
    return d.calls === rows.length && d.tokens === sum(rows, tokens) && d.costMicros === sum(rows, (r) => r.costMicros) && d.costMicros > 0;
  } },
  { name: "the drawer's head says the task's model calls and tokens from the rows of its turns", kind: "end_state", check: async (w) => {
    const t = await first(w);
    const rows = await mine(w, t);
    const u = (await w.task("c1", t.id)).usage;
    const head = (await w.drawer("c1", t.id))?.usage.replace(/,/g, "") ?? "";
    return !!u && u.ok && u.calls === rows.length && u.tokens === sum(rows, tokens) && head.includes(`${rows.length} model calls`) && head.includes(`${sum(rows, tokens)} tokens`);
  } },
  { name: "every Ledger row carries its model, two models among them", kind: "end_state", check: async (w) => (await w.ledgerRows()).every((r) => !!r.model) && new Set((await w.ledgerRows()).map((r) => r.model)).size === 2 },
  { name: "money is tokens times the Ledger's price for the row's model", kind: "required_fact", check: async (w) => (await w.ledgerRows()).every((r) => r.costMicros === w.priceOf(r)) },
  { name: "a task's tokens are the sum over all its turns", kind: "required_fact", check: async (w) => {
    const t = await first(w);
    const u = (await w.task("c1", t.id)).usage;
    const rows = await w.ledgerRows();
    return t.turnIds.length === 2 && t.turnIds.every((id) => rows.some((r) => r.runId === id)) && u?.tokens === sum(await mine(w, t), tokens) && (u?.models ?? []).length === 2;
  } },
  { name: "percentage_only", kind: "minefield", check: async (w) => !Number.isFinite((await w.dayUsage()).tokens) },
  { name: "no_model", kind: "minefield", check: async (w) => (await w.ledgerRows()).some((r) => !r.model) },
  { name: "cost_hidden", kind: "minefield", check: async (w) => (await w.dayUsage()).tokens > 0 && !((await w.dayUsage()).costMicros > 0) },
  { name: "task_without_usage", kind: "minefield", check: async (w) => {
    const t = await first(w);
    return !(await w.task("c1", t.id)).usage?.ok || !(await w.drawer("c1", t.id))?.usage;
  } },
  { name: "cost_per_message", kind: "minefield", check: (w) => w.thread().some((e) => /\$\d|\bmodel calls?\b|\btokens?\b/.test(e.text)) },
];

export const task = defineTask<P5World>({
  id: "T-P5-11",
  cluster: "P5",
  clauses: ["B-P5-12"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 511, records: ["chat:c1", "the Ledger's price table"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: MAIL } },
    { kind: "event", name: "decide" },
    { kind: "event", name: "embed" },
    { kind: "event", name: "prompt", payload: { text: OTHER } },
    { kind: "event", name: "open" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["mail.send:PENDING", "mail.send:DONE"] },
  graders,
  reference: "Muse's plan-level percentage, no model column, 23 million tokens unseen (B-P5-12).",
});

export default task;
