// M5.1, the planted guard for the zero-model-calls claim: the same 100 unchanged ticks as
// `m5-jobs.test.ts`, with the production engine's gate replaced by one that is always open. The
// claim's assertions must fail here, which shows the claim depends on the gate and is not
// tautological (GOAL-PROMPT check-in for M5).
import { describe, expect, it, vi } from "vitest";
import { jobWorld, watchBody } from "./support/job-world.ts";

vi.mock("../../packages/agent/src/jobs/gates.ts", async (original) => {
  const real = await original<typeof import("../../packages/agent/src/jobs/gates.ts")>();
  return { ...real, evaluateGate: async () => ({ open: true, state: {}, observed: { url: "https://hacker-news.firebaseio.com/v0/item/8863.json", excerpt: "unchanged" } }) };
});

describe("[M5.1] job gates and runs, gate removed", () => {
  it("without the gate, 100 unchanged ticks reach the model and create run rows", async () => {
    const w = jobWorld({ script: Array.from({ length: 100 }, () => ({ toolCall: { name: "report", arguments: { text: "Nothing new." } } })) });
    w.claimChat();
    await w.register(watchBody({ steps: [{ kind: "diff" }, { kind: "model" }, { kind: "notify" }] }));
    for (let i = 0; i < 100; i++) await w.tick();
    expect(w.fake.requests.length).toBeGreaterThan(0);
    expect(w.runs().length).toBeGreaterThan(0);
  });
});
