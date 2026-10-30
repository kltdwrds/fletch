// T-P7-09 (B-P7-01, B-P7-11): tier 2, T-P7-01 asked of the real model on a slot (`pnpm evals P7`, F30): exactly one
// runonce five minutes on in the home zone, a reply that says it is set, names the time and asks nothing, and the row
// under Reminders in the panel's Upcoming. fletch's form keeps the one card under the reply, which Sam decides (the
// agent's job starts off). Its graders are T-P7-01's, with the Upcoming row added.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { graders as oneShot, PROMPT, TITLE } from "./one-shot-set.task.ts";
import type { P7World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

const graders: Grader<P7World>[] = [
  ...oneShot,
  { name: "the panel's Upcoming shows the row under Reminders", kind: "end_state", check: async (w) => (await w.listed()).some((j) => j.title === TITLE && j.listed === "upcoming" && j.kind === "runonce") && (await w.groups())[0] === "Reminders" },
];

export const task = defineTask<P7World>({
  id: "T-P7-09",
  cluster: "P7",
  clauses: ["B-P7-01", "B-P7-11"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 709, records: ["chat:c1 on the slot", "home zone Europe/London", "no jobs"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: PROMPT },
    { kind: "event", name: "decide", payload: { choice: "once" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["card:1:Your agent asks to: jobs enable", `job:${TITLE}`] },
  graders,
  reference: "Muse (B-P7-01): one `cron.add`, \"Set. It will fire ...\", the row live in Upcoming (B-P7-11).",
});

export default task;
