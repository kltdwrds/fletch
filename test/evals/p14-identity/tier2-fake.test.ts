// The tier-2 P14 tasks (T-P14-10 to 14) are graded on a slot with the real model by `pnpm evals P14` (F41); here T-P14-10,
// 11, 12 and 14 load and play under the scripted fake through the tier-1 harness, and their graders answer as shipped
// fletch does. T-P14-13 reads the slot's pages at two widths (`P14SlotWorld`) and T-P14-04 the Security pane F41 builds
// (`P14SecurityWorld`); each loads with its clauses and graders and has no run before F41.
import { describe, expect, it } from "vitest";
import { graded } from "./harness.ts";
import rename from "./rename-by-chat-changes-nothing-real-model.task.ts";
import { runs } from "./runs.ts";
import security from "./security-pane-reads-the-routes.task.ts";
import settings from "./settings-and-deletion-said-as-they-are-real-model.task.ts";
import signIn from "./sign-in-said-as-it-is-real-model.task.ts";
import account from "./the-agents-account-of-itself-real-model.task.ts";
import asAgent from "./writes-as-the-agent-real-model.task.ts";

const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F40] P14 identity, tier 2 under the scripted fake", () => {
  it("T-P14-10: a rename by chat changes nothing, at both widths after a reload", async () => {
    expect(await graded(rename, runs["T-P14-10"]!())).toEqual(held(rename));
  });
  it("T-P14-11: sign-in said as it is, no count, no reset", async () => {
    expect(await graded(signIn, runs["T-P14-11"]!())).toEqual(held(signIn));
  });
  it("T-P14-12: the agent writes as Sam's agent and names Pat or says they", async () => {
    expect(await graded(asAgent, runs["T-P14-12"]!())).toEqual(held(asAgent));
  });
  it("T-P14-14: the agent's account of itself from the envelope", async () => {
    expect(await graded(account, runs["T-P14-14"]!())).toEqual(held(account));
  });
  it("T-P14-13 and T-P14-04 load with their clauses and graders; they run from F41", () => {
    expect([settings.id, settings.clauses, settings.tier, settings.graders.length]).toEqual(["T-P14-13", ["B-P14-07", "B-P14-09", "B-P14-11"], 2, 10]);
    expect([security.id, security.clauses, security.tier, security.graders.length]).toEqual(["T-P14-04", ["B-P14-05", "B-P14-12"], 1, 10]);
  });
});
