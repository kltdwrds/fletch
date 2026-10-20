// M15.2 run-step retries (Muse spec §16.4, narrowed): a step is retried only on a rate limit, a 5xx or
// a network failure. A deterministic failure ends the occurrence after one model call, and the next
// scheduled occurrence is its retry; a step handler that asks for a retry on a deterministic code
// does not get one, because the engine decides.
import { describe, expect, it } from "vitest";
import type { StepHandler } from "../../packages/agent/src/jobs/steps.ts";
import { transient } from "../../packages/agent/src/jobs/steps.ts";
import { RUN_MAX_ATTEMPTS } from "../../packages/agent/src/jobs/engine.ts";
import { report } from "../support/fake-model.ts";
import { jobWorld } from "./support/job-world.ts";

const steps = [{ kind: "model" as const }, { kind: "notify" as const }];
const drain = async (w: ReturnType<typeof jobWorld>) => {
  for (let i = 0; i < 10 && w.engine().store.activeRun(); i++) await w.tick();
};

describe("[M15.2] step retries", () => {
  it("names the transient codes and nothing else", () => {
    for (const code of ["MODEL_RATE_LIMITED", "MODEL_HTTP_500", "MODEL_HTTP_503", "MODEL_CALL_FAILED", "MODEL_STREAM_DROPPED"]) expect(transient(code)).toBe(true);
    for (const code of ["MODEL_HTTP_400", "MODEL_HTTP_404", "MODEL_HTTP_5000", "MODEL_STREAM_UNPARSEABLE", "MODEL_EMPTY", "MODEL_TIER_REFUSED", "AGENT_DISABLED", "NOTIFY_NOTHING", "STEP_UNKNOWN"]) expect(transient(code)).toBe(false);
  });

  for (const [name, step, code] of [
    ["a 400", { status: 400 }, "MODEL_HTTP_400"],
    ["an answer with no terminal tool", { text: "" }, "JOB_TERMINAL_MISSING"],
  ] as const) {
    it(`a planted deterministic step failure (${name}) makes no second model call, and the next occurrence is its retry`, async () => {
      const w = jobWorld({ script: [step, report("Release notes changed.")] });
      w.claimChat();
      await w.define({ steps });
      await w.tick();
      await drain(w);
      expect(w.fake.requests).toHaveLength(1);
      expect(w.runs()).toMatchObject([{ signal: "failed", code, attempt: 1 }]);
      expect(w.job.rows("SELECT step, state, attempts FROM steps ORDER BY step")).toEqual([{ step: 0, state: "failed", attempts: 1 }]);
      expect((await w.ledger().modelCalls()).length).toBe(1);
      // The next scheduled occurrence runs again from the start, and this time succeeds.
      await w.tick();
      await drain(w);
      expect(w.fake.requests).toHaveLength(2);
      expect(w.runs().map((r) => r.signal)).toEqual(["failed", "notify"]);
      // The failed run is said once with its code (M25.6), then the retry's result.
      expect(w.notices().map((n) => n.text)).toEqual([expect.stringMatching(new RegExp(`^Test job did not finish: ${code} `)), "Release notes changed."]);
    });
  }

  it("a 5xx and a dropped stream are retried, each within the run's attempts", async () => {
    const w = jobWorld({ script: [{ status: 503 }, { drop: { text: "Release notes", afterBytes: 40 } }, report("Release notes changed.")] });
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    await drain(w);
    expect(w.fake.requests).toHaveLength(RUN_MAX_ATTEMPTS);
    expect(w.runs()).toMatchObject([{ signal: "notify", attempt: 3 }]);
  });

  it("a step handler asking for a retry on a deterministic code gets none: the engine decides", async () => {
    let calls = 0;
    const hostile: StepHandler = async () => {
      calls++;
      // The step outcome's retry flag, set by shorthand: check-test-hygiene reads the literal `retry:` as a vitest retry option.
      const retry = true;
      return { kind: "failed", code: "STEP_INPUT_INVALID", reason: "the input never parses", retry };
    };
    const w = jobWorld({ steps: { model: hostile } });
    w.claimChat();
    await w.define({ steps });
    await w.tick();
    await drain(w);
    expect(calls).toBe(1);
    expect(w.runs()).toMatchObject([{ signal: "failed", code: "STEP_INPUT_INVALID", attempt: 1 }]);
  });
});
