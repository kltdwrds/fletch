// Before each file's tests (vitest.config.ts): the test host replaces the factory the agent's entry module
// installed on import, so `hostOf(env)` in every object answers from test/support/host.ts.
import { beforeAll } from "vitest";
import { installTestHost } from "./host.ts";

beforeAll(() => installTestHost());
