// T-P6-09 is tier 2 (`pnpm evals`, F28); here its file loads and runs under the scripted fake, every grader holding on
// the run of a model that keeps the rules (`scripted` in `runs.ts`). F44's oracle correction: on fletch-pv-3 (trees
// 5890d87 and 9728aaa) every trial failed "one line holds the fact, and c1's first reply cites it after the write",
// because the grader read the chat's first agent bubble, the line the model writes beside its tool call. The slot's
// replies are pinned here verbatim as a pass (only the dates in their citations are the hermetic clock's), and an
// answer without the citation, a recall of the old value and a turn with no answer still fail.
import { describe, expect, it } from "vitest";
import { CORRECTION_LINE } from "./correction-newest-wins.task.ts";
import { citeOf, type P6HarnessOptions, replyFrom, searchFor, writeDaily } from "./harness.ts";
import task from "./remember-and-recall-across-chats.task.ts";
import { graded, scripted } from "./runs.ts";
import { PAT_FACT } from "./world.ts";

describe("[F27] P6 memory, tier 2 under the scripted fake: remember in one chat, recall and correct across two", () => {
  it("every grader holds", async () => {
    const r = await graded(task, scripted["T-P6-09"]!());
    expect(r).toEqual(Object.fromEntries(task.graders.map((g) => [g.name, true])));
  });
});

const last = (r: string[]) => r.at(-1) ?? "";
const found = (r: string[], needle: string) => citeOf(r.findLast((t) => / results for: /.test(t)) ?? "", needle);
/** The slot's run on tree 9728aaa, word for word: a line beside each first call, then the answer. */
function slotRun(o: { c1Answer?: (r: string[]) => string; c2Second?: (r: string[]) => string; c2FirstAnswer?: boolean } = {}): P6HarnessOptions {
  return {
    script: [
      { ...writeDaily("call_pat", PAT_FACT), text: "I'll save Pat Solo's plain-text preference." },
      replyFrom(o.c1Answer ?? ((r) => `Noted — Pat Solo prefers plain text over PDFs. Saved to today's note (${citeOf(last(r))}).`)),
      { ...searchFor("call_s", "Pat Solo", "Who is Pat Solo"), text: "I'll search my memory for Pat Solo." },
      ...(o.c2FirstAnswer === false ? [] : [replyFrom((r) => `I only have that Pat Solo prefers plain text over PDFs (${found(r, "plain text")}).`)]),
      writeDaily("call_fix", CORRECTION_LINE),
      replyFrom((r) => `Updated — Pat Solo prefers Markdown, replacing plain text, in today's note (${citeOf(last(r))}).`),
      { ...searchFor("call_s2", "Pat Solo", "Who is Pat Solo relationship"), text: "I'll search memory for what I know about Pat Solo." },
      replyFrom(o.c2Second ?? ((r) => `Pat Solo prefers Markdown (${found(r, "Markdown")}), replacing the earlier line that Pat Solo prefers plain text over PDFs.`)),
    ],
  };
}
const all = (over: Record<string, boolean> = {}) => ({ ...Object.fromEntries(task.graders.map((g) => [g.name, true])), ...over });

describe("[F44] T-P6-09's reply oracle: each prompt's answer, never the line beside a tool call", () => {
  it("the slot's replies, verbatim, hold every grader", async () => {
    expect(await graded(task, slotRun())).toEqual(all());
  });

  it("planted: an answer after the write without its citation, a recall of the old value, and a recall with no answer still fail", async () => {
    expect(await graded(task, slotRun({ c1Answer: () => "Noted — Pat Solo prefers plain text over PDFs. Saved to today's note." }))).toEqual(all({ "one line holds the fact, and c1's first reply cites it after the write": false }));
    expect(await graded(task, slotRun({ c2Second: (r) => `Pat Solo prefers plain text over PDFs (${found(r, "plain text")}).` }))).toEqual(all({ "c2's second recall gives Markdown": false, old_value_recalled: false }));
    const silent = await graded(task, { script: slotRun({ c2FirstAnswer: false }).script.toSpliced(4, 0, { text: "" }) });
    expect(silent["c2's first recall cites a line that resolves to the fact"]).toBe(false);
  });
});
