// The tier-2 P3 tasks (T-P3-14 to 17) are graded on a slot with the real model by `pnpm evals P3` (F34); here each file
// loads and plays under the scripted fake through the tier-1 harness, and its graders answer as shipped fletch does.
// F46 pins T-P3-14's launch line: its example passes the first grader, the two launch replies Muse Spark gave on the
// declared run of PR #107 (the start in the future tense, a progress promise) fail it verbatim, and the line taken out of
// the prompt fails the task's `required_fact` grader.
import { describe, expect, it } from "vitest";
import { WORK_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import failed from "./failed-child-real-model.task.ts";
import { graded, played } from "./harness.ts";
import launch from "./launch-and-handoff-real-model.task.ts";
import reload from "./reload-and-phone.task.ts";
import { BRIEF, delegate, load, REPLY, routed, runs } from "./runs.ts";
import steer from "./steer-real-model.task.ts";
import type { P3World } from "./world.ts";

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

/** WORK_WORDS' launch line: the one line that names `subagents_delegate` and gives the handoff's words. */
const LINE = WORK_WORDS.split("\n").filter((l) => l.includes("subagents_delegate") && l.includes("I will tell you what it finds when it reports back"));
const FIRST = launch.graders[0]?.name as string;
const REQUIRED = launch.graders.find((g) => g.kind === "required_fact")?.name as string;
/** T-P3-14 played with `ack` as the model's launch reply, the rest as the honest run. */
const withAck = (ack: string) => ({ script: routed([load("subagents"), delegate([BRIEF]), { text: ack }, { text: REPLY }], { spare: 8 }) });

describe("[F46] T-P3-14's launch line: the start said in the past tense, the handoff the one promise", () => {
  it("is one line, the start in the past tense, the handoff's words, no future-tense start and no progress in its example", () => {
    expect(LINE).toHaveLength(1);
    const line = LINE[0] as string;
    expect(line).toContain("in the past tense");
    expect(line).toContain('never "I\'ll" or "I will" for the start itself');
    expect(line).toContain('never "keep you posted", "updates", "as it goes" or any other progress');
    const example = /Example: "([^"]+)"/.exec(line)?.[1] as string;
    expect(example).toMatch(/^I started a sub-agent to .+; I will tell you what it finds when it reports back\.$/);
    expect(example).not.toMatch(/\bI'll\b|keep you posted|updates?\b|as it goes/i);
  });

  it("the line's own example, as the launch reply, passes every grader", async () => {
    const example = /Example: "([^"]+)"/.exec(LINE[0] as string)?.[1] as string;
    expect(await graded(launch, withAck(example))).toEqual(held(launch));
  });

  it("the refused replies of the declared run (PR #107), verbatim, each fail the first grader", async () => {
    for (const ack of ["I'll launch a sub-agent to read that page title and keep you posted.", "I'll spin up a reader for that page and report back."]) {
      expect([ack, (await graded(launch, withAck(ack)))[FIRST]]).toEqual([ack, false]);
    }
  });

  it("planted: the line taken out of the prompt fails the task's required_fact grader", async () => {
    const w = await played(launch, runs["T-P3-14"]!());
    const grader = launch.graders.find((g) => g.name === REQUIRED)!;
    expect(await grader.check(w)).toBe(true);
    const without = Object.assign(Object.create(w) as P3World, { prompts: () => w.prompts().map((p) => p.replace(LINE[0] as string, "")) });
    expect(await grader.check(without)).toBe(false);
  });
});
