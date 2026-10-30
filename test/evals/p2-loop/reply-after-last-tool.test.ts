// T-P2-03 under vitest: a 👍 on Sam's message, two lookups, then the two-paragraph reply.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p2Harness } from "./harness.ts";
import task, { PARAS } from "./reply-after-last-tool.task.ts";

describe("[F23] P2 loop: nothing streams before the last tool result", () => {
  runTask(
    task,
    p2Harness({
      fixtures: ["steps"],
      script: [
        { toolCall: { name: "react", arguments: { emoji: "👍" } } },
        { toolCall: { name: "steps_lookup", arguments: { n: 1 } } },
        { toolCall: { name: "steps_lookup", arguments: { n: 2 } } },
        { text: PARAS.join("\n\n") },
      ],
    }),
  );
});
