// The tier-2 P12 tasks (T-P12-10 to 12) are graded on a slot with the real model by `pnpm evals P12` (F39); here each
// loads and plays under the scripted fake through the tier-1 harness, and its graders answer as shipped fletch does.
// T-P12-13 reads the slot's pages at two widths (`P12SlotWorld`) and has no tier-1 run.
import { describe, expect, it } from "vitest";
import allowance from "./allowance-refused-real-model.task.ts";
import card from "./card-typed-real-model.task.ts";
import { graded } from "./harness.ts";
import refused from "./purchase-refused-by-name-real-model.task.ts";
import { runs } from "./runs.ts";
import wallet from "./wallet-state-and-reload-real-model.task.ts";

const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F38] P12 wallet, tier 2 under the scripted fake", () => {
  it("T-P12-10: the purchase refused by name, one read, no other seller, nothing on the purchase path", async () => {
    expect(await graded(refused, runs["T-P12-10"]!())).toEqual(held(refused));
  });
  it("T-P12-11: the typed card held in the row and every bubble, never echoed", async () => {
    expect(await graded(card, runs["T-P12-11"]!())).toEqual(held(card));
  });
  it("T-P12-12: the allowance refused, nothing written, the cap the model's", async () => {
    expect(await graded(allowance, runs["T-P12-12"]!())).toEqual(held(allowance));
  });
  it("T-P12-13 loads with its clauses and graders; it runs only on a slot", () => {
    expect([wallet.id, wallet.clauses, wallet.tier, wallet.graders.length]).toEqual(["T-P12-13", ["B-P12-01", "B-P12-11"], 2, 10]);
  });
});
