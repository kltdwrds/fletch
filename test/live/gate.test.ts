import { describe, expect, it } from "vitest";
import { liveEnabled, liveEnv, scrubLive } from "../../scripts/accept.ts";
import config from "../../vitest.config.ts";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

describe("[F1] live test: the lane's gate", () => {
  it("runs only with QYVR_LIVE=1 and both account variables", () => {
    const full = { QYVR_LIVE: "1", CF_LIVE_ACCOUNT_ID: ACCOUNT, CF_LIVE_TOKEN: "t" };
    expect(liveEnabled(full)).toBe(true);
    expect(liveEnabled({ ...full, QYVR_LIVE: "0" })).toBe(false);
    expect(liveEnabled({ ...full, CF_LIVE_TOKEN: "" })).toBe(false);
    expect(liveEnabled({ ...full, CF_LIVE_ACCOUNT_ID: undefined })).toBe(false);
    expect(liveEnabled({})).toBe(false);
  });

  it("hands the child the account and no hermetic marker", () => {
    const env = liveEnv({ QYVR_LIVE: "1", CF_LIVE_ACCOUNT_ID: ACCOUNT, CF_LIVE_TOKEN: "t", GITHUB_RUN_ID: "9", UNRELATED: "x" });
    expect(env).toMatchObject({ QYVR_LIVE: "1", CF_LIVE_ACCOUNT_ID: ACCOUNT, CF_LIVE_TOKEN: "t", GITHUB_RUN_ID: "9" });
    expect(env.QYVR_HERMETIC).toBeUndefined();
    expect(env.UNRELATED).toBeUndefined();
  });

  it("hides the token and the setup link in the lane's output", () => {
    const out = scrubLive("ok\nopen https://x.workers.dev/login?setup=abc\nfailed with tok-123 inside", "tok-123");
    expect(out).toBe("ok\n[setup link hidden]\nfailed with [token] inside");
  });

  it("the hermetic config never collects a *.live.test.ts file", () => {
    expect(config.test?.exclude).toContain("test/**/*.live.test.ts");
    expect(config.test?.include).not.toContain("test/**/*.live.test.ts");
  });
});
