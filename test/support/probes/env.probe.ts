// Run by env-guard.test.ts in a child vitest. It passes on its own; with a credential planted in the
// child's environment, hermetic.setup.ts must refuse the file before this test runs.
import { describe, expect, it } from "vitest";

describe("[M0.2] probe: environment", () => {
  it("runs in the hermetic lane", () => {
    expect(process.env.QYVR_HERMETIC).toBe("1");
  });
});
