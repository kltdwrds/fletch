// T-P2-07 under vitest: write, read back, reply with the link, in c1; in c2 Sam's file store refuses every write and
// holds no file (the `PersonFiles` the chat reaches, swapped for the second turn), and the same script reports it.
import { describe } from "vitest";
import task, { PATH } from "./effect-before-reply.task.ts";
import { p2Harness, sam } from "./harness.ts";
import { runTask } from "../../support/task.ts";

const steps = (reply: string) => [
  { toolCall: { name: "tool_search", arguments: { load: ["files"] } } },
  { toolCall: { name: "file_write", arguments: { path: PATH, text: "The barrier holds.\n" } } },
  { toolCall: { name: "file_read", arguments: { path: PATH } } },
  { text: reply },
];

describe("[F23] P2 loop: the write's result is stored before the reply that reports it", () => {
  runTask(
    task,
    p2Harness({
      chats: ["c1", "c2"],
      script: [...steps(`Saved and checked: [${PATH}](files/${PATH}).`), ...steps(`I could not save ${PATH}: your file store refused the write, so there is nothing to attach.`)],
      before: (world, i) => {
        if (i !== 1) return;
        const files = world.w.host(sam.email).files;
        files.write = async () => ({ ok: false, code: "FILES_UNAVAILABLE", reason: "this store refuses writes" });
        files.read = async (input) => ({ ok: false, code: "FILES_NOT_FOUND", reason: `no file at ${input.path}` });
      },
    }),
  );
});
