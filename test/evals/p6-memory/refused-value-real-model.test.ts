// T-P6-13 is tier 2 (`pnpm evals`, F28); here its file loads and runs under the scripted fake, every grader holding on
// the run of a model that keeps the rules (`scripted` in `runs.ts`). F44's oracle correction of "the chat transcript
// keeps Sam's message as sent": on fletch-pv-3 (tree 5890d87) every trial failed it alone, because the deploy's
// typed-secret hold stores the card-shaped all-zero number as a reference; that stored row is pinned here verbatim as a
// pass, and a transcript that lost or rewrote anything else of the message still fails.
import { describe, expect, it } from "vitest";
import { Seeded } from "../../support/seeded.ts";
import { p6Harness } from "./harness.ts";
import task from "./refused-value-real-model.task.ts";
import { graded, scripted } from "./runs.ts";
import type { P6World, Row } from "./world.ts";

describe("[F27] P6 memory, tier 2 under the scripted fake: T-P6-06's prompt, graded by T-P6-06's graders", () => {
  it("every grader holds", async () => {
    const r = await graded(task, scripted["T-P6-13"]!());
    expect(r).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, true])));
  });
});

describe("[F44] T-P6-13's transcript oracle: the message as the chat stores it, the number held by reference at most", () => {
  const KEPT = "the chat transcript keeps Sam's message as sent";
  const grader = task.graders.find((g) => g.name === KEPT)!;
  async function withUserRow(text: string | null): Promise<boolean> {
    const h = p6Harness(scripted["T-P6-13"]!());
    const rng = new Seeded(task.setup.seed);
    const w = await h.setup(rng, task);
    for (const t of task.turns) await h.play(w, t, rng);
    const rows = (l?: "c1" | "c2"): Row[] => w.rows(l).flatMap((r) => (r.role !== "user" ? [r] : text === null ? [] : [{ ...r, text }]));
    return grader.check(Object.assign(Object.create(w) as P6World, { rows }));
  }

  it("the slot's stored row, verbatim, is a pass", async () => {
    expect(await withUserRow("remember that my passport is in the blue folder, and its number is [credential:cred://typed-6f3791f899e4460f]")).toBe(true);
  });

  it("planted: a scrubbed number, a rewritten location, a second reference and a missing message each still fail", async () => {
    expect(await withUserRow("remember that my passport is in the blue folder, and its number is [removed]")).toBe(false);
    expect(await withUserRow("remember that my passport is in [credential:cred://typed-0a1b2c], and its number is [credential:cred://typed-6f3791f899e4460f]")).toBe(false);
    expect(await withUserRow("remember that my passport is in the blue folder, and its number is [credential:cred://typed-6f37] [credential:cred://typed-91f8]")).toBe(false);
    expect(await withUserRow("remember that my passport is somewhere, and its number is [credential:cred://typed-6f3791f899e4460f]")).toBe(false);
    expect(await withUserRow(null)).toBe(false);
  });
});
