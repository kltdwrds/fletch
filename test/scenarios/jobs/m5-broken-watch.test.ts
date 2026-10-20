// Jobs (B12, B18): a watch whose page is gone is disabled after its failures and the person told
// once, plainly; nothing keeps running and its scope is never widened (no other host is tried).
// Registering it described the cadence honestly, as an interval, never as instant detection.
import { describe, expect } from "vitest";
import { AUTO_DISABLE_AFTER } from "../../../packages/agent/src/jobs/engine.ts";
import { defineScenario } from "../../support/scenario.ts";
import { watchBody } from "../../workers/support/job-world.ts";
import { scenarioWorld } from "../m5-world.ts";

let registered: unknown;

describe("[M5.1] jobs", () => {
  defineScenario({
    id: "S-B12-broken-watch-disabled",
    clauses: ["B12", "B18"],
    seed: 12,
    async setup() {
      const w = await scenarioWorld();
      w.claimChat();
      registered = await w.register(watchBody({ every: 30 }));
      w.page.status = 404;
      return w;
    },
    async turns(w) {
      for (let i = 0; i < 400 && w.job.alarmAt !== null; i++) await w.tick();
    },
    endState(w) {
      expect(registered).toMatchObject({ ok: true, cadence: "every 30 minutes, so a change can take up to 30 minutes to be noticed" });
      expect(w.status()).toMatchObject({ status: "disabled", statusCode: "JOB_AUTO_DISABLED" });
      // The first failure is said once with its code (M25.6), then the turn-off; the four between are not repeated.
      expect(w.notices().map((n) => n.text)).toEqual([
        "Release notes watch did not finish: GATE_HTTP_ERROR (the service answered 404). It will try again at its next scheduled time; I will not repeat this one.",
        expect.stringMatching(/^I turned off Release notes watch after 5 failed runs in a row\. The last one failed with GATE_HTTP_ERROR: the service answered 404\./),
      ]);
      expect(w.job.alarmAt).toBeNull();
    },
    minefields: [
      { name: "kept running after disable", happened: (w) => w.page.hits !== AUTO_DISABLE_AFTER },
      { name: "another host tried", happened: (w) => w.audit.some((r) => r.host !== "hacker-news.firebaseio.com") },
      { name: "a model request", happened: (w) => w.fake.requests.length > 0 },
    ],
    declared: async (w) => ({ journal: [...w.runs().map((r) => `run:${r.runId}`), ...w.outbox().map((r) => `outbox:${r.id}`), ...(await w.ledger().runs()).map((r) => `ledger-run:${r.runId}`)] }),
  });
});
