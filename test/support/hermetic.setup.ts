// Hermetic lane setup, run before every test file (vitest.config.ts): the process carries no
// credential, and the network is upstream's interceptor with nothing allowed through. An unmatched
// fetch throws where it is made, and the afterAll below fails the file if one was made at all, so a
// test that swallows the error still fails.
import { afterAll } from "vitest";
import { assertHermeticEnv } from "./env-guard.ts";
import { hermeticNetwork } from "./hermetic-network.ts";

assertHermeticEnv(process.env);

hermeticNetwork.install();

afterAll(() => {
  hermeticNetwork.uninstall();
  const escaped = hermeticNetwork.getUnmockedCalls();
  hermeticNetwork.reset();
  if (escaped.length) throw new Error(`HERMETIC_NETWORK_ESCAPE: ${escaped.length} unmatched outbound request(s): ${escaped.join(", ")}`);
});
