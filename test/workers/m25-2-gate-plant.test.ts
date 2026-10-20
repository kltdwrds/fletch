// M25.2, the planted twin of the ten-tick claim in `m25-2-job-runs.test.ts`: the same gated job with the
// hostile model behind its reading step, and the production engine's gate replaced by one that is always
// open. The hostile model then runs on every tick the real gate declines, so the claim's zero is the
// gate's doing and not the test's.
import { describe, expect, it, vi } from "vitest";
import { jobWorld, PAGE } from "./support/job-world.ts";

vi.mock("../../packages/agent/src/jobs/gates.ts", async (original) => {
  const real = await original<typeof import("../../packages/agent/src/jobs/gates.ts")>();
  return { ...real, evaluateGate: async () => ({ open: true, state: {}, observed: { url: "https://hacker-news.firebaseio.com/v0/item/8863.json", excerpt: "unchanged" } }) };
});

describe("[M25.2] the gate runs first, gate removed", () => {
  it("without the gate, the hostile model runs on the ten unchanged ticks and the Ledger records its calls", async () => {
    const w = jobWorld({ mode: { kind: "compromised", hostile: { id: "h1", name: "report", arguments: { text: "Wake up!" } } } });
    w.claimChat();
    await w.define({ steps: [{ kind: "model" }, { kind: "notify" }], gate: { kind: "url", url: PAGE } });
    await w.tick();
    for (let i = 0; i < 10; i++) await w.tick();
    expect(w.fake.requests.length).toBeGreaterThanOrEqual(10);
    expect((await w.ledger().modelCalls({ person: w.owner })).length).toBeGreaterThanOrEqual(10);
  });
});
