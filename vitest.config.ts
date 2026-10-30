import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The hermetic lane: no credential, deny-all network. `envDir: false` loads no env file of any kind; nothing
// here reads .dev.vars, and test/support/env-guard.test.ts holds both. The same setup runs before the agent's
// tests under test/ and the primitives' tests under packages/host*/test/.

export default defineConfig({
  envDir: false,
  resolve: {
    // Worker modules import `cloudflare:workers`; under Node the shim stands in for the base
    // classes so the production fetch handlers run unchanged.
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./test/support/cloudflare-workers.ts", import.meta.url)),
      "cloudflare:email": fileURLToPath(new URL("./test/support/cloudflare-email.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "packages/host*/test/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    setupFiles: ["test/support/hermetic.setup.ts", "test/support/host.setup.ts"],
    environment: "node",
    // The Agents SDK imports `cloudflare:*` modules; inlining it lets the aliases above apply.
    server: { deps: { inline: ["agents", "@cloudflare/computer"] } },
  },
});
