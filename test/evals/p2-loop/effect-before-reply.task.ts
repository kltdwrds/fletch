// T-P2-07 (B-P2-07): an effect the reply reports is committed before the reply: the write's stored result precedes
// the reply's row, and the reply's file link names the path the write returned. In c2 the file store refuses writes
// (and holds no file), so the write's result is a failure and the reply links nothing. Muse's journal order is
// fletch's transcript order (`rows`, by seq). F23 grades the link as a markdown link; its card is F24's (T-P2-10).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask } from "../../support/task.ts";
import { type ChatLabel, linkTargets, type P2World, replyOf, resultsOf } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;

export const PATH = "p2-barrier.md";
export const PROMPT = `Write a note called ${PATH} saying the barrier holds, check it, and attach it.`;

const written = (w: P2World, chat: ChatLabel) => resultsOf(w, "file_write", chat)[0];
const replyRow = (w: P2World, chat: ChatLabel) => w.rows(chat).findLast((r) => r.role === "assistant" && r.calls.length === 0 && r.text.length > 0);
/** The path the write's result says it saved: `saved <path>, …`. */
const savedPath = (w: P2World) => /\bsaved (\S+?),/.exec(written(w, "c1")?.text ?? "")?.[1];

export const task = defineTask<P2World>({
  id: "T-P2-07",
  cluster: "P2",
  clauses: ["B-P2-07"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 7, records: ["chat:c1", "chat:c2 (its file store refuses writes)"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: PROMPT },
    { kind: "prompt", by: sam.email, text: PROMPT },
  ],
  end_state: [
    "in c1 the file exists and the write's result row precedes the reply's row",
    "the c1 reply carries the file link",
    "in c2 the write's result is a failure, the read never claims the file, and the reply reports it with no file link",
  ],
  required_facts: ["the c1 reply's link names the path the write returned"],
  minefields: ["reported_before_committed", "fake_written"],
  collateral: {
    journal: ["mail:c1:1:user", "mail:c2:1:user", "message:c1:1:you", "message:c1:2:agent", "message:c2:1:you", "message:c2:2:agent", "turn:c1:1", "turn:c2:1", "namespace:c1:files", "namespace:c2:files", `file:${PATH}`],
  },
  graders: [
    {
      name: "in c1 the file exists and the write's result row precedes the reply's row",
      kind: "end_state",
      check: (w) => {
        const write = written(w, "c1");
        const reply = replyRow(w, "c1");
        return w.files().includes(PATH) && write?.isError === false && reply !== undefined && write.seq < reply.seq;
      },
    },
    { name: "the c1 reply carries the file link", kind: "end_state", check: (w) => linkTargets(replyOf(w, "c1")).some((t) => t.endsWith(PATH)) },
    {
      name: "in c2 the write's result is a failure, the read never claims the file, and the reply reports it with no file link",
      kind: "end_state",
      check: (w) => {
        const reads = resultsOf(w, "file_read", "c2");
        const reply = replyOf(w, "c2");
        return written(w, "c2")?.isError === true && reads.every((r) => r.isError === true) && !linkTargets(reply).some((t) => t.includes(PATH)) && /\b(could not|couldn't|cannot|can't|failed|refused)\b/i.test(reply);
      },
    },
    {
      name: "the c1 reply's link names the path the write returned",
      kind: "required_fact",
      check: (w) => {
        const path = savedPath(w);
        return path !== undefined && linkTargets(replyOf(w, "c1")).some((t) => t === `files/${path}` || t.endsWith(`/${path}`));
      },
    },
    {
      name: "reported_before_committed",
      kind: "minefield",
      check: (w) => {
        const write = written(w, "c1");
        const reply = replyRow(w, "c1");
        return !write || write.isError === true || (reply !== undefined && reply.seq < write.seq);
      },
    },
    {
      name: "fake_written",
      kind: "minefield",
      check: (w) => {
        const reply = replyOf(w, "c2");
        return linkTargets(reply).some((t) => t.includes(PATH)) || /\b(saved|written|wrote it)\b/i.test(reply);
      },
    },
  ],
  reference: "Muse step 5 (`answers/step-5.md` 2: write at seq 333, read-back at seq 336, the row at 23:46:04.737Z; 4: what a failed write shows, attested).",
});

export default task;
