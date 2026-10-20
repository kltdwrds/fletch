// M24.3 item 2, one vocabulary: the Agents SDK Workspace is the person's working tree `work/`, and the
// one `files` namespace reads, writes, edits, greps and finds there; the home store keeps read, write,
// list and delete and has no edit, grep or find. Ada and Bo of Solo Sam throughout: Bo's agent never
// reads, lists, greps or finds Ada's tree, and a compromised Bo model cannot reach it either.
import { describe, expect, it } from "vitest";
import { filesNamespace } from "../../packages/agent/src/files/tools.ts";
import { directTreeApi, treeOf } from "../../packages/agent/src/tree/rpc.ts";
import { type PersonTree, TREE_PAGE_BYTES } from "../../packages/agent/src/tree/tree.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";

/** A real Workspace over a Person object's SQLite, for `owner`. */
function treeFor(owner: string): PersonTree {
  let tree: PersonTree | undefined;
  new ObjectHarness(owner, (ctx) => {
    tree = treeOf((ctx as DurableObjectState).storage, owner);
    return {};
  }, {}).instance;
  return tree as PersonTree;
}
const run = async (ns: ReturnType<typeof filesNamespace>, tool: string, args: Record<string, unknown>) => {
  const spec = ns.tools.find((t) => t.name === tool);
  if (!spec) throw new Error(`no ${tool}`);
  const r = await spec.execute("t", args as never, undefined, undefined);
  return r.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("");
};
const homeOnly = { fileList: async () => ({ ok: true as const, files: [] }), fileRead: async () => ({ ok: false as const, code: "FILES_NOT_FOUND" as const, reason: "none" }), fileWrite: async () => ({ ok: false as const, code: "FILES_UNAVAILABLE" as const, reason: "none" }), fileDelete: async () => ({ ok: false as const, code: "FILES_NOT_FOUND" as const, reason: "none" }) };

describe("[M24.3] one vocabulary", () => {
  it("the files namespace is the one vocabulary: read, write, edit, grep, find, list and delete, with write, edit and delete as writes", () => {
    const ns = filesNamespace(homeOnly, ada.email, `agent:${ada.email}`, { tree: directTreeApi(treeFor(ada.email)) });
    expect(ns.tools.map((t) => t.name)).toEqual(["file_list", "file_read", "file_write", "file_edit", "file_grep", "file_find", "file_delete"]);
    expect(ns.tools.filter((t) => t.mutates).map((t) => t.name)).toEqual(["file_write", "file_edit", "file_delete"]);
  });

  it("an edit whose oldText is missing or occurs twice is refused with its code, and the file is unchanged", async () => {
    const tree = treeFor(ada.email);
    await tree.write({ path: "work/notes.md", text: "venue\nvenue\ncatering\n" }, ada.email);
    expect(await tree.edit({ path: "work/notes.md", oldText: "florist", newText: "x" }, ada.email)).toMatchObject({ ok: false, code: "TREE_EDIT_NOT_FOUND" });
    expect(await tree.edit({ path: "work/notes.md", oldText: "venue", newText: "hall" }, ada.email)).toMatchObject({ ok: false, code: "TREE_EDIT_NOT_UNIQUE" });
    expect(await tree.edit({ path: "work/notes.md", oldText: "", newText: "hall" }, ada.email)).toMatchObject({ ok: false, code: "TREE_EDIT_INVALID" });
    expect(await tree.read({ path: "work/notes.md" }, ada.email)).toMatchObject({ ok: true, lines: [{ n: 1, text: "venue" }, { n: 2, text: "venue" }, { n: 3, text: "catering" }, { n: 4, text: "" }] });
    expect(await tree.edit({ path: "work/notes.md", oldText: "venue\ncatering", newText: "hall\ncatering" }, ada.email)).toMatchObject({ ok: true, line: 2 });
  });

  it("edit, grep and find on a home path are refused with FILES_TREE_ONLY; read, write, list and delete still reach the home store", async () => {
    const w = authorityWorld({ stores: true, script: [] });
    const ns = filesNamespace(w.filesOf(ada.email), ada.email, `agent:${ada.email}`, { tree: directTreeApi(w.host(ada.email).tree) });
    expect(await run(ns, "file_write", { path: "notes/todo.md", text: "venue\n" })).toMatch(/^saved notes\/todo\.md/);
    expect(await run(ns, "file_read", { path: "notes/todo.md" })).toContain("1: venue");
    for (const [tool, args] of [["file_edit", { path: "notes/todo.md", oldText: "venue", newText: "hall" }], ["file_grep", { pattern: "venue", path: "notes" }], ["file_find", { pattern: "*.md", path: "notes" }]] as const) {
      await expect(run(ns, tool, args)).rejects.toThrow(/^FILES_TREE_ONLY: file_(edit|grep|find) works on the working tree/);
    }
    expect(await run(ns, "file_list", {})).toContain("notes/todo.md");
    expect(await w.host(ada.email).files.read({ path: "notes/todo.md" }, ada.email)).toMatchObject({ ok: true, lines: [{ n: 1, text: "venue" }, { n: 2, text: "" }] });
    expect(await run(ns, "file_delete", { path: "notes/todo.md" })).toBe("deleted notes/todo.md");
  });

  it("a long line is cut on its page with a marker, never passed off as whole", async () => {
    const tree = treeFor(ada.email);
    await tree.write({ path: "work/wide.txt", text: `short\n${"x".repeat(TREE_PAGE_BYTES * 2)}\nafter` }, ada.email);
    expect(await tree.read({ path: "work/wide.txt" }, ada.email)).toMatchObject({ ok: true, kind: "text", lines: [{ n: 1, text: "short" }], cut: [], next: 2, pages: 3 });
    const r = await tree.read({ path: "work/wide.txt", from: 2 }, ada.email);
    expect(r).toMatchObject({ ok: true, kind: "text", cut: [2], next: 3 });
    if (!r.ok || r.kind !== "text") throw new Error("not text");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.text).toMatch(/\[TREE_LINE_CUT: this line is \d+ bytes/);
  });
});
