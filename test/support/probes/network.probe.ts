// Run by harness.test.ts in a child vitest, one test at a time. Each makes or swallows an outbound
// fetch that no handler matches; the hermetic setup must fail it either way.
import { describe, expect, it } from "vitest";

describe("[M0.2] probe: network", () => {
  it("makes no request", () => {
    expect(typeof fetch).toBe("function");
  });

  it("awaits an unmatched fetch", async () => {
    await fetch("https://unmatched.example/awaited");
  });

  it("swallows an unmatched fetch", async () => {
    const outcome = await fetch("https://unmatched.example/swallowed").then(
      () => "answered",
      () => "refused",
    );
    expect(outcome).toBe("refused");
  });
});
