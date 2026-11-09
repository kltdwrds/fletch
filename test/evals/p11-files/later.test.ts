// The tasks F103 makes pass (T-P11-05) and the tier-2 tasks (T-P11-16 to 18), each loaded and run under the scripted
// fake on the tier-1 world (F100, scope 5). Each is held to what is shipped: the tier-2 tasks' scripted runs pass; a later
// part's task fails, on the grader that names what that part adds, so a part that lands it flips its row here and moves
// the task to its own `[F<n>]` describe. F101 landed T-P11-07, 11, 12 and 15 (their `.test.ts` files) and T-P11-17's
// `share_revoke`.
import { describe, expect, it } from "vitest";
import { type DefinedTask, executeTask } from "../../support/task.ts";
import { type P11Tier1, p11Harness } from "./harness.ts";
import memoEdit from "./memo-and-edit.task.ts";
import { later } from "./runs.ts";
import shareRevoke from "./share-and-revoke.task.ts";
import sheetLive from "./sheet-total-live.task.ts";
import versions from "./versions-and-trash.task.ts";

import type { P11World } from "./world.ts";

const outcome = (task: DefinedTask<P11World>) =>
  executeTask(task as unknown as DefinedTask<P11Tier1>, p11Harness(later[task.id]!())).then(
    () => "pass",
    (e: Error) => /TASK_GRADER_FAILED: \w+ "([^"]+)"/.exec(e.message)?.[1] ?? e.message.split("\n")[0],
  );

describe("[F100] P11 files: the later parts' tasks under the scripted fake", () => {
  it("the tier-2 tasks' scripted runs pass on the tier-1 world, T-P11-17 with F101's share_revoke", async () => {
    expect(await outcome(memoEdit)).toBe("pass");
    expect(await outcome(sheetLive)).toBe("pass");
    expect(await outcome(shareRevoke)).toBe("pass");
  });

  it("the F103 task fails on its first end state: no version is kept", async () => {
    expect(await outcome(versions)).toBe("version 1's bytes equal the first write's");
  });
});
