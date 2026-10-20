// M2.1: personal memory in the Person object's store and the tenant bucket, through the object
// harness and an in-memory R2. Sam Solo owns the memory; Bo Wren (same company) and Cal Tide
// (another company) are the other people a search may be executed for.
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../packages/agent/src/memory/home.ts";
import { DAY1, memoryFor } from "./support/memory-harness.ts";
import { SEED_RUN } from "./support/seed-claim.ts";
import people from "../fixtures/people.json" with { type: "json" };

const ada = people.people.find((p) => p.id === "sam-solo")!;
const personal = { scope: "personal" as const };

const okWrite = (r: unknown) => {
  expect(r).toMatchObject({ ok: true });
  return r as { ok: true; path: string; line: number; citation: string; claimId?: string };
};

describe("[M2.1] home tree", () => {

  it("seeds the standing files with sha256, writer and updated_at metadata", async () => {
    const { r2, svc, key } = memoryFor();
    const files = await svc().standingFiles();
    expect(files.map((f) => f.name)).toEqual(["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "MEMORY.md"]);
    for (const f of files) {
      const meta = r2.meta(key(f.name));
      expect(meta).toEqual({ sha256: await sha256Hex(r2.text(key(f.name))!), writer: "qyvr:seed", updated_at: String(DAY1) });
      expect(f.sha256).toBe(meta?.sha256);
    }
  });
});

describe("[M2.1] daily notes", () => {
  it("round-trips a line: written, rendered to R2 on the timer, and its citation resolves to the same text", async () => {
    const { r2, svc, key, write } = memoryFor();
    const w = okWrite(await write("Ada prefers the Thursday planning meeting at 10:00."));
    expect(w.citation).toBe("memory/2026-10-12.md#L3");
    // Buffered as a row until the timer renders it.
    expect(r2.text(key("memory/2026-10-12.md"))).toBeUndefined();
    expect(await svc().renderPending()).toEqual(["2026-10-12"]);
    const body = r2.text(key(w.path))!;
    expect(body.split("\n")[w.line - 1]).toBe("- Ada prefers the Thursday planning meeting at 10:00.");
    expect(r2.meta(key(w.path))).toMatchObject({ writer: "qyvr:render", sha256: await sha256Hex(body) });
    const page = await svc().memoryGet({ path: w.path, from: w.line, limit: 1 }, ada.email);
    expect(page).toMatchObject({ ok: true, lines: [{ n: 3, text: "- Ada prefers the Thursday planning meeting at 10:00." }] });
  });

  it("is append-only and idempotent by the tool call id, so a resumed step does not write twice", async () => {
    const { person, write } = memoryFor();
    okWrite(await write("First line.", {}, "call_1"));
    const again = okWrite(await write("First line.", {}, "call_1"));
    okWrite(await write("Second line.", {}, "call_2"));
    expect(again.line).toBe(3);
    expect(person.rows("SELECT line, text FROM daily_lines ORDER BY line")).toEqual([
      { line: 3, text: "First line." },
      { line: 4, text: "Second line." },
    ]);
  });

  it("refuses empty and over-long lines with stable codes", async () => {
    const { write } = memoryFor();
    expect(await write("   ")).toMatchObject({ ok: false, code: "MEMORY_EMPTY" });
    expect(await write("x".repeat(1001))).toMatchObject({ ok: false, code: "MEMORY_TOO_LONG" });
  });
});

describe("[M2.1] MEMORY.md edits", () => {
  it("applies line-addressed edits against the sha256 read, and the sha guard rejects a stale edit", async () => {
    const { r2, svc, key } = memoryFor();
    const read = await svc().memoryGet({ path: "MEMORY.md" }, ada.email);
    if (!read.ok) throw new Error(read.code);
    const facts = read.lines.find((l) => l.text === "## Facts")!.n;
    const first = await svc().memoryWrite({ target: "memory", sha256: read.sha256, edits: [{ op: "insert", line: facts, text: "- Ada's team is Platform." }] }, { requester: ada.email, setting: personal, source: "t", dedupe: "e1" });
    expect(first).toMatchObject({ ok: true });
    const after = r2.text(key("MEMORY.md"))!;
    expect(after.split("\n")[facts]).toBe("- Ada's team is Platform.");
    // The same stale sha again: refused, with the current sha, and nothing written.
    const stale = await svc().memoryWrite({ target: "memory", sha256: read.sha256, edits: [{ op: "delete", line: facts + 1 }] }, { requester: ada.email, setting: personal, source: "t", dedupe: "e2" });
    expect(stale).toMatchObject({ ok: false, code: "MEMORY_STALE", sha256: await sha256Hex(after) });
    expect(r2.text(key("MEMORY.md"))).toBe(after);
  });

  it("the etag precondition refuses a write over a version another writer replaced mid-edit", async () => {
    const { r2, svc, key } = memoryFor();
    const mem = svc().mem;
    await mem.standingFiles();
    const before = await mem.home.read("MEMORY.md");
    r2.tamper(key("MEMORY.md"), "# MEMORY.md\n\nchanged elsewhere\n");
    expect(await mem.home.write("MEMORY.md", "mine\n", "agent:x", DAY1, before!.etag)).toEqual({ ok: false, code: "MEMORY_STALE" });
    expect(r2.text(key("MEMORY.md"))).toBe("# MEMORY.md\n\nchanged elsewhere\n");
  });
});

describe("[M2.1] search", () => {
  it("finds a written fact by full-text search under different phrasings, with its citation", async () => {
    const { svc, write } = memoryFor();
    okWrite(await write("Ada's dentist appointment moved to the 14th."));
    const w = okWrite(await write("Ada prefers green tea in afternoon meetings.", { claim: { kind: "preference" } }));
    const r = await svc().memorySearch({ queries: ["what does Ada drink in a meeting", "tea preference"] }, ada.email);
    if (!r.ok) throw new Error(r.code);
    expect(r.hits[0]).toMatchObject({ citation: w.citation, uri: `memory://md:${w.path}:${w.line}`, text: "Ada prefers green tea in afternoon meetings." });
    expect(r.hits[0]?.claims).toEqual([{ id: w.claimId, kind: "preference", status: "active", supersedes: null, supersededBy: null, validUntil: null }]);
  });

  it("treats query text as terms only, never as FTS syntax", async () => {
    const { svc, write } = memoryFor();
    okWrite(await write("Quarterly budget review with finance."));
    for (const q of ['budget" OR *', "NEAR(budget review)", "budget) AND (", "-budget ^review"]) {
      expect((await svc().memorySearch({ queries: [q] }, ada.email)).ok).toBe(true);
    }
  });

  it("explains a claim's provenance: source line, writer, setting and the chain both ways", async () => {
    const { svc, write } = memoryFor();
    const a = okWrite(await write("The offsite is in Lisbon.", { claim: { kind: "fact" } }));
    const b = okWrite(await write("The offsite moved to Porto.", { claim: { kind: "correction", supersedes: a.claimId } }));
    const c = okWrite(await write("The offsite is back in Lisbon, final.", { claim: { kind: "correction", supersedes: b.claimId } }));
    expect(await svc().memoryExplain({ claimId: b.claimId }, ada.email)).toMatchObject({
      ok: true,
      citation: b.citation,
      sourceText: "The offsite moved to Porto.",
      writer: `agent:${ada.email}`,
      // Since M15.2 every claim is the upkeep's, so its source is the minting run; the line keeps its writer.
      learnedIn: { scope: "personal", source: SEED_RUN, audience: null },
      supersedes: [a.claimId],
      supersededBy: [c.claimId],
    });
    expect(await svc().memoryExplain({ citation: c.citation }, ada.email)).toMatchObject({ claim: { id: c.claimId }, supersedes: [b.claimId, a.claimId] });
  });
});

describe("[M2.1] forget", () => {

  it("plans from a phrase and retracts every claim on the planned lines", async () => {
    const { svc, person, write } = memoryFor();
    okWrite(await write("Ada's old phone number ends in 42.", { claim: { kind: "fact" } }));
    okWrite(await write("Lunch with the design team on Friday.", { claim: { kind: "event" } }));
    const plan = await svc().forgetPlan({ query: "old phone number" }, ada.email);
    if (!plan.ok) throw new Error(plan.code);
    expect(plan.claims.map((c) => c.quote)).toEqual(["Ada's old phone number ends in 42."]);
    expect(await svc().forgetConfirm(plan.planId, ada.email)).toMatchObject({ ok: true, claims: 1 });
    expect(person.rows("SELECT quote FROM claims")).toEqual([{ quote: "Lunch with the design team on Friday." }]);
    expect(await svc().forgetPlan({ query: "nothing like this" }, ada.email)).toMatchObject({ code: "MEMORY_FORGET_NOTHING" });
  });
});
