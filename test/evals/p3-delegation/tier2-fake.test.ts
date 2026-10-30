// The tier-2 P3 tasks (T-P3-14 to 17) are graded on a slot with the real model by `pnpm evals P3` (F34); here each file
// loads and plays under the scripted fake through the tier-1 harness, and its graders answer as shipped fletch does.
import { describe, expect, it } from "vitest";
import failed from "./failed-child-real-model.task.ts";
import { graded } from "./harness.ts";
import launch from "./launch-and-handoff-real-model.task.ts";
import reload from "./reload-and-phone.task.ts";
import { runs } from "./runs.ts";
import steer from "./steer-real-model.task.ts";

const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F33] P3 delegation, tier 2 under the scripted fake", () => {
  it("T-P3-14: launched and not done, the handoff once with its verdict", async () => {
    expect(await graded(launch, runs["T-P3-14"]!())).toEqual(held(launch));
  });
  it("T-P3-15: the steer a close and a new delegation, never a message to the child", async () => {
    expect(await graded(steer, runs["T-P3-15"]!())).toEqual(held(steer));
  });
  it("T-P3-16: the first title given, the second said plainly, one step failed", async () => {
    expect(await graded(failed, runs["T-P3-16"]!())).toEqual(held(failed));
  });
  it("T-P3-17: the entries, the rows and the drawer the same after a reload and at phone width", async () => {
    expect(await graded(reload, runs["T-P3-17"]!())).toEqual(held(reload));
  });
});
