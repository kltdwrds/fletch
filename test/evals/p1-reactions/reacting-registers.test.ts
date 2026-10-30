// F22: the care register and a reaction on a win. The real model is graded by T-P1-06 and T-P1-09 on a preview slot
// (tier 2); this file holds what a hermetic test can: the registers reach the model in every chat turn, none of their
// examples is an eval's prompt (the tasks measure the lines, never teach them), the committed results for both tasks'
// current hashes end on three passes, and every P1 task's `version_hash` in the contract is its file's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REACTING } from "../../../packages/agent/src/chat/instructions.ts";
import { Seeded } from "../../support/seeded.ts";
import { runnerHashes, staleHashes } from "../../support/task-hashes.ts";
import { repoRoot } from "../../support/temp-repo.ts";
import care, { PROMPT as HARD_NEWS } from "./care-reaction.task.ts";
import { p1Harness } from "./harness.ts";
import { PROMPT as COUNT } from "./quick-task-no-ack.task.ts";
import friend, { INSTRUMENT, WIN } from "./react-like-a-friend.task.ts";

const CONTRACT = "docs/plan-v2/contracts/P1-reactions.md";
const RESULTS = "docs/plan-v2/evidence/results";
const CARE = "test/evals/p1-reactions/care-reaction.task.ts";
const FRIEND = "test/evals/p1-reactions/react-like-a-friend.task.ts";

describe("[F22] P1 reactions: the care register and a 👍 on a win", () => {
  it("every chat turn's request carries the registers: 👍 on a win, 🫶 or nothing on hard news with no emoji in the reply, none on a plain request", async () => {
    const harness = p1Harness({ script: [{ text: "I am so sorry." }] });
    const rng = new Seeded(care.setup.seed);
    const world = await harness.setup(rng, care);
    await harness.play(world, care.turns[0]!, rng);
    const system = world
      .requests()[0]!
      .messages.filter((m) => m.role === "system")
      .map((m) => m.text)
      .join("\n");
    expect(system).toContain(REACTING);
    expect(REACTING).toMatch(/win of their own.*first call `react` with 👍/);
    expect(REACTING).toMatch(/hard or sad news, first call `react` with 🫶.*or do not react.*the reply text holds no emoji at all, not even 🫶/);
    expect(REACTING).toMatch(/plain request, question or instruction that needs no tool takes no reaction/);
  });

  it("no example in the registers is a tier-2 task's prompt", () => {
    const prompts = [HARD_NEWS, WIN, INSTRUMENT, COUNT];
    expect(prompts.filter((p) => REACTING.includes(p))).toEqual([]);
    // Planted: an example lifted from T-P1-09 is caught.
    expect(prompts.filter((p) => `${REACTING}\nExample: "${WIN}" takes 👍.`.includes(p))).toEqual([WIN]);
  });

  it("the committed results for T-P1-06 and T-P1-09 at their current hashes end on a pass of three trials", () => {
    const hashes = runnerHashes([CARE, FRIEND]);
    for (const t of [care, friend]) {
      const hash = [...hashes.values()].find((h) => h.id === t.id)!.hash;
      const file = JSON.parse(readFileSync(join(repoRoot, RESULTS, `${hash}.json`), "utf8")) as { task_id: string; runs: Array<{ status: string; trials: Array<{ status: string }> }> };
      const last = file.runs.at(-1)!;
      expect(file.task_id).toBe(t.id);
      expect(last.status).toBe("pass");
      expect(last.trials.map((x) => x.status)).toEqual(["pass", "pass", "pass"]);
    }
  });

  it("every P1 task's version_hash in the contract is its file's, T-P1-03's moved with its stored-reaction grader", () => {
    const text = readFileSync(join(repoRoot, CONTRACT), "utf8");
    expect(staleHashes(text)).toEqual([]);
    expect(text).not.toContain("version_hash: 4e5551fb9418");
    // Planted: T-P1-03's old hash written back is caught.
    const t3 = runnerHashes(["test/evals/p1-reactions/thumbs-up-answers-question.task.ts"]).values().next().value!;
    expect(staleHashes(text.replace(`version_hash: ${t3.hash.slice(0, 12)}`, "version_hash: 4e5551fb9418"))).toEqual([`T-P1-03 4e5551fb9418 ${t3.hash.slice(0, 12)}`]);
  });
});
