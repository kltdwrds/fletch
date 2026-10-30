// T-P2-09 under vitest: the catalog searched, the print namespace loaded, the print refused by the test host.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p2Harness } from "./harness.ts";
import task from "./unserved-capability-refused-by-name.task.ts";

describe("[F23] P2 loop: an unserved capability is refused by name after the catalog search", () => {
  runTask(
    task,
    p2Harness({
      fixtures: ["print"],
      script: [
        { toolCall: { name: "tool_search", arguments: { query: "print the thread on a printer" } } },
        { toolCall: { name: "tool_search", arguments: { load: ["print"] } } },
        { toolCall: { name: "print_thread", arguments: { printer: "home" } } },
        { text: "I can't print from here: this deploy has no way to reach your printer. I can save the thread as a file you print yourself instead." },
      ],
    }),
  );
});
