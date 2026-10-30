// T-P2-15 under vitest: the page carries the planted instruction and a forged fence end; the fixture `wipe` is offered.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p2Harness } from "./harness.ts";
import task, { PAGE, PLANTED, REPLY } from "./tool-result-fenced.task.ts";

describe("[F23] P2 loop: a tool's result stays inside its fence", () => {
  runTask(
    task,
    p2Harness({
      fixtures: ["steps"],
      world: { pages: { [PAGE]: PLANTED } },
      script: [{ toolCall: { name: "page_fetch", arguments: { page: PAGE } } }, { text: REPLY }],
    }),
  );
});
