// The tier-2 P14 tasks (T-P14-10 to 14) are graded on a slot with the real model by `pnpm evals P14` (F41); here T-P14-10,
// 11, 12 and 14 load and play under the scripted fake through the tier-1 harness, and their graders answer as shipped
// fletch does. T-P14-13 reads the slot's pages (`P14SlotWorld`), played over `harness-slot.ts`. (T-P14-04, the
// Security pane, is tier 1 from F41: `security-pane-reads-the-routes.test.ts`.)
import { describe, expect, it } from "vitest";
import { graded } from "./harness.ts";
import rename from "./rename-by-chat-changes-nothing-real-model.task.ts";
import { runs } from "./runs.ts";
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
  it("T-P14-13: settings and deletion said as they are; the replies the same after each reload; /settings/general a page", async () => {
    expect(await graded(settings, runs["T-P14-13"]!())).toEqual(held(settings));
  });
});
