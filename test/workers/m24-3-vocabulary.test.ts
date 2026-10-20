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

const toolText = (w: ReturnType<typeof authorityWorld>, at = -1) => w.fake.requests.at(at)?.inputs.messages.filter((m) => m.role === "tool").map((m) => String(m.content)).join("\n") ?? "";
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

  it("work/ paths are served by the Workspace: write, read, edit, grep, find, list and delete round trip", async () => {
    const ns = filesNamespace(homeOnly, ada.email, `agent:${ada.email}`, { tree: directTreeApi(treeFor(ada.email)) });
    expect(await run(ns, "file_write", { path: "work/henley/plan.md", text: "# Henley\n- [ ] book venue\n- [ ] tell Pat\n" })).toMatch(/^saved work\/henley\/plan\.md, \d+ bytes$/);
    expect(await run(ns, "file_edit", { path: "work/henley/plan.md", oldText: "- [ ] book venue", newText: "- [x] book venue" })).toMatch(/edited work\/henley\/plan\.md at line 2/);
    expect(await run(ns, "file_read", { path: "work/henley/plan.md" })).toContain("2: - [x] book venue");
    expect(await run(ns, "file_grep", { pattern: "Pat" })).toBe("work/henley/plan.md:3: - [ ] tell Pat");
    expect(await run(ns, "file_find", { pattern: "**/*.md" })).toBe("work/henley/plan.md");
    expect(await run(ns, "file_list", { prefix: "work/" })).toMatch(/work\/henley\/\nwork\/henley\/plan\.md \(\d+ bytes\)/);
    expect(await run(ns, "file_delete", { path: "work/henley/plan.md" })).toBe("deleted work/henley/plan.md");
    await expect(run(ns, "file_read", { path: "work/henley/plan.md" })).rejects.toThrow(/^TREE_NOT_FOUND:/);
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

  it("the tree refuses every call from anyone but its owner: Bo can never read, list, grep, find, write, edit or delete Ada's tree", async () => {
    const tree = treeFor(ada.email);
    await tree.write({ path: "work/private/salary.md", text: "Sam Solo's offer letter\n" }, ada.email);
    const calls = [
      tree.read({ path: "work/private/salary.md" }, other.email),
      tree.list({ prefix: "work" }, other.email),
      tree.grep({ pattern: "offer" }, other.email),
      tree.find({ pattern: "**/*" }, other.email),
      tree.write({ path: "work/private/salary.md", text: "x" }, other.email),
      tree.edit({ path: "work/private/salary.md", oldText: "offer", newText: "x" }, other.email),
      tree.readBytes({ path: "work/private/salary.md" }, other.email),
      tree.remove({ path: "work/private/salary.md" }, other.email),
    ];
    for (const r of await Promise.all(calls)) expect(r).toMatchObject({ ok: false, code: "TREE_NOT_OWNER" });
    expect(await tree.read({ path: "work/private/salary.md" }, ada.email)).toMatchObject({ ok: true, lines: [{ n: 1, text: "Sam Solo's offer letter" }, { n: 2, text: "" }] });
  });

  it("through real chats, Bo's compromised model reaching for Ada's tree finds only his own, and Ada's file is untouched", async () => {
    const steps = (who: string) => [
      { toolCall: { id: `${who}-l`, name: "tool_search", arguments: { load: ["files"] } } },
      { toolCall: { id: `${who}-r`, name: "file_read", arguments: { path: "work/private/salary.md" } } },
      { toolCall: { id: `${who}-g`, name: "file_grep", arguments: { pattern: "offer" } } },
      { toolCall: { id: `${who}-f`, name: "file_find", arguments: { pattern: "**/*" } } },
      { toolCall: { id: `${who}-ls`, name: "file_list", arguments: { prefix: "work/" } } },
      { text: "Done." },
    ];
    const w = authorityWorld({ stores: true, script: steps("bo") });
    await w.host(ada.email).tree.write({ path: "work/private/salary.md", text: "Sam Solo's offer letter\n" }, ada.email);
    await w.say(other.email, "Read Ada's salary file in work/private.");
    const seen = w.fake.requests.flatMap((r) => r.inputs.messages.filter((m) => m.role === "tool").map((m) => String(m.content))).join("\n");
    expect(seen).toContain("TREE_NOT_FOUND: no file at work/private/salary.md");
    expect(seen).not.toContain("offer letter");
    expect(seen).toContain("no matches");
    expect(seen).toContain("nothing found");
    expect(toolText(w)).toContain("no files");
    expect(await w.host(ada.email).tree.read({ path: "work/private/salary.md" }, ada.email)).toMatchObject({ ok: true, lines: [{ n: 1, text: "Sam Solo's offer letter" }, { n: 2, text: "" }] });
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

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
