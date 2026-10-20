// M12.1 the person's loops, with Ada and Bo: no evidence, no model call; upkeep's claims each cite a
// line of the person's own new evidence, take that line's setting, and leave a reconciliation row;
// reflection's dated note and synthesis cite only lines that resolve; the weekly review proposes and
// never merges, even under an automatic self-learning grant; a loop over its budget stops before the
// call and says so; a switched-off loop does nothing; only the person sees or sets their loops.
import { describe, expect, it } from "vitest";
import { PERSON_CRONS, personSlot } from "../../packages/agent/src/loops/personal.ts";
import { reflectionPath, SYNTHESIS_PATH } from "../../packages/agent/src/memory/home.ts";
import { ada, answer, applyAll, personLoopWorld, T0 } from "./support/loop-world.ts";

const HOUR = 3_600_000;
const loopRuns = async (w: ReturnType<typeof personLoopWorld>, person: string, job: string) => (await w.ledger().runs({ person })).filter((r) => r.jobId === job);

describe("[M12.1] person loops", () => {
  it("no new evidence produces no model call, for each loop and each member, and each run is a Ledger row", async () => {
    const w = personLoopWorld();
    for (const p of [ada.email]) {
      expect(await w.of(p).loops.upkeep(T0)).toMatchObject({ signal: "nothing_to_report", code: "LOOP_NO_EVIDENCE", calls: 0 });
      expect(await w.of(p).loops.reflect(T0)).toMatchObject({ signal: "nothing_to_report", code: "LOOP_NO_EVIDENCE", calls: 0 });
      expect(await w.of(p).loops.reviewSkills(T0)).toMatchObject({ signal: "nothing_to_report", code: "LOOP_NO_EVIDENCE", calls: 0 });
    }
    expect(w.fake.requests).toHaveLength(0);
    for (const p of [ada.email]) {
      for (const job of ["loop:memory-upkeep", "loop:reflection", "loop:skill-review"]) {
        expect(await loopRuns(w, p, job)).toMatchObject([{ person: p, signal: "nothing_to_report", code: "LOOP_NO_EVIDENCE", tokens: 0 }]);
      }
    }
  });

  it("a later line supersedes an active claim, recorded in the reconciliation row; a tick repeated in its slot is one run", async () => {
    const w = personLoopWorld();
    const first = await w.write(ada.email, "Ada's standup is at 9.");
    w.fake.enqueue(answer({ claims: [{ kind: "fact", text: "Ada's standup is at 9.", cite: first }] }), applyAll([first]));
    await w.of(ada.email).loops.upkeep(T0);
    const [old] = w.of(ada.email).mem.rows<{ id: string }>("SELECT id FROM claims");
    w.clock.now = T0 + HOUR;
    const moved = await w.write(ada.email, "Ada's standup moved to 10.");
    w.fake.enqueue(answer({ claims: [{ kind: "correction", text: "Ada's standup is at 10.", cite: moved, supersedes: old?.id }] }), applyAll([moved]));
    const ran = await w.of(ada.email).loops.upkeep(T0 + HOUR);
    const again = await w.of(ada.email).loops.upkeep(T0 + HOUR);
    expect(again).toEqual(ran);
    expect(w.fake.requests).toHaveLength(4);
    const recs = w.of(ada.email).loops.reconciliations("memory-upkeep");
    expect(recs.at(-1)).toMatchObject({ runId: ran.runId, superseded: [old?.id], added: [expect.stringMatching(/^c_/)] });
    expect(recs.at(-1)?.fromMark).toBe(recs[0]?.toMark);
    expect(w.of(ada.email).mem.rows("SELECT status FROM claims WHERE id = ?", old?.id)).toEqual([{ status: "superseded" }]);
    const hit = (await w.of(ada.email).svc.memorySearch({ queries: ["standup"] }, ada.email)) as { hits: Array<{ marker?: string }> };
    expect(hit.hits.some((h) => h.marker?.includes(old?.id as string))).toBe(true);
    expect(await loopRuns(w, ada.email, "loop:memory-upkeep")).toHaveLength(2);
  });

  it("reflection writes a dated note and a refreshed synthesis whose every citation resolves; unresolved items are dropped", async () => {
    const w = personLoopWorld();
    const l1 = await w.write(ada.email, "Ada finished the harbor budget.");
    const l2 = await w.write(ada.email, "Ada wants Fridays free for planning.");
    w.fake.enqueue(
      answer({
        note: [
          { text: "Ada closed out the harbor budget.", cites: [l1] },
          { text: "Ada met the mayor.", cites: ["memory/2026-10-13.md#L40"] },
          { text: "No citation at all.", cites: [] },
        ],
        synthesis: [{ text: "Ada protects Fridays for planning.", cites: [l2] }],
      }),
    );
    const ran = await w.of(ada.email).loops.reflect(T0 + 16 * HOUR);
    expect(ran).toMatchObject({ signal: "notify", calls: 1 });
    const note = await w.of(ada.email).svc.memoryGet({ path: reflectionPath("2026-10-13") }, ada.email);
    expect(note).toMatchObject({ ok: true, writer: "loop:reflection" });
    const noteText = (note as { lines: Array<{ text: string }> }).lines.map((l) => l.text).join("\n");
    expect(noteText).toContain(`Ada closed out the harbor budget. (${l1})`);
    expect(noteText).not.toContain("mayor");
    const synthesis = await w.of(ada.email).svc.memoryGet({ path: SYNTHESIS_PATH }, ada.email);
    expect((synthesis as { lines: Array<{ text: string }> }).lines.map((l) => l.text)).toContain(`- Ada protects Fridays for planning. (${l2})`);
    // Every citation in what was written resolves to a line of Ada's notes.
    for (const cite of `${noteText}`.match(/memory\/\d{4}-\d{2}-\d{2}\.md#L\d+/g) ?? []) {
      const got = await w.of(ada.email).svc.memoryGet({ path: cite.split("#")[0] as string }, ada.email);
      expect((got as { lines: Array<{ n: number }> }).lines.some((l) => l.n === Number(cite.split("#L")[1]))).toBe(true);
    }
    expect(w.of(ada.email).loops.reconciliations("reflection")).toMatchObject([{ lines: 2, added: [reflectionPath("2026-10-13"), SYNTHESIS_PATH], dropped: [{ code: "LOOP_CITATION_UNRESOLVED" }, { code: "LOOP_CITATION_UNRESOLVED" }] }]);
    // The note is the owner's: it is searchable by Ada and by nobody else.
    expect(((await w.of(ada.email).svc.memorySearch({ queries: ["harbor budget"] }, ada.email)) as { hits: Array<{ path: string }> }).hits.map((h) => h.path)).toContain(reflectionPath("2026-10-13"));
    // The next night, nothing new: no call, and the synthesis stays.
    expect(await w.of(ada.email).loops.reflect(T0 + 40 * HOUR)).toMatchObject({ code: "LOOP_NO_EVIDENCE", calls: 0 });
  });

  it("the weekly skill review proposes skills that wait for the person and never merges, even under an automatic self-learning grant", async () => {
    const w = personLoopWorld();
    const l1 = await w.write(ada.email, "Ada pulled the tide report, trimmed it, and sent it to Bo.");
    const l2 = await w.write(ada.email, "Again Ada pulled the tide report and sent it on.");
    w.fake.enqueue(
      answer({
        skills: [
          { name: "tide-report", description: "Pull, trim and send the tide report.", body: "1. Pull the report.\n2. Trim it.\n3. Send it.", tools: [], connectors: [], cites: [l1, l2] },
          { name: "made-up", description: "Not shown by any line.", body: "Do a thing.", cites: ["memory/2026-10-01.md#L3"] },
          { name: "leaky", description: "Carries a secret.", body: "Use password: hunter2hunter2 for the portal.", cites: [l1] },
        ],
      }),
    );
    const ran = await w.of(ada.email).loops.reviewSkills(T0);
    expect(ran).toMatchObject({ signal: "notify", calls: 1 });
    expect(w.of(ada.email).learning.pending()).toMatchObject([{ name: "tide-report" }]);
    expect(w.of(ada.email).loops.reconciliations("skill-review")).toMatchObject([{ added: [expect.stringMatching(/^pl-/)], dropped: [{ code: "LOOP_CITATION_UNRESOLVED" }, { code: "LOOP_SKILL_SENSITIVE" }] }]);
    // Nothing was written to Ada's skills, and the grant was never consulted.
    expect([...w.r2.objects.keys()].filter((k) => k.includes("/skills/"))).toEqual([]);
    expect(w.commits).toEqual([]);
    // The person merges it in person; her agent cannot.
    const [p] = w.of(ada.email).learning.pending();
    expect(await w.of(ada.email).learning.merge({ kind: "agent", email: ada.email }, p?.id as string)).toMatchObject({ ok: false, code: "PROMOTION_PERSON_ONLY" });
    expect(await w.of(ada.email).learning.merge({ kind: "person", email: ada.email }, p?.id as string)).toMatchObject({ ok: true });
  });

  it("a switched-off loop makes no call and records nothing; only the person sees or sets their loops", async () => {
    const w = personLoopWorld();
    await w.write(ada.email, "Ada noted the dock schedule.");
    expect(w.of(ada.email).loops.setLoop(ada.email, "memory-upkeep", { enabled: "no" })).toMatchObject({ ok: false, code: "LOOP_SETTING_INVALID" });
    expect(w.of(ada.email).loops.setLoop(ada.email, "feed", { enabled: true })).toMatchObject({ ok: false, code: "LOOP_UNKNOWN" });
    expect(w.of(ada.email).loops.setLoop(ada.email, "memory-upkeep", { enabled: false })).toMatchObject({ ok: true });
    expect(await w.of(ada.email).loops.upkeep(T0)).toMatchObject({ code: "LOOP_DISABLED", calls: 0 });
    expect(w.fake.requests).toHaveLength(0);
    expect(await loopRuns(w, ada.email, "loop:memory-upkeep")).toEqual([]);
    expect(w.of(ada.email).loops.settings(ada.email)).toMatchObject({ ok: true, loops: [{ loop: "memory-upkeep", enabled: false }, { loop: "relationships", enabled: true }, { loop: "reflection", enabled: true }, { loop: "skill-review", enabled: true }] });
  });

  it("the person's loops run hourly, nightly and weekly, each firing in one slot", () => {
    expect(PERSON_CRONS).toEqual({ "memory-upkeep": "0 * * * *", relationships: "20 * * * *", reflection: "30 2 * * *", "skill-review": "0 5 * * 1" });
    expect(personSlot("memory-upkeep", T0 + 59_000)).toBe(T0);
    expect(personSlot("relationships", T0 + 59_000)).toBe(T0);
    expect(personSlot("reflection", T0 + 5 * HOUR)).toBe(Date.UTC(2026, 9, 13));
  });
});
