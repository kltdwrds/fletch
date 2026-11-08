// The P10 tier-1 tasks under vitest (F90): each task's scripted run in `runs.ts` through `p10Harness`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p10Harness } from "./harness.ts";
import t01 from "./page-read-names-source.task.ts";
import t02 from "./page-words-are-data.task.ts";
import t06 from "./read-is-now.task.ts";
import { runs } from "./runs.ts";
import t04 from "./wall-stops-the-site.task.ts";

describe("[F90] P10 search and the browser as they are: tier 1", () => {
  for (const t of [t01, t02, t04, t06]) describe(t.id, () => runTask(t, p10Harness(runs[t.id]!())));
});
