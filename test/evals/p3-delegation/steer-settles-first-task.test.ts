// Q28: a steer that closes the running child settles the first task. T-P3-15's run under the scripted fake: Sam asks
// for the two-page read, and while the child is held mid-run types "skip the second page and finish"; the steer's turn
// closes the child (`subagents_close`, P3 delta 2) and delegates a new one. The closed delegation hands off, but its
// handoff never wakes a turn of the first task, so the first task's row must read Done from its closed children, never
// Running with a Stop that halts nothing; the steer's task reads Done once its new child has handed off.
import { describe, expect, it } from "vitest";
import { played, sam } from "./harness.ts";
import { runs } from "./runs.ts";
import steer from "./steer-real-model.task.ts";

describe("[F34] P3 delegation: a steer that closes the running child settles the first task (Q28)", () => {
  it("the first task reads Done with an end, its drawer offers no Stop, and its Stop is refused as not running", async () => {
    const w = await played(steer, runs["T-P3-15"]!());
    const first = w.children("c1")[0];
    expect([first?.status, first?.code, first?.handedOffAt !== null]).toEqual(["failed", "SUBAGENT_CLOSED", true]);
    const tasks = (await w.activity()).tasks.filter((t) => t.chat === "c1");
    expect(tasks.map((t) => t.status)).toEqual(["done", "done"]);
    const [steered, older] = tasks as [(typeof tasks)[number], (typeof tasks)[number]];
    // The closed delegation's handoff woke a turn grouped with the steer's task, never one of the first task's own.
    const woke = w.mailbox("c1").find((m) => m.messageId === `handoff:${first?.grp}`)?.turnId as string;
    expect([steered.turnIds.includes(woke), older.turnIds.includes(woke)]).toEqual([true, false]);
    expect((older as typeof older & { endedAt: number | null }).endedAt).not.toBeNull();
    expect((await w.drawer("c1", older.id))?.stop).toBe(false);
    expect((await w.w.http(sam.email, "POST", `/app/activity/${w.chatId("c1")}/${older.id}/stop`)).body).toMatchObject({ ok: false, code: "TASK_NOT_RUNNING" });
  });
});
