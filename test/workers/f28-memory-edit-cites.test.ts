// F28: an edit of MEMORY.md says where each line it wrote now stands, as a daily write says its line (delta 1: the
// reply quotes the citation the tool returned). The citation is taken after every edit of the call, so an insert above
// a written line moves it and a deleted one is not cited; each resolves through memory_get to the text written.
import { describe, expect, it } from "vitest";
import { memorySpecs } from "../../packages/agent/src/memory/tools.ts";
import { p6Harness, sam } from "../evals/p6-memory/harness.ts";
import inPassing from "../evals/p6-memory/in-passing-announced.task.ts";
import { Seeded } from "../support/seeded.ts";

async function world() {
  const w = await p6Harness({ script: [] }).setup(new Seeded(28), inPassing);
  const memory = (await w.svc.standingFiles()).find((f) => f.name === "MEMORY.md")!;
  return { w, sha256: memory.sha256, before: memory.text.replace(/\n$/, "").split("\n") };
}

describe("[F28] a MEMORY.md edit cites the lines it wrote", () => {
  it("each replaced or inserted line is cited where it ends up, and the citation resolves to its text", async () => {
    const { w, sha256, before } = await world();
    const n = before.length;
    const r = await w.svc.memoryWrite(
      { target: "memory", sha256, edits: [{ op: "insert", line: n, text: "- Pat Solo prefers plain text over PDFs" }, { op: "insert", line: 2, text: "- Sam Solo is switching the team meeting to Thursdays" }, { op: "delete", line: 1 }] },
      { requester: sam.email, setting: { scope: "personal" }, source: "chat:c1", dedupe: "edit_1" },
    );
    if (!r.ok || !("citations" in r)) throw new Error(`refused: ${JSON.stringify(r)}`);
    // After line n the line is n + 1; the insert after line 2 moves it to n + 2, and deleting line 1 back to n + 1, while
    // the line inserted after line 2 moves from 3 to 2.
    expect(r.citations).toEqual(["MEMORY.md#L2", `MEMORY.md#L${n + 1}`]);
    for (const [cite, text] of [
      [r.citations[0]!, "Sam Solo is switching"],
      [r.citations[1]!, "Pat Solo prefers plain text"],
    ] as const) {
      const got = await w.get("MEMORY.md", Number(cite.split("#L")[1]), 1);
      expect(got.ok && got.lines[0]!.text).toContain(text);
    }
  });

  it("the tool's words carry the citations, and a replace that a later delete removes is not cited", async () => {
    const { w, sha256 } = await world();
    const write = memorySpecs({ api: w.svc, requester: sam.email, setting: { scope: "personal" }, source: "chat:c1" }).find((t) => t.name === "memory_write")!;
    const out = (await write.execute("call_edit", { target: "memory", sha256, edits: [{ op: "replace", line: 3, text: "- Pat Solo prefers Markdown" }, { op: "insert", line: 1, text: "- Sam Solo walks to work" }] } as never)) as { content: Array<{ text: string }> };
    expect(out.content[0]!.text).toMatch(/^saved MEMORY\.md, now \d+ lines, sha256 [0-9a-f]{64}; wrote MEMORY\.md#L2, MEMORY\.md#L4$/);
    const fresh = (await w.svc.standingFiles()).find((f) => f.name === "MEMORY.md")!;
    const gone = await w.svc.memoryWrite({ target: "memory", sha256: fresh.sha256, edits: [{ op: "replace", line: 2, text: "- replaced then removed" }, { op: "delete", line: 2 }] }, { requester: sam.email, setting: { scope: "personal" }, source: "chat:c1", dedupe: "edit_2" });
    expect(gone.ok && "citations" in gone && gone.citations).toEqual([]);
  });
});
