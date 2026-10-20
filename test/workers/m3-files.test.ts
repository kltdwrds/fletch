// M3.1: the person's files on the Person object: small files in SQLite, large ones spilled to R2
// and read back under their sha256, paths held inside the person's prefix, and the owner alone
// (Ada and Bo are the two members).
import { describe, expect, it } from "vitest";
import { FILE_MAX, INLINE_MAX, parseFilePath, PersonFiles } from "../../packages/agent/src/files/store.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { asBucket, FakeR2 } from "./support/fake-r2.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;

function setup() {
  const r2 = new FakeR2();
  const person = new ObjectHarness(ada.email, (ctx) => new PersonFiles((ctx as DurableObjectState).storage, asBucket(r2), ada.email, () => 1_000), {});
  return { r2, files: () => person.instance, person };
}
const writer = `agent:${ada.email}`;

describe("[M3.1] files", () => {
  it("a small file stays in the object's SQLite and a large one spills to R2, each read back in numbered pages", async () => {
    const { r2, files } = setup();
    expect(await files().write({ path: "notes/todo.md", text: "a\nb\nc" }, { requester: ada.email, writer })).toMatchObject({ ok: true, size: 5, spilled: false });
    expect(r2.puts).toEqual([]);
    const big = "x".repeat(INLINE_MAX + 1);
    const w = await files().write({ path: "data/big.txt", text: big }, { requester: ada.email, writer });
    expect(w).toMatchObject({ ok: true, size: INLINE_MAX + 1, spilled: true });
    expect(r2.puts).toEqual([`person/${encodeURIComponent(ada.email)}/files/data/big.txt`]);
    expect(r2.meta(r2.puts[0]!)).toMatchObject({ writer, updated_at: "1000" });
    const read = await files().read({ path: "notes/todo.md", from: 2, limit: 1 }, ada.email);
    expect(read).toMatchObject({ ok: true, total: 3, lines: [{ n: 2, text: "b" }], next: 3, spilled: false });
    const bigRead = await files().read({ path: "data/big.txt" }, ada.email);
    expect(bigRead).toMatchObject({ ok: true, spilled: true, total: 1, lines: [{ n: 1, text: big }], next: null });
    expect((await files().list({}, ada.email))).toMatchObject({ ok: true, files: [{ path: "data/big.txt", spilled: true }, { path: "notes/todo.md", spilled: false }] });
    // Shrinking back inline removes the spilled copy.
    await files().write({ path: "data/big.txt", text: "small now" }, { requester: ada.email, writer });
    expect(r2.text(r2.puts[0]!)).toBeUndefined();
  });

  it("a spilled copy that was replaced behind the record is refused with FILES_UNAVAILABLE, never served", async () => {
    const { r2, files } = setup();
    await files().write({ path: "data/big.txt", text: "y".repeat(INLINE_MAX + 1) }, { requester: ada.email, writer });
    r2.tamper(r2.puts[0]!, "z".repeat(INLINE_MAX + 1));
    expect(await files().read({ path: "data/big.txt" }, ada.email)).toMatchObject({ ok: false, code: "FILES_UNAVAILABLE" });
  });

  it("paths stay inside the person's files prefix and sizes are bounded", async () => {
    const { files } = setup();
    for (const bad of ["../MEMORY.md", "/etc/passwd", "a//b", "notes/", ".hidden", "a/../b", "", "x".repeat(201)]) expect(parseFilePath(bad)).toBeNull();
    expect(parseFilePath("notes/2026-10-12.draft.md")).toBe("notes/2026-10-12.draft.md");
    expect(await files().read({ path: "../MEMORY.md" }, ada.email)).toMatchObject({ ok: false, code: "FILES_PATH_INVALID" });
    expect(await files().write({ path: "huge.txt", text: "x".repeat(FILE_MAX + 1) }, { requester: ada.email, writer })).toMatchObject({ ok: false, code: "FILES_TOO_LARGE" });
    expect(await files().read({ path: "missing.txt" }, ada.email)).toMatchObject({ ok: false, code: "FILES_NOT_FOUND" });
  });
});
