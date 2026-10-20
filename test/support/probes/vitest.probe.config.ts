// The hermetic config itself, pointed at the probe files: a plant test runs one probe in a child
// vitest so the production setup (hermetic.setup.ts) is what refuses the planted credential or the
// unmatched fetch. Probes are `*.probe.ts`, so the normal lanes never run them.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import base from "../../../vitest.config.ts";

export default defineConfig({
  ...base,
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  test: { ...base.test, include: ["test/support/probes/*.probe.ts"], exclude: ["**/node_modules/**"] },
});
