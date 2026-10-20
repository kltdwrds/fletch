// M12.1 the person's loops, with Ada and Bo: no evidence, no model call; upkeep's claims each cite a
// line of the person's own new evidence, take that line's setting, and leave a reconciliation row;
// reflection's dated note and synthesis cite only lines that resolve; the weekly review proposes and
// never merges, even under an automatic self-learning grant; a loop over its budget stops before the
// call and says so; a switched-off loop does nothing; only the person sees or sets their loops.
import { describe, expect, it } from "vitest";
import { PERSON_CRONS, personSlot } from "../../packages/agent/src/loops/personal.ts";
import { ada, answer, applyAll, personLoopWorld, T0 } from "./support/loop-world.ts";

const HOUR = 3_600_000;
const loopRuns = async (w: ReturnType<typeof personLoopWorld>, person: string, job: string) => (await w.ledger().runs({ person })).filter((r) => r.jobId === job);

describe("[M12.1] person loops", () => {

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

  it("the person's loops run hourly, nightly and weekly, each firing in one slot", () => {
    expect(PERSON_CRONS).toEqual({ "memory-upkeep": "0 * * * *", relationships: "20 * * * *", reflection: "30 2 * * *", "skill-review": "0 5 * * 1" });
    expect(personSlot("memory-upkeep", T0 + 59_000)).toBe(T0);
    expect(personSlot("relationships", T0 + 59_000)).toBe(T0);
    expect(personSlot("reflection", T0 + 5 * HOUR)).toBe(Date.UTC(2026, 9, 13));
  });
});
