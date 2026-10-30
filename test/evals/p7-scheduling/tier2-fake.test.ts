// The tier-2 P7 tasks (T-P7-09, 10, 11, 14) are graded on a slot with the real model by `pnpm evals P7` (F30); here
// each file loads and plays under the scripted fake through the tier-1 harness, and its graders answer as shipped
// fletch does. T-P7-14 fails on one grader: the job dialog's run history opens expanded (`aria-expanded="true"`), and
// B-P7-11 asks for it collapsed; F30 owns the page rubric, and this test turns into the passing run when it changes.
import { describe, expect, it } from "vitest";
import { graded } from "./harness.ts";
import oneShot from "./one-shot-set-real-model.task.ts";
import result from "./result-in-chat-real-model.task.ts";
import { runs } from "./runs.ts";
import silence from "./silence-real-model.task.ts";
import surfaces from "./upcoming-and-dialog.task.ts";

const held = (task: { graders: Array<{ name: string }> }, missing: string[] = []) => Object.fromEntries(task.graders.map((g) => [g.name, !missing.includes(g.name)]));

describe("[F29] P7 scheduling, tier 2 under the scripted fake", () => {
  it("T-P7-09: the one-shot is set, its card and reply name the time, and its row is under Reminders", async () => {
    expect(await graded(oneShot, runs["T-P7-09"]!())).toEqual(held(oneShot));
  });
  it("T-P7-10: the run tells the time in words in c1, once, and the one-shot is finished", async () => {
    expect(await graded(result, runs["T-P7-10"]!())).toEqual(held(result));
  });
  it("T-P7-11: two unchanged runs end certified silent, with nothing in c1", async () => {
    expect(await graded(silence, runs["T-P7-11"]!())).toEqual(held(silence));
  });
  it("T-P7-14: the surfaces hold but for the run history, which the dialog draws open", async () => {
    expect(await graded(surfaces, runs["T-P7-14"]!())).toEqual(held(surfaces, ["the dialog shows the badge in words, the time, the collapsed run history and the fixed actions"]));
  });
});
