// A task's Stop while its delegation is out (F31, B-P5-08): the turn that launched the child has ended, the task reads
// running and its drawer offers Stop; pressing it closes the child with SUBAGENT_CLOSED, wakes no turn, and the task
// reads Stopped. Pat, the second member, is refused by code, and a task no longer running is refused by code.
import { describe, expect, it } from "vitest";
import { pat, played, sam } from "./harness.ts";
import { runs } from "./runs.ts";
import section from "./subagent-section.task.ts";

describe("[F31] P5 activity: a task's Stop while its delegation is out", () => {
  it("the drawer offers Stop on the running task; pressing it closes the child, wakes no turn, and the task reads Stopped", async () => {
    const w = await played(section, runs["T-P5-08"]!(), section.turns.slice(0, 1));
    const task = (await w.activity()).tasks.find((t) => t.chat === "c1");
    expect(task?.status).toBe("running");
    const id = task?.id as string;
    const path = `/app/activity/${w.chatId("c1")}/${id}/stop`;
    expect((await w.drawer("c1", id))?.stop).toBe(true);
    expect((await w.w.http(pat.email, "POST", path)).body).toMatchObject({ ok: false, code: "CHAT_NOT_OWNER" });
    expect((await w.w.http(sam.email, "POST", path)).body).toEqual({ ok: true, turn: id });
    await w.play({ kind: "event", name: "children" });
    const after = (await w.activity()).tasks.filter((t) => t.chat === "c1");
    expect([after.length, after[0]?.status]).toEqual([1, "stopped"]);
    expect(w.subagents("c1").map((s) => [s.status, s.code])).toEqual([["failed", "SUBAGENT_CLOSED"]]);
    expect(w.replies("c1")).toHaveLength(1);
    expect((await w.drawer("c1", id))?.stop).toBe(false);
    expect((await w.w.http(sam.email, "POST", path)).body).toMatchObject({ ok: false, code: "TASK_NOT_RUNNING" });
  });
});
