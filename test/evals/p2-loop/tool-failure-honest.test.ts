// T-P2-08 under vitest: the files namespace loaded, the missing file read, the failure said in words.
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import { p2Harness, sam } from "./harness.ts";
import task, { MARKER, MISSING } from "./tool-failure-honest.task.ts";

describe("[F23] P2 loop: a failed read is a failure on its row and in plain words", () => {
  runTask(
    task,
    p2Harness({
      seed: async (world) => {
        const r = await world.w.host(sam.email).files.write({ path: "p2-notes.md", text: `${MARKER}\n` }, { requester: sam.email, writer: `person:${sam.email}` });
        if (!r.ok) throw new Error(`P2_SEED: ${r.code}`);
      },
      script: [
        { toolCall: { name: "tool_search", arguments: { load: ["files"] } } },
        { toolCall: { name: "file_read", arguments: { path: MISSING } } },
        { text: `There is no file named ${MISSING} in your files, so there is nothing to read: it does not exist.` },
      ],
    }),
  );
});
