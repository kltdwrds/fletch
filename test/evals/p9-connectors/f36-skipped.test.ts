// The four P9 tasks that grade F36's surfaces (the capture item, a row's status word and last use, Disconnect, every
// grant in one pane) read `P9SurfaceWorld`, which F36's harness implements. Until then each is loaded here and skipped
// by name (`it.todo`), so `pnpm accept` counts it as skipped, never as passed.
import { describe, expect, it } from "vitest";
import disconnect from "./disconnect-is-the-persons-and-says-what-remains.task.ts";
import grants from "./grants-listed-once.task.ts";
import status from "./status-is-stored-and-said.task.ts";
import unfinished from "./unfinished-setup-is-seen-and-ended.task.ts";

describe("[F35] P9 connectors: the tasks F36 runs", () => {
  it("each loads with its id, clause and graders", () => {
    expect([unfinished, status, disconnect, grants].map((t) => [t.id, t.clauses[0], t.graders.length > 0])).toEqual([
      ["T-P9-02", "B-P9-02", true],
      ["T-P9-08", "B-P9-08", true],
      ["T-P9-09", "B-P9-09", true],
      ["T-P9-10", "B-P9-10", true],
    ]);
  });
  it.todo("T-P9-02 waits on F36: the capture item and Dismiss (P9 delta 1)");
  it.todo("T-P9-08 waits on F36: the Connected row's status word and last use (P9 delta 5)");
  it.todo("T-P9-09 waits on F36: Disconnect on the Connected row (P9 delta 6)");
  it.todo("T-P9-10 waits on F36: the Permissions pane (P9 delta 7)");
});
