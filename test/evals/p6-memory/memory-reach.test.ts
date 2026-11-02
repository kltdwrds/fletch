// F44, memory's reach (Q22): the two changes F28's verifier left for a later part, and the person page's tool path.
// (1) A MEMORY.md edit returns the citation of each line it wrote, so the reply can quote it and T-P6-04's graders see a
//     silent MEMORY.md save. (2) A new fact goes to today's note through the existing write, and the reply says so.
// (3) `memory_write` target person reaches `upsertEntity` on a stated relationship, refused by code for a name that is
//     not a person's or that the person did not write in their own message; the page is read where pages are listed.
// Each item has its fault planted on the production path: a line without its citation, a fact that went nowhere, a
// page asked for a non-person or for a name only the model wrote.
import { describe, expect, it } from "vitest";
import { MEMORY_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import { namedIn, notAPerson } from "../../../packages/agent/src/memory/entities.ts";
import { memorySpecs } from "../../../packages/agent/src/memory/tools.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask } from "../../support/task.ts";
import { callFrom, citeOf, type P6HarnessOptions, p6Harness, replyFrom, sam, writeDaily } from "./harness.ts";
import inPassing, { PROMPT as IN_PASSING } from "./in-passing-announced.task.ts";
import page, { STATED } from "./people-page-real-model.task.ts";
import { INDEX, PAGE, SECTIONS } from "./people-page-shape.task.ts";
import acrossChats, { REMEMBER } from "./remember-and-recall-across-chats.task.ts";
import { notePerson, scripted } from "./runs.ts";
import { type P6World, PAT_FACT, SAM_FACT } from "./world.ts";

async function played(task: DefinedTask<P6World>, o: P6HarnessOptions, turns = task.turns) {
  const h = p6Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = await h.setup(rng, task);
  for (const t of turns) await h.play(world, t, rng);
  return world;
}
const verdicts = async (task: DefinedTask<P6World>, w: P6World) => Object.fromEntries(await Promise.all(task.graders.map(async (g) => [g.name, g.kind === "minefield" ? !(await g.check(w)) : await g.check(w)])));
/** One grader's check, run alone (the others read a chat the shortened run never opened). */
const check = (task: DefinedTask<P6World>, name: string) => task.graders.find((g) => g.name === name)!.check;
const allHold = (task: DefinedTask<P6World>) => Object.fromEntries(task.graders.map((g) => [g.name, true]));
const last = (r: string[]) => r.at(-1) ?? "";
const ctx = { requester: sam.email, setting: { scope: "personal" as const }, source: "chat:c1" };

/** A memory_get of MEMORY.md, then one insert after its `## Facts` heading against the sha it returned. */
const memoryEdit = (text: string) => [
  { toolCall: { id: "call_read", name: "memory_get", arguments: { path: "MEMORY.md" } } },
  callFrom((r) => ({ id: "call_edit", name: "memory_write", arguments: { target: "memory", sha256: /sha256 ([0-9a-f]{64})/.exec(last(r))?.[1] ?? "", edits: [{ op: "insert", line: 3, text: `- ${text}` }] } })),
];

describe("[F44] (1) a MEMORY.md edit cites each line it wrote", () => {
  async function world() {
    const w = await played(inPassing, { script: [] }, []);
    const memory = (await w.svc.standingFiles()).find((f) => f.name === "MEMORY.md")!;
    return { w, sha256: memory.sha256, before: memory.text.replace(/\n$/, "").split("\n") };
  }

  it("each replaced or inserted line is cited where it ends up, and the citation resolves to its text", async () => {
    const { w, sha256, before } = await world();
    const n = before.length;
    const r = await w.svc.memoryWrite(
      { target: "memory", sha256, edits: [{ op: "insert", line: n, text: `- ${PAT_FACT}` }, { op: "insert", line: 2, text: `- ${SAM_FACT}` }, { op: "delete", line: 1 }] },
      { ...ctx, dedupe: "edit_1" },
    );
    if (!r.ok || !("citations" in r)) throw new Error(`refused: ${JSON.stringify(r)}`);
    // After line n the line is n + 1; the insert after line 2 moves it to n + 2, and deleting line 1 back to n + 1,
    // while the line inserted after line 2 moves from 3 to 2.
    expect(r.citations).toEqual(["MEMORY.md#L2", `MEMORY.md#L${n + 1}`]);
    for (const [cite, text] of [[r.citations[0]!, "Sam Solo is switching"], [r.citations[1]!, "Pat Solo prefers plain text"]] as const) {
      const got = await w.get("MEMORY.md", Number(cite.split("#L")[1]), 1);
      expect(got.ok && got.lines[0]!.text).toContain(text);
    }
  });

  it("the tool's words carry the citations, and a replace that a later delete removes is not cited", async () => {
    const { w, sha256 } = await world();
    const write = memorySpecs({ api: w.svc, ...ctx }).find((t) => t.name === "memory_write")!;
    const out = (await write.execute("call_edit", { target: "memory", sha256, edits: [{ op: "replace", line: 3, text: "- Pat Solo prefers Markdown" }, { op: "insert", line: 1, text: "- Sam Solo walks to work" }] } as never)) as { content: Array<{ text: string }> };
    expect(out.content[0]!.text).toMatch(/^saved MEMORY\.md, now \d+ lines, sha256 [0-9a-f]{64}; wrote MEMORY\.md#L2, MEMORY\.md#L4$/);
    const fresh = (await w.svc.standingFiles()).find((f) => f.name === "MEMORY.md")!;
    const gone = await w.svc.memoryWrite({ target: "memory", sha256: fresh.sha256, edits: [{ op: "replace", line: 2, text: "- replaced then removed" }, { op: "delete", line: 2 }] }, { ...ctx, dedupe: "edit_2" });
    expect(gone.ok && "citations" in gone && gone.citations).toEqual([]);
  });

  it("through the chat, a MEMORY.md save the reply cites holds every T-P6-04 grader", async () => {
    const w = await played(inPassing, { script: [...memoryEdit(SAM_FACT), replyFrom((r) => `Saved in MEMORY.md: ${SAM_FACT} (${/MEMORY\.md#L\d+/.exec(last(r))?.[0] ?? ""}).`)] });
    expect(w.writes()).toEqual([{ ok: true, code: null, text: expect.stringMatching(/; wrote MEMORY\.md#L4\n/) }]);
    expect(await verdicts(inPassing, w)).toEqual(allHold(inPassing));
  });

  it("planted: a MEMORY.md save said only as \"Noted\" is a line without its citation, and T-P6-04's silent_save fires", async () => {
    const w = await played(inPassing, { script: [...memoryEdit(SAM_FACT), { text: "Noted." }] });
    expect(await w.file("MEMORY.md")).toContain(SAM_FACT);
    const r = await verdicts(inPassing, w);
    expect(r.silent_save).toBe(false);
    expect(r["either the reply names each line it saved with its citation, or nothing was written"]).toBe(false);
  });
});

describe("[F44] (2) a new fact goes to today's note, and the reply says so", () => {
  const TODAY = MEMORY_WORDS.split("\n").find((l) => l.startsWith("Save a new fact as one line in today's note"));

  it("the model is sent the line in its task block, and the run that writes today's note and says so holds every T-P6-09 grader", async () => {
    expect(TODAY).toMatch(/memory_write with target daily/);
    expect(TODAY).toMatch(/say in the reply that it is in today's note/);
    expect(TODAY).toMatch(/Edit MEMORY\.md only when the person asks/);
    const w = await played(acrossChats, scripted["T-P6-09"]!());
    expect(w.context("c1")).toContain(TODAY);
    expect(w.context("c2")).toContain(MEMORY_WORDS.split("\n").find((l) => l.startsWith("When asked about a person or a past fact, search memory in that turn")));
    expect(await verdicts(acrossChats, w)).toEqual(allHold(acrossChats));
  });

  it("planted: a fact said saved with no write went nowhere, and T-P6-09's first grader fails", async () => {
    const w = await played(acrossChats, { script: [{ text: `Saved: ${PAT_FACT}.` }] }, acrossChats.turns.slice(0, 1));
    expect(w.lines()).toEqual([]);
    expect(await check(acrossChats, "one line holds the fact, and c1's first reply cites it after the write")(w)).toBe(false);
  });

  it("planted: the fact put in MEMORY.md instead of today's note, even cited, is not today's line, and the grader fails", async () => {
    const w = await played(acrossChats, { script: [...memoryEdit(PAT_FACT), replyFrom((r) => `Saved: ${PAT_FACT} (${/MEMORY\.md#L\d+/.exec(last(r))?.[0] ?? ""}).`)] }, acrossChats.turns.slice(0, 1));
    expect(w.lines()).toEqual([]);
    expect(await w.file("MEMORY.md")).toContain(PAT_FACT);
    expect(await check(acrossChats, "one line holds the fact, and c1's first reply cites it after the write")(w)).toBe(false);
  });

  it("the line the reply quotes is today's, dated by its file and attributed by code", async () => {
    const w = await played(acrossChats, { script: [writeDaily("call_pat", PAT_FACT), replyFrom((r) => `Saved to today's note: ${PAT_FACT} (${citeOf(last(r))}).`)] }, acrossChats.turns.slice(0, 1));
    expect(w.lines()).toEqual([{ citation: expect.stringMatching(/^memory\/\d{4}-\d{2}-\d{2}\.md#L3$/), text: PAT_FACT, source: "chat:c1", writer: `agent:${sam.email}` }]);
    expect(w.entries("c1").filter((e) => e.kind === "agent").at(-1)?.text).toContain(`today's note: ${PAT_FACT} (${w.lines()[0]!.citation})`);
    expect(REMEMBER).toContain("remember");
  });
});

describe("[F44] (3) a person page the chat can write, on a stated relationship", () => {
  const stated = page.turns.slice(3);

  it("target person saves the line and writes Pat's page, read where pages are listed: the index, memory_get, search and the next turn's context", async () => {
    const w = await played(page, { ...scripted["T-P6-14"]!(), script: [...scripted["T-P6-14"]!().script, { text: "Every Monday." }] }, [...page.turns, { kind: "prompt", by: sam.email, text: "when do Pat Solo and I talk?" }]);
    const line = w.lines().find((l) => l.text.startsWith("Pat Solo: co-founder"))!;
    expect(line).toEqual({ citation: expect.stringMatching(/^memory\/\d{4}-\d{2}-\d{2}\.md#L3$/), text: "Pat Solo: co-founder; we talk every Monday", source: "chat:c1", writer: `agent:${sam.email}` });
    expect(w.writes().at(-1)).toEqual({ ok: true, code: null, text: expect.stringContaining(`\nsaved ${line.citation}; wrote the person page ${PAGE}\n`) });
    const text = (await w.file(PAGE))!;
    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(SECTIONS);
    expect(text).toMatch(new RegExp(`## Facts\\n- co-founder; we talk every Monday — ${line.citation.replace(/[.]/g, "\\.")}\\n`));
    expect(text).toMatch(/## The relationship\n- co-founder; we talk every Monday — memory\//);
    expect(await w.file(INDEX)).toMatch(/^- \[Pat Solo\]\(pat-solo\.md\) \(rank 1\): co-founder; we talk every Monday$/m);
    const got = await w.get(PAGE);
    expect(got.ok && got.lines.some((l) => l.text === "# Pat Solo")).toBe(true);
    expect((await w.search(["Pat Solo co-founder", "co-founder"])).hits.map((h) => h.citation)).toEqual(expect.arrayContaining([expect.stringMatching(/^memory\/people\/pat-solo\.md#L\d+$/), line.citation]));
    // The index is hoisted with the standing files, never the page (B-P6-11).
    expect(w.context("c1")).toContain("[Pat Solo](pat-solo.md)");
    expect(w.context("c1")).not.toContain("## Strengthening");
    expect(w.paths().filter((p) => p.startsWith("memory/people/"))).toEqual(expect.arrayContaining([PAGE, INDEX]));
    expect(w.paths().filter((p) => p.startsWith("memory/people/") && p !== INDEX)).toEqual([PAGE]);
  });

  it("the same call replayed writes one line and one cited fact; a restated relationship updates the summary and keeps the rank", async () => {
    const w = await played(page, { script: [] }, []);
    const said = { ...ctx, said: STATED };
    for (const _ of [1, 2]) expect((await w.svc.memoryWrite({ target: "person", name: "Pat Solo", relationship: "co-founder" }, { ...said, dedupe: "call_rel" })).ok).toBe(true);
    expect(w.lines()).toHaveLength(1);
    expect(((await w.file(PAGE)) ?? "").match(/^- co-founder — /gm)).toHaveLength(2);
    w.svc.mem.sql.exec("UPDATE entities SET rank = 7 WHERE slug = 'pat-solo'");
    const again = await w.svc.memoryWrite({ target: "person", name: "Pat Solo", relationship: "co-founder and best friend" }, { ...said, said: "Pat Solo is my co-founder and best friend", dedupe: "call_rel_2" });
    expect(again.ok).toBe(true);
    expect(await w.file(INDEX)).toMatch(/\[Pat Solo\]\(pat-solo\.md\) \(rank 7\): co-founder and best friend/);
    expect(((await w.file(PAGE)) ?? "").match(/^## Facts\n(- .+\n)+/m)?.[0].split("\n").filter(Boolean)).toHaveLength(3);
  });

  it("planted: a name the person did not write is refused by code through the chat, and no page or line lands", async () => {
    const w = await played(page, { script: [notePerson("call_rel", "Sam Solo", "co-founder"), replyFrom((r) => `I could not save that: ${last(r)}`)] }, stated);
    expect(w.writes()).toEqual([{ ok: false, code: "MEMORY_PERSON_NOT_NAMED", text: expect.any(String) }]);
    expect(w.paths().filter((p) => p.startsWith("memory/"))).toEqual([]);
    expect(w.lines()).toEqual([]);
  });

  it("planted: a name only a tool result or memory holds is not the person's words; the page is refused", async () => {
    const seedLine = async (w: Awaited<ReturnType<typeof played>>) => {
      await w.svc.memoryWrite({ target: "daily", text: PAT_FACT }, { ...ctx, dedupe: "seed" });
    };
    const w = await played(
      page,
      { seed: seedLine, script: [{ toolCall: { id: "call_s", name: "memory_search", arguments: { queries: ["document preference", "plain text"] } } }, notePerson("call_rel", "Pat Solo", "prefers plain text"), replyFrom((r) => `Refused: ${last(r)}`)] },
      [{ kind: "prompt", by: sam.email, text: "make a page for whoever my notes say prefers plain text; they are my co-founder" }],
    );
    expect(w.writes()).toEqual([{ ok: false, code: "MEMORY_PERSON_NOT_NAMED", text: expect.any(String) }]);
    expect(await w.file(PAGE)).toBeNull();
  });

  it("planted: a company, a team, a thing and a lowercase phrase are not a person, refused by code through the chat", async () => {
    for (const [name, said] of [
      ["Acme Corp", "Acme Corp is my biggest client"],
      ["Design Team", "Design Team is the group I lead"],
      ["Monday standup", "Monday standup is my favourite meeting"],
      ["the Monday standup", "the Monday standup is my favourite meeting"],
      ["Pat Solo 2", "Pat Solo 2 is my co-founder"],
    ] as const) {
      const w = await played(page, { script: [notePerson("call_rel", name, "client"), replyFrom((r) => `Refused: ${last(r)}`)] }, [{ kind: "prompt", by: sam.email, text: said }]);
      expect({ name, writes: w.writes().map((x) => x.code) }).toEqual({ name, writes: ["MEMORY_PERSON_NOT_A_PERSON"] });
      expect(w.paths().filter((p) => p.startsWith("memory/"))).toEqual([]);
    }
  });

  it("planted: a group page's name, an empty relationship, a credential, a job's write (no words typed) and another requester are refused", async () => {
    const w = await played(page, { script: [] }, []);
    await w.svc.upsertEntity({ kind: "groups", displayName: "Pat Solo", summary: "a group", rank: 1 }, `agent:${sam.email}`);
    const code = async (input: { name: string; relationship: string }, over: Record<string, unknown> = {}) => {
      const r = await w.svc.memoryWrite({ target: "person", ...input }, { ...ctx, said: STATED, dedupe: `d_${Math.random()}`, ...over });
      return r.ok ? "ok" : r.code;
    };
    expect(await code({ name: "Pat Solo", relationship: "co-founder" })).toBe("MEMORY_PERSON_NOT_A_PERSON");
    w.svc.mem.sql.exec("DELETE FROM entities WHERE kind = 'groups'");
    expect(await code({ name: "Pat Solo", relationship: " ; " })).toBe("MEMORY_PERSON_NO_RELATIONSHIP");
    expect(await code({ name: "Pat Solo", relationship: "co-founder, card 4111 1111 1111 1111" })).toBe("MEMORY_VALUE_REFUSED");
    expect(await code({ name: "Pat Solo", relationship: "co-founder" }, { said: undefined })).toBe("MEMORY_PERSON_NOT_NAMED");
    expect(await code({ name: "Pat Solo", relationship: "co-founder" }, { requester: "pat@solo-sam.example" })).toBe("MEMORY_NOT_OWNER");
    expect(await w.file(PAGE)).toBeNull();
    expect(w.lines()).toEqual([]);
    expect(await code({ name: "Pat Solo", relationship: "co-founder" })).toBe("ok");
  });

  it("what reads as a person, and where the person named them", () => {
    for (const ok of ["Pat Solo", "Pat", "Ana de la Cruz", "Seán O'Brien", "Mary-Jane Watson", "Dr. Rees"]) expect({ ok, why: notAPerson(ok) }).toEqual({ ok, why: null });
    for (const bad of ["pat solo", "Acme Inc", "Solo Sam Ltd", "Pat Solo 2", "pat@solo-sam.example", "Monday standup", "A B C D E F", ""]) expect(notAPerson(bad)).not.toBeNull();
    expect(namedIn("by the way, PAT  SOLO is my co-founder", "Pat Solo")).toBe(true);
    expect(namedIn("Patrick Solomon is my co-founder", "Pat Solo")).toBe(false);
    expect(namedIn("Pat Solo's dog", "Pat Solo")).toBe(true);
  });
});
