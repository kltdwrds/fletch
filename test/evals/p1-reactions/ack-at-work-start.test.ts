// T-P1-01 under vitest: the F10 harness with the fake model scripted "react 👍 then a tool call, then words".
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import task from "./ack-at-work-start.task.ts";
import { p1Harness, react } from "./harness.ts";

describe("[F20] P1 reactions: the ack at work start", () => {
  runTask(
    task,
    p1Harness({
      script: [{ toolCalls: [react("👍"), { name: "calendar_list", arguments: {} }] }, { text: "Your week: the walk on Saturday, the dentist on Tuesday." }],
    }),
  );
});
