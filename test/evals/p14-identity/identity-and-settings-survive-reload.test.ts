// T-P14-07 under vitest: the routes and the mode in hermetic Chromium through `harness-browser.ts`.
import { afterAll, describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p14BrowserHarness } from "./harness-browser.ts";
import task from "./identity-and-settings-survive-reload.task.ts";

const h = p14BrowserHarness();
afterAll(() => h.close());

describe("[F40] P14 identity: T-P14-07", () => {
  runTask(task, h);
});
