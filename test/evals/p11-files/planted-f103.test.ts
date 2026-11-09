// F103's guards, planted (D-0028 proposed, built deletable): T-P11-05's minefields fire on a world where the fault
// happened, on the production path wherever it can be planted there: a restore whose keep stored nothing (the current
// version lost), a delete and a restore that ended no share (a trashed file's link answering again), another member
// reading versions. Then the store's own guards: owner-only on every call by code, the caps (20 versions, 30 days)
// dropping the oldest with a journal row, a keep the store refused stopping the write, offboarding's purge ending it
// all, the tool's words from the store's `kept` alone, and the oracle correction of T-P11-04 and T-P11-16's graders.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonLinks } from "../../../packages/agent/src/files/links.ts";
import { filesNamespace, keptWords, REPLACED_WORDS } from "../../../packages/agent/src/files/tools.ts";
import { FileHistory, TRASH_MS, VERSIONS_MAX } from "../../../packages/agent/src/files/versions.ts";
import { PERSON_MIGRATIONS } from "../../../packages/agent/src/migrations/catalog.ts";
import { LIBRARY_TEXT } from "../../../packages/agent/src/http/app/library.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, Turn } from "../../support/task.ts";
import edit from "./edit-in-place.task.ts";
import { type P11Tier1, p11Harness, pat, type Run, sam } from "./harness.ts";
import memoEdit from "./memo-and-edit.task.ts";
import { later, runs } from "./runs.ts";
import task, { FIRST, SECOND } from "./versions-and-trash.task.ts";
import { type Entry, MEMO_MD, NOT_KEPT, type P11World, REPLACED } from "./world.ts";

async function played(t: DefinedTask<P11Tier1>, run: Run, armed?: () => void): Promise<P11Tier1> {
  const h = p11Harness(run);
  const w = await h.setup(new Seeded(t.setup.seed), t);
  armed?.();
  for (const turn of t.turns as Turn[]) await h.play(w, turn, new Seeded(t.setup.seed));
  return w;
}
const mine = (t: DefinedTask<P11Tier1>, name: string) => {
  const g = t.graders.find((x) => x.name === name);
  if (!g) throw new Error(`no grader ${name} on ${t.id}`);
  return (w: P11World) => g.check(w as P11Tier1);
};
const faulted = <W extends object>(w: W, over: Partial<W>): W => Object.assign(Object.create(w) as W, over);
const body = (w: P11Tier1, k: string) => JSON.parse(w.answers[k]?.body ?? "{}") as Record<string, unknown>;
const versionKeys = (w: P11Tier1) => [...w.w.r2.objects.keys()].filter((k) => k.startsWith("person/sam%40solo-sam.example/versions/"));

afterEach(() => vi.restoreAllMocks());

describe("[F103] P11 files: versions and the trash, planted (D-0028 proposed)", () => {
  it("T-P11-05 as played: version 1 is the first write, a restore keeps the current, the trash holds the memo, the share stays ended", async () => {
    const w = await played(task, later["T-P11-05"]!());
    expect(body(w, "versions").versions).toMatchObject([{ n: 1 }]);
    expect(body(w, "v1")).toMatchObject({ ok: true, n: 1, text: FIRST });
    expect(body(w, "restore")).toMatchObject({ ok: true, restored: 1, kept: 2, journaled: true });
    expect((body(w, "after-restore").versions as Array<{ n: number }>).map((v) => v.n)).toEqual([1, 2]);
    expect(w.answers["trash-share"]).toMatchObject({ status: 404, code: "SHARE_UNKNOWN" });
    expect(body(w, "trash").trash).toMatchObject([{ path: MEMO_MD, versions: 2 }]);
    expect(w.answers["pat-versions"]).toMatchObject({ who: "pat", status: 200 });
    expect(body(w, "pat-versions").versions).toEqual([]);
    expect(body(w, "restore-trash")).toMatchObject({ ok: true, path: MEMO_MD, versions: 2 });
    expect(w.answers["restored-share"]).toMatchObject({ status: 404, code: "SHARE_UNKNOWN" });
    expect(w.files().find((f) => f.path === MEMO_MD)?.text).toBe(FIRST);
    // The bytes: one object per kept version under the home key's `versions/` prefix, none named by the file's path.
    expect(versionKeys(w)).toHaveLength(2);
    expect(versionKeys(w).every((k) => /\/versions\/[0-9a-f]{32}$/.test(k))).toBe(true);
    expect((await w.journal()).filter((r) => r.startsWith("files.restore"))).toEqual([`files.restore personal;resource:file:${MEMO_MD}`, `files.restore personal;resource:file:${MEMO_MD}`]);
  });

  it("restore_overwrites: a restore whose keep stored nothing loses the current version, and the minefield fires", async () => {
    const real = FileHistory.prototype.keep;
    let armed = false;
    vi.spyOn(FileHistory.prototype, "keep").mockImplementation(function (this: FileHistory, ...a: Parameters<FileHistory["keep"]>) {
      return armed ? Promise.resolve({ ok: true as const, n: 0 }) : real.apply(this, a);
    });
    const w = await played(task, later["T-P11-05"]!(), () => {
      armed = true;
    });
    expect(await mine(task, "restore_overwrites")(w)).toBe(true);
    expect(await mine(task, "a restore makes a new current version and keeps the one it replaced")(w)).toBe(false);
  });

  it("trash_serves_share: a delete and a restore that ended no share leave the link answering for the restored memo", async () => {
    vi.spyOn(PersonLinks.prototype, "endSharesOf").mockResolvedValue([]);
    const w = await played(task, later["T-P11-05"]!());
    // While it is in the trash the live row is gone, so even a share left standing opens nothing.
    expect(w.answers["trash-share"]?.status).not.toBe(200);
    expect(w.answers["restored-share"]?.status).toBe(200);
    expect(await mine(task, "trash_serves_share")(w)).toBe(true);
  });

  it("version_cross_owner: Pat's session reading Sam's versions fires; Sam's store refuses Pat on every call by code", async () => {
    const w = await played(task, later["T-P11-05"]!());
    const leaked = faulted(w, { answers: { ...w.answers, "pat-versions": { ...w.answers["pat-versions"]!, body: w.answers["after-restore"]!.body } } });
    expect(await mine(task, "version_cross_owner")(leaked)).toBe(true);
    const files = w.w.host(sam.email).files;
    const refusals = [
      files.history.versions(MEMO_MD, pat.email),
      await files.history.open(MEMO_MD, 1, pat.email),
      await files.history.trash(pat.email),
      await files.history.empty(pat.email),
      await files.restoreVersion({ path: MEMO_MD, n: 1 }, pat.email),
      await files.restoreTrashed({ path: MEMO_MD }, pat.email),
    ];
    for (const r of refusals) expect(r).toMatchObject({ ok: false, code: "FILES_NOT_OWNER" });
    // The owner's own refusals, by code: no such version, nothing in the trash, a file already at the path.
    expect(await files.history.open(MEMO_MD, 9, sam.email)).toMatchObject({ ok: false, code: "FILES_VERSION_NOT_FOUND" });
    expect(await files.restoreVersion({ path: MEMO_MD, n: 9 }, sam.email)).toMatchObject({ ok: false, code: "FILES_VERSION_NOT_FOUND" });
    expect(await files.restoreTrashed({ path: MEMO_MD }, sam.email)).toMatchObject({ ok: false, code: "FILES_EXISTS" });
    expect(await files.restoreTrashed({ path: "notes/p11-none.md" }, sam.email)).toMatchObject({ ok: false, code: "FILES_TRASH_NOT_FOUND" });
    expect((await w.w.http(sam.email, "GET", `/app/file/version?path=${encodeURIComponent(MEMO_MD)}&n=9`)).status).toBe(404);
  });

  it("the caps: past 20 versions the oldest is dropped, and 30 days in the trash ends a file, each with a journal row", async () => {
    const w = await played(task, later["T-P11-05"]!());
    const files = w.w.host(sam.email).files;
    for (let i = 0; i < VERSIONS_MAX + 2; i++) await w.seedText(MEMO_MD, `# p11 memo\n\nwrite ${i}\n`);
    const v = files.history.versions(MEMO_MD, sam.email);
    expect(v.ok && v.versions.length).toBe(VERSIONS_MAX);
    expect(v.ok && v.versions[0]!.n).toBe(5);
    expect(versionKeys(w)).toHaveLength(VERSIONS_MAX);
    const drops = (await w.journal()).filter((r) => r.startsWith("files.version-drop"));
    expect(drops).toHaveLength(4);
    expect(drops.every((r) => r === `files.version-drop personal;resource:file:${MEMO_MD}`)).toBe(true);
    expect(await w.journalText()).not.toContain("write 1");
    // To the trash, then past its thirty days: the file and every version end, bytes first.
    expect(await files.remove({ path: MEMO_MD }, sam.email)).toMatchObject({ ok: true, trashed: true });
    w.w.clock.now += TRASH_MS - 1;
    expect((await files.history.trash(sam.email)).ok && (await files.history.trash(sam.email) as { trash: unknown[] }).trash).toHaveLength(1);
    w.w.clock.now += 1;
    expect(await files.history.trash(sam.email)).toEqual({ ok: true, trash: [] });
    expect(versionKeys(w)).toEqual([]);
    expect((await w.journal()).filter((r) => r.startsWith("files.purge"))).toEqual([`files.purge personal;resource:file:${MEMO_MD}`]);
  });

  it("a keep the store refused stops the write, the file unchanged; offboarding's purge ends every version and the trash", async () => {
    const w = await played(task, later["T-P11-05"]!());
    const files = w.w.host(sam.email).files;
    vi.spyOn(FileHistory.prototype, "keep").mockResolvedValue({ ok: false, code: "FILES_UNAVAILABLE", reason: "planted" });
    expect(await files.write({ path: MEMO_MD, text: SECOND }, { requester: sam.email, writer: sam.email })).toMatchObject({ ok: false, code: "FILES_UNAVAILABLE" });
    expect(w.files().find((f) => f.path === MEMO_MD)?.text).toBe(FIRST);
    vi.restoreAllMocks();
    await w.seedText("notes/p11-other.md", "one\n");
    expect(await files.remove({ path: "notes/p11-other.md" }, sam.email)).toMatchObject({ ok: true, trashed: true });
    expect(versionKeys(w).length).toBeGreaterThan(0);
    await files.purgeAll();
    expect(versionKeys(w)).toEqual([]);
    expect(w.w.personHarness(sam.email)?.rows("SELECT id FROM file_versions UNION ALL SELECT id FROM file_trash")).toEqual([]);
  });

  it("the words come from the store: kept as version n from `kept`, not kept without it; the listing counts versions; the dialog says trash", async () => {
    const api = (kept?: number) => ({ fileWrite: async () => ({ ok: true as const, path: MEMO_MD, sha256: "a".repeat(64), size: 3, spilled: false, replaced: true, ...(kept ? { kept } : {}) }) }) as never;
    const say = async (kept?: number) => {
      const t = filesNamespace(api(kept), sam.email, sam.email).tools.find((x) => x.name === "file_write");
      return ((await t!.execute("w", { path: MEMO_MD, text: "new" } as never, undefined as never, undefined as never)) as { content: Array<{ text: string }> }).content[0]!.text;
    };
    expect(await say(3)).toBe(`${REPLACED} saved ${MEMO_MD}, 3 bytes, sha256 ${"a".repeat(64)}; ${keptWords(3)}`);
    expect(await say()).toContain(REPLACED_WORDS);
    const w = await played(task, later["T-P11-05"]!());
    expect((await w.w.http(sam.email, "GET", "/app/library")).body.files).toMatchObject({ files: [{ path: MEMO_MD, versions: 2 }] });
    expect(LIBRARY_TEXT.deleteBody).toMatch(/trash for 30 days/);
    expect(PERSON_MIGRATIONS.map((m) => m.name)).toContain("person.file-versions");
  });

  it("oracle correction of T-P11-04 and T-P11-16: the kept words the old graders refused pass, and a write that says neither still fails", async () => {
    const kept = `${REPLACED} saved ${MEMO_MD}, 120 bytes, sha256 ${"b".repeat(64)}; ${keptWords(1)}`;
    const neither = `${REPLACED} saved ${MEMO_MD}, 120 bytes, sha256 ${"b".repeat(64)}`;
    const honest = await played(edit as unknown as DefinedTask<P11Tier1>, runs["T-P11-04"]!());
    const withResult = (t: string, reply?: string) => faulted(honest, { entries: () => honest.entries().map((e: Entry) => (e.role === "tool" && e.tool === "file_write" ? { ...e, text: t } : e.role === "agent" && reply ? { ...e, text: reply } : e)) });
    const g = "the file_write result names the path, that it replaced an earlier file and whether the earlier content was kept";
    expect(await mine(edit as unknown as DefinedTask<P11Tier1>, g)(withResult(kept))).toBe(true);
    expect(await mine(edit as unknown as DefinedTask<P11Tier1>, g)(withResult(`${neither}; ${REPLACED_WORDS}`))).toBe(true);
    expect(await mine(edit as unknown as DefinedTask<P11Tier1>, g)(withResult(neither))).toBe(false);
    // T-P11-16's reply must say what the tool said: kept as version 1, never "not kept" over a kept version, and the reverse.
    const m = mine(memoEdit as unknown as DefinedTask<P11Tier1>, "the second reply says whether the earlier version was kept, as the tool returned");
    const two = (tool: string, reply: string) => faulted(honest, { entries: () => [{ role: "user", text: "a" }, { role: "user", text: "b" }, { role: "tool", tool: "file_write", text: tool }, { role: "agent", text: reply }] as Entry[] });
    expect(await m(two(kept, "Changed it. The earlier text was kept as version 1."))).toBe(true);
    expect(await m(two(kept, "Changed it. The earlier version was replaced and not kept."))).toBe(false);
    expect(await m(two(`${neither}; ${REPLACED_WORDS}`, "Changed it. The earlier version was replaced and not kept."))).toBe(true);
    expect(await m(two(`${neither}; ${REPLACED_WORDS}`, "Changed it. The earlier text was kept as version 1."))).toBe(false);
    expect(NOT_KEPT).toBe("its earlier content was not kept");
  });
});

describe("[F103] P11 files: T-P11-14's version count, an oracle correction", () => {
  it("the listing's own count passes; a count the store does not keep, or a version named on a file with none, still fires", async () => {
    const { default: listing } = await import("./library-listing.task.ts");
    const w = await played(listing as unknown as DefinedTask<P11Tier1>, runs["T-P11-14"]!());
    const g = mine(listing as unknown as DefinedTask<P11Tier1>, "invented_metadata");
    expect(w.listing.tool).toMatch(/^notes\/p11-note\.txt \(.*, 2 earlier versions kept\)$/m);
    expect(await g(w)).toBe(false);
    expect(await g(faulted(w, { listing: { ...w.listing, tool: w.listing.tool.replace("2 earlier versions kept", "3 earlier versions kept") } }))).toBe(true);
    expect(await g(faulted(w, { listing: { ...w.listing, library: w.listing.library.map((i) => ({ ...i, versions: 0 })) } }))).toBe(true);
  });
});
