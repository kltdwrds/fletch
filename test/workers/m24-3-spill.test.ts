// M24.3 item 6, spill: a tool result over SPILL_THRESHOLD (16 KiB of text) is written to the owner's
// working tree under work/spill/ and replaced in context by a stub naming its size with a file_read
// pointer; reading the pointer page by page gives the result back whole. Hooked once, in
// `toAgentTool`, so it holds on the production path of a real chat for Ada and for Bo.
import { describe, expect, it } from "vitest";
import { SPILL_THRESHOLD, wrapLong } from "../../packages/agent/src/tree/spill.ts";
import { TREE_PAGE_BYTES } from "../../packages/agent/src/tree/tree.ts";
import { toAgentTool } from "../../packages/agent/src/tools/registry.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

/** 300 lines of about 120 characters, each numbered so a cut shows. */
const big = (who: string) => Array.from({ length: 300 }, (_, i) => `row ${String(i + 1).padStart(3, "0")} ${who} Henley ledger ${"·".repeat(90)}`).join("\n");

describe("[M24.3] spill", () => {

  it("every page of the pointer read back in order is the spilled result, line for line", async () => {
    const w = authorityWorld({ stores: true, script: [] });
    const tree = w.host(ada.email).tree;
    const text = big(ada.name);
    const sink = async (path: string, t: string) => {
      const r = await tree.write({ path, text: t }, ada.email);
      return r.ok ? ({ ok: true } as const) : r;
    };
    const tool = toAgentTool({ name: "ledger_dump", kind: "observation", label: "d", description: "d", parameters: { type: "object" } as never, execute: async () => ({ content: [{ type: "text", text }], details: {} }) }, undefined, sink);
    const r = await tool.execute("c1", {} as never, undefined, undefined);
    expect(r.details).toMatchObject({ spilled: true, path: "work/spill/ledger_dump-c1.txt" });
    const lines: string[] = [];
    for (let from: number | null = 1; from !== null; ) {
      const page = await tree.read({ path: "work/spill/ledger_dump-c1.txt", from }, ada.email);
      if (!page.ok || page.kind !== "text") throw new Error("unreadable page");
      expect(page.cut).toEqual([]);
      lines.push(...page.lines.map((l) => l.text));
      from = page.next;
    }
    expect(lines.join("\n")).toBe(text);
  });

  it("a result at the threshold passes unchanged, and one over it with no tree says SPILL_UNAVAILABLE and shows only a marked head", async () => {
    const at = "a".repeat(SPILL_THRESHOLD);
    const make = (text: string) => toAgentTool({ name: "dump", kind: "observation", label: "d", description: "d", parameters: { type: "object" } as never, execute: async () => ({ content: [{ type: "text", text }], details: {} }) });
    expect((await make(at).execute("x", {} as never, undefined, undefined)).content).toEqual([{ type: "text", text: at }]);
    const over = `${"b".repeat(SPILL_THRESHOLD)}\nTAIL-MARKER`;
    const r = await make(over).execute("x", {} as never, undefined, undefined);
    const shown = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    expect(shown).toMatch(/^SPILL_UNAVAILABLE: the dump result is 16396 bytes \(2 lines\).*could not be stored.*the rest is not shown/s);
    expect(shown).not.toContain("TAIL-MARKER");
    expect(Buffer.byteLength(shown)).toBeLessThan(2 * 1024);
  });

  it("a spilled line over the wrap width is wrapped so no page of the spill is ever cut", () => {
    const w = wrapLong(`a\n${"z".repeat(5000)}\nb`);
    expect(w.wrapped).toBe(true);
    expect(w.text.split("\n").map((l) => l.length)).toEqual([1, 2000, 2000, 1000, 1]);
    expect(TREE_PAGE_BYTES).toBeGreaterThan(2000 + 8);
  });
});
