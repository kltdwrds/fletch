// Silence and cost (A3, B17), acceptance-checks.md: 200 simulated ticks of a watch with 5 real
// changes at seeded positions give exactly 5 notifications and none for the unchanged ticks; a
// simulated day at 10-minute cadence with no change makes 0 model requests, with a model step in
// the job so an open gate would have called the model.
import { describe, expect } from "vitest";
import { defineScenario } from "../../support/scenario.ts";
import { watchBody } from "../../workers/support/job-world.ts";
import { scenarioWorld } from "../m5-world.ts";

let changes: number[] = [];

describe("[M5.1] silence and cost", () => {
  defineScenario({
    id: "S-B17-silent-unless-news",
    clauses: ["A3", "B17"],
    seed: 517,
    async setup(rng) {
      changes = rng.distinct(5, 1, 199);
      const w = await scenarioWorld();
      w.claimChat();
      await w.register(watchBody());
      return w;
    },
    async turns(w) {
      for (let i = 0; i < 200; i++) {
        if (changes.includes(i)) w.page.body = `{"title":"edition ${i}"}`;
        await w.tick();
      }
    },
    endState(w) {
      expect(w.page.hits).toBe(200);
      expect(w.notices()).toHaveLength(5);
      expect(w.runs().map((r) => r.signal)).toEqual(Array(5).fill("notify"));
      expect(w.notices().map((n) => /edition (\d+)/.exec(n.text)?.[1]).map(Number)).toEqual(changes);
    },
    minefields: [
      { name: "a model request on any tick", happened: (w) => w.fake.requests.length > 0 },
      { name: "a run row for an unchanged tick", happened: (w) => w.runs().length !== 5 },
      { name: "a notification resent", happened: (w) => w.notifyCalls.length !== 5 },
    ],
    declared: async (w) => ({ journal: [...w.runs().map((r) => `run:${r.runId}`), ...w.outbox().map((r) => `outbox:${r.id}`), ...(await w.ledger().runs()).map((r) => `ledger-run:${r.runId}`)] }),
  });

  defineScenario({
    id: "S-A3-cost-ceiling-day",
    clauses: ["A3", "B17"],
    seed: 144,
    async setup() {
      const w = await scenarioWorld();
      w.claimChat();
      await w.register(watchBody({ every: 10, steps: [{ kind: "diff" }, { kind: "model" }, { kind: "notify" }] }));
      return w;
    },
    async turns(w) {
      const end = w.clock.now + 86_400_000;
      while (w.clock.now < end) await w.tick();
    },
    endState(w) {
      expect(w.status()!.ticks).toBeGreaterThanOrEqual(144);
      expect(w.fake.requests).toHaveLength(0);
    },
    minefields: [
      { name: "a model request on a no-change tick", happened: (w) => w.fake.requests.length > 0 },
      { name: "a run row", happened: (w) => w.runs().length > 0 },
    ],
    declared: () => ({}),
  });
});
