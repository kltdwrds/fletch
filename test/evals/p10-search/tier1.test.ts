// The P10 tier-1 tasks under vitest (F90): each task's scripted run in `runs.ts` through `p10Harness`.
import { describe, expect, it } from "vitest";
import { runTask } from "../../support/task.ts";
import t15 from "./answer-persists.task.ts";
import { p10Harness, played } from "./harness.ts";
import t07 from "./browser-is-a-separate-machine.task.ts";
import t14 from "./job-read-sources-linked.task.ts";
import t08 from "./kept-sign-in-on-ask.task.ts";
import t01 from "./page-read-names-source.task.ts";
import t02 from "./page-words-are-data.task.ts";
import t06 from "./read-is-now.task.ts";
import { runs } from "./runs.ts";
import t04 from "./wall-stops-the-site.task.ts";

describe("[F90] P10 search and the browser as they are: tier 1", () => {
  for (const t of [t01, t02, t04, t06, t15]) describe(t.id, () => runTask(t, p10Harness(runs[t.id]!())));
});

// T-P10-07, 08 and 14 run in F93 (parts.md, the split of 2026-11-09): their files load here, and each read they need
// refuses by name rather than answering empty.
describe("[F90] the reads F93's tasks need refuse until F93", () => {
  it("the three task files load, and each read throws P10_READ_NOT_IN_HARNESS", async () => {
    expect([t07.id, t08.id, t14.id]).toEqual(["T-P10-07", "T-P10-08", "T-P10-14"]);
    for (const t of [t07, t08, t14]) expect(t.versionHash()).toMatch(/^[0-9a-f]{64}$/);
    const w = await played(t01, runs["T-P10-01"]!());
    for (const read of [() => w.liveSession(), () => w.browserTime(), () => w.kept(), () => w.jobRuns()]) await expect(read()).rejects.toThrow(/^P10_READ_NOT_IN_HARNESS: /);
    for (const read of [() => w.restoreResult(), () => w.jobRequests()]) expect(read).toThrow(/^P10_READ_NOT_IN_HARNESS: /);
  });
});
