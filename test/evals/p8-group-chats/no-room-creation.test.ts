// T-P8-10 under vitest: the scripted run in `runs.ts` in hermetic Chromium through `harness-browser.ts` (Q60).
import { afterAll, describe, vi } from "vitest";
import { runTask } from "../../support/task.ts";
import { p8BrowserHarness } from "./harness-browser.ts";
import task from "./no-room-creation.task.ts";
import { runs } from "./runs.ts";

// Two Chromium contexts, each menu opened in turn: past the default 5 s on a loaded run.
vi.setConfig({ testTimeout: 60_000 });
const h = p8BrowserHarness(runs["T-P8-10"]!());
afterAll(() => h.close());

describe("[F60] P8 group chats: T-P8-10", () => {
  runTask(task, h);
});
