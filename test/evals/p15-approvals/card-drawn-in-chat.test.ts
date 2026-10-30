// T-P15-02 under vitest; its run (script, seed and events) is in `runs.ts`, shared with `planted.test.ts`.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { runs } from "./runs.ts";
import task from "./card-drawn-in-chat.task.ts";

describe("[F25] P15 approvals: the card is drawn in its chat with the matrix's choices, and on the Approvals tab", () => {
  runTask(task, runs["T-P15-02"]());
});
