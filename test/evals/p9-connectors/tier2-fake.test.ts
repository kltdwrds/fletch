// The tier-2 P9 tasks (T-P9-13 to 16) are graded on a slot with the real model by `pnpm evals P9` (F37); here each loads
// and plays under the scripted fake through the tier-1 harness, and its graders answer as shipped fletch does. T-P9-17
// reads the slot's pages at two widths (`P9SlotWorld`) and has no tier-1 run.
import { describe, expect, it } from "vitest";
import count from "./count-and-card-real-model.task.ts";
import { graded } from "./harness.ts";
import reload from "./reload-and-phone.task.ts";
import { runs } from "./runs.ts";
import setup from "./setup-real-model.task.ts";
import typed from "./typed-secret-real-model.task.ts";
import unbound from "./unbound-host-real-model.task.ts";

const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F35] P9 connectors, tier 2 under the scripted fake", () => {
  it("T-P9-13: the setup a link, the turn ended", async () => {
    expect(await graded(setup, runs["T-P9-13"]!())).toEqual(held(setup));
  });
  it("T-P9-14: the typed key held in the row and every bubble, never echoed", async () => {
    expect(await graded(typed, runs["T-P9-14"]!())).toEqual(held(typed));
  });
  it("T-P9-15: the unbound host refused by code, audited, and only Sam binds it", async () => {
    expect(await graded(unbound, runs["T-P9-15"]!())).toEqual(held(unbound));
  });
  it("T-P9-16: the count the tool's, the create a card", async () => {
    expect(await graded(count, runs["T-P9-16"]!())).toEqual(held(count));
  });
  it("T-P9-17 loads with its clause and graders; it runs only on a slot", () => {
    expect([reload.id, reload.clauses, reload.tier, reload.graders.length]).toEqual(["T-P9-17", ["B-P9-13"], 2, 8]);
  });
});
