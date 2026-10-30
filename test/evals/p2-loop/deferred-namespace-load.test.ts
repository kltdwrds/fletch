// T-P2-01 under vitest: the probe is loaded by one `tool_search` in the first turn and called again in the second
// with no load.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task, { PROBE } from "./deferred-namespace-load.task.ts";
import { p2Harness } from "./harness.ts";

describe("[F23] P2 loop: a deferred namespace loads once and stays", () => {
  runTask(
    task,
    p2Harness({
      fixtures: ["probe"],
      script: [{ toolCall: { name: "tool_search", arguments: { load: ["probe"] } } }, { toolCall: { name: PROBE, arguments: {} } }, { text: "3 readings." }, { toolCall: { name: PROBE, arguments: {} } }, { text: "3 readings again." }],
    }),
  );
});
