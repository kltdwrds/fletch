// T-P14-07 under vitest: the routes and the mode in hermetic Chromium through `harness-browser.ts`.
import { afterAll, describe, vi } from "vitest";
import { runTask } from "../../support/task.ts";
import { p14BrowserHarness } from "./harness-browser.ts";
import task from "./identity-and-settings-survive-reload.task.ts";

// Twenty Chromium contexts (five routes, two widths, each reloaded) and the mode: past the default 5 s on a loaded run.
vi.setConfig({ testTimeout: 60_000 });
const h = p14BrowserHarness();
afterAll(() => h.close());

describe("[F40] P14 identity: T-P14-07", () => {
  runTask(task, h);
});
