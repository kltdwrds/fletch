import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hermeticEnv } from "../../scripts/accept.ts";
import config from "../../vitest.config.ts";
import { assertHermeticEnv, credentialVariables } from "./env-guard.ts";
import { repoRoot } from "./temp-repo.ts";

/** Runs the environment probe in a child vitest under the hermetic config, as accept's step 3 would. */
function probe(env: NodeJS.ProcessEnv) {
  const res = spawnSync(join(repoRoot, "node_modules/.bin/vitest"), ["run", "--config", "test/support/probes/vitest.probe.config.ts", "env.probe"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

const PLANTED_VALUE = "planted-value-for-the-env-guard-0001";

describe("[M0.2] env guard", () => {
  it("the hermetic environment this test runs in carries no credential", () => {
    expect(credentialVariables(process.env)).toEqual([]);
    expect(process.env.QYVR_HERMETIC).toBe("1");
  });

  it("names credential and account variables, never their values", () => {
    const env = { PATH: "/bin", QYVR_PLANTED_TOKEN: PLANTED_VALUE, OPENAI_API_KEY: "x", DB_PASSWORD: "x", CLOUDFLARE_ACCOUNT_ID: "x", CF_ZONE: "x", TOKENS_USED: "1" };
    expect(credentialVariables(env)).toEqual(["CF_ZONE", "CLOUDFLARE_ACCOUNT_ID", "DB_PASSWORD", "OPENAI_API_KEY", "QYVR_PLANTED_TOKEN"]);
    expect(() => assertHermeticEnv(env)).toThrow(/^HERMETIC_CREDENTIAL_PRESENT: CF_ZONE, CLOUDFLARE_ACCOUNT_ID/);
    expect(() => assertHermeticEnv(env)).not.toThrow(new RegExp(PLANTED_VALUE));
    expect(() => assertHermeticEnv({ PATH: "/bin", TOKENS_USED: "1" })).not.toThrow();
  });

  it("fails on a planted credential in the hermetic environment", () => {
    const clean = probe(hermeticEnv());
    expect(clean.out).toMatch(/1 passed/);
    expect(clean.status).toBe(0);

    const planted = probe({ ...hermeticEnv(), QYVR_PLANTED_TOKEN: PLANTED_VALUE });
    expect(planted.status).not.toBe(0);
    expect(planted.out).toMatch(/HERMETIC_CREDENTIAL_PRESENT: QYVR_PLANTED_TOKEN\./);
    expect(planted.out).not.toContain(PLANTED_VALUE);
  }, 60_000);

  it("the hermetic vitest config loads no env file and runs the guard before every file", () => {
    expect(config.envDir).toBe(false);
    expect(config.test?.env).toBeUndefined();
    expect(config.test?.setupFiles).toEqual(["test/support/hermetic.setup.ts"]);
  });
});
