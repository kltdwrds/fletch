// The tasks F101 to F103 make pass (T-P11-05, 07, 11, 12, 15) and the tier-2 tasks (T-P11-16 to 18), each loaded and
// run under the scripted fake on the tier-1 world (F100, scope 5). Each is held to what is shipped: the tier-2 tasks'
// scripted runs pass; each later part's task fails, on the grader that names what that part adds, so a part that lands
// it flips its row here and moves the task to its own `[F<n>]` describe.
import { describe, expect, it } from "vitest";
import { executeTask } from "../../support/task.ts";
import cards from "./cards-current-state.task.ts";
import deck from "./deck-from-document.task.ts";
import del from "./delete-said.task.ts";
import { p11Harness } from "./harness.ts";
import memoEdit from "./memo-and-edit.task.ts";
import { later } from "./runs.ts";
import shareRevoke from "./share-and-revoke.task.ts";
import list from "./share-list-revoke.task.ts";
import sheetLive from "./sheet-total-live.task.ts";
import versions from "./versions-and-trash.task.ts";

const outcome = (task: Parameters<typeof executeTask>[0]) =>
  executeTask(task as never, p11Harness(later[task.id]!()) as never).then(
    () => "pass",
    (e: Error) => /TASK_GRADER_FAILED: \w+ "([^"]+)"/.exec(e.message)?.[1] ?? e.message.split("\n")[0],
  );

describe("[F100] P11 files: the later parts' tasks under the scripted fake", () => {
  it("the tier-2 tasks' scripted runs pass on the tier-1 world but T-P11-17, which needs F101's share_revoke", async () => {
    expect(await outcome(memoEdit)).toBe("pass");
    expect(await outcome(sheetLive)).toBe("pass");
    expect(await outcome(shareRevoke)).toBe("after the revoke the path answers as unknown and the reply says revoked after the tool returned");
  });

  it("each F101 task fails on the grader naming what F101 adds", async () => {
    expect(await outcome(deck)).toBe("documents/p11-memo-deck.pptx exists");
    expect(await outcome(list)).toBe("the list names Sam's two shares with file and expiry");
    expect(await outcome(del)).toBe("the share answers as unknown");
    expect(await outcome(cards)).toBe("the file card says it was deleted");
  });

  it("the F103 task fails on its first end state: no version is kept", async () => {
    expect(await outcome(versions)).toBe("version 1's bytes equal the first write's");
  });
});
