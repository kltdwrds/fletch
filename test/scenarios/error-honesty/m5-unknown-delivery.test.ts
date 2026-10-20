// Error honesty for jobs (B7): the instance dies after the chat took a notice and before the outbox
// recorded it. The outcome is unknown, so the resumed job asks the chat whether it arrived before
// any resend; it did, so nothing is sent again and the person sees the news once.
import { describe, expect } from "vitest";
import { defineScenario } from "../../support/scenario.ts";
import { watchBody } from "../../workers/support/job-world.ts";
import { scenarioWorld } from "../m5-world.ts";

describe("[M5.1] error-honesty for jobs", () => {
  defineScenario({
    id: "S-B7-unknown-delivery-checked",
    clauses: ["B7"],
    seed: 7,
    async setup() {
      const w = await scenarioWorld();
      w.claimChat();
      await w.register(watchBody());
      await w.tick();
      return w;
    },
    async turns(w) {
      w.page.body = '{"title":"v2"}';
      // The chat takes the notice, then the job's instance is evicted before it marks the row.
      const chat = w.chats.harness("chat-ada");
      const original = chat.instance.notify.bind(chat.instance);
      chat.instance.notify = (n) => {
        const r = original(n);
        w.job.evict();
        return r;
      };
      await w.fire().catch((err: { code?: string }) => expect(err.code).toBe("EVICTED"));
      await w.settle().catch((err: { code?: string }) => expect(err.code).toBe("EVICTED"));
      chat.instance.notify = original;
      expect(w.outbox()[0]?.state).toBe("delivering");
      await w.fire();
      await w.settle();
    },
    endState(w) {
      expect(w.outbox()).toEqual([expect.objectContaining({ state: "delivered", attempts: 1 })]);
      expect(w.notices()).toHaveLength(1);
    },
    minefields: [{ name: "the notice sent a second time", happened: (w) => w.notifyCalls.length !== 1 }],
    declared: async (w) => ({ journal: [...w.runs().map((r) => `run:${r.runId}`), ...w.outbox().map((r) => `outbox:${r.id}`), ...(await w.ledger().runs()).map((r) => `ledger-run:${r.runId}`)] }),
  });
});
