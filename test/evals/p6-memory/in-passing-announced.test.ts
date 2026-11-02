// T-P6-04 is tier 2 (`pnpm evals`, F28); here its file loads and runs under the scripted fake, every grader holding on
// the run of a model that keeps the rules (`scripted` in `runs.ts`). F28: the same scripted run is graded with the
// memory lines in the model's context (`MEMORY_WORDS`, delta 1), and a fake that saves in passing and says only
// "Noted" trips `silent_save`.
import { describe, expect, it } from "vitest";
import { CHAT_TASK, MEMORY_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import { Seeded } from "../../support/seeded.ts";
import { p6Harness, type P6HarnessOptions, writeDaily } from "./harness.ts";
import task from "./in-passing-announced.task.ts";
import { graded, scripted } from "./runs.ts";
import { SAM_FACT } from "./world.ts";

describe("[F27] P6 memory, tier 2 under the scripted fake: a fact said in passing is saved and announced with its citation", () => {
  it("every grader holds", async () => {
    const r = await graded(task, scripted["T-P6-04"]!());
    expect(r).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, true])));
  });
});

async function played(o: P6HarnessOptions) {
  const h = p6Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = await h.setup(rng, task);
  for (const t of task.turns) await h.play(world, t, rng);
  return world;
}

const verdicts = async (w: Awaited<ReturnType<typeof played>>) => Object.fromEntries(await Promise.all(task.graders.map(async (g) => [g.name, g.kind === "minefield" ? !(await g.check(w)) : await g.check(w)])));

describe("[F28] P6 memory: the turn that saves in passing is told to name the save, and a silent save is caught", () => {
  it("the scripted run's model was sent every memory line in its task block, and every grader holds", async () => {
    expect(CHAT_TASK).toContain(MEMORY_WORDS);
    const w = await played(scripted["T-P6-04"]!());
    const context = w.context("c1");
    const lines = MEMORY_WORDS.split("\n");
    // Four F28 lines and F44's three: where a new fact goes, a person page, recall after a correction.
    expect(lines).toHaveLength(7);
    for (const line of lines) expect(context).toContain(line);
    expect(lines[0]).toMatch(/citation the tool returned/);
    expect(lines[0]).toMatch(/Never save silently/);
    expect(await verdicts(w)).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, true])));
  });

  it("planted: a model that saves the passing fact and replies only \"Noted\" fails silent_save and the end state", async () => {
    const w = await played({ script: [writeDaily("call_sam", SAM_FACT), { text: "Noted." }] });
    expect(w.lines().map((l) => l.text)).toEqual([expect.stringContaining(SAM_FACT)]);
    const r = await verdicts(w);
    expect(r.silent_save).toBe(false);
    expect(r["either the reply names each line it saved with its citation, or nothing was written"]).toBe(false);
  });

  it("a model that saves nothing and says nothing of a save keeps every rule (delta 1: announced, or not made)", async () => {
    const w = await played({ script: [{ text: "Thanks, Thursdays it is." }] });
    expect(w.lines()).toEqual([]);
    expect(await verdicts(w)).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, true])));
  });
});
