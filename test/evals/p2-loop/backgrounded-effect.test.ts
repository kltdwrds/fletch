// T-P2-06 under vitest (F24): Sam asks for an export; the test-host `export_start` sets it up as a real `Job` (a
// run-once job five minutes out whose one step, a fixture, fails) and answers at once that it runs. The completion is
// the job's alarm on the world's clock: the run fails, the job's outbox delivers its notice into the chat, and the chat
// wakes the agent with a harness handoff (`chat/job-wake.ts`); the woken turn is scripted to end with no words. The
// second delivery is the outbox's own call again with the same notice, as after an answer it never got.
import { describe, expect, it } from "vitest";
import type { FakeStep } from "../../support/fake-model.ts";
import { EXPORT_FAILURE, exportNamespace, exportSteps } from "../../support/p2-fixtures.ts";
import type { Snapshot } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import { runTask, type TaskHarness, type Turn } from "../../support/task.ts";
import { authorityWorld } from "../../workers/support/authority-world.ts";
import task, { JOB, type P2JobWorld } from "./backgrounded-effect.task.ts";
import { P2Tier1World, sam } from "./harness.ts";

const CODE = EXPORT_FAILURE.code;

const SCRIPT: FakeStep[] = [
  { toolCall: { name: "export_start", arguments: {} } },
  { text: `The export is running in the background as job ${JOB}; I will see its result here when it ends.` },
  // The woken turn: nothing to add to what Sam was shown.
  { text: "" },
];

class JobWorld extends P2Tier1World implements P2JobWorld {
  chatId = "";
  /** The completions played so far. */
  completions = 0;
  jobs() {
    const runs = this.w.jobOf(sam.email, JOB).instance.store.runs();
    const job = this.w.jobOf(sam.email, JOB).instance.status();
    return job ? [{ id: job.id, status: job.status, completions: runs.filter((r) => r.phase === "done").length }] : [];
  }
  notices() {
    return this.chat("c1").notices().map((n) => ({ id: n.id, text: n.text }));
  }
  /** The chat's notice delivered again, as the job's outbox calls it (`jobs/engine.ts` `deliver`). */
  async redeliver() {
    const n = this.chat("c1").notices()[0];
    if (!n) throw new Error("P2_NO_NOTICE");
    const r = this.chat("c1").notify({ id: n.id, source: n.source, text: n.text, person: sam.email });
    await this.chat("c1").settled();
    return r;
  }
  override snapshot(): Snapshot {
    const s = super.snapshot();
    for (const j of this.jobs()) s.journal.push(`job:${j.id}`);
    for (const [i] of this.notices().entries()) s.journal.push(`notice:c1:${i + 1}`);
    return s;
  }
}

async function open(script: FakeStep[] = SCRIPT): Promise<JobWorld> {
  let world: JobWorld | null = null;
  const start = async () => {
    const w = world as JobWorld;
    const def = { id: JOB, title: "Notes export", chat: w.chatId, owner: { kind: "chat" as const, id: w.chatId }, stop: { kind: "after_runs" as const, runs: 1 }, timing: { schedule: { kind: "runonce" as const, at: "2026-10-13T10:05" }, zone: "UTC" }, gate: null, steps: [{ kind: "fixture:export" }] as never, ceilingTokens: 20_000, instructions: "Export the notes as one archive." };
    const r = await w.w.jobOf(sam.email, JOB).instance.define({ owner: sam.email, by: sam.email, def });
    if (!r.ok) throw new Error(`P2_JOB_NOT_DEFINED: ${r.code}`);
    return JOB;
  };
  world = new JobWorld(authorityWorld({ script, stores: true, jobs: true, jobSteps: exportSteps, namespaces: () => [exportNamespace(start)] }));
  await world.open("c1");
  world.chatId = (await world.w.http(sam.email, "GET", "/app/chats")).body.main as string;
  await world.w.host(sam.email).memory.standingFiles();
  return world;
}

const harness: TaskHarness<JobWorld> = {
  setup: () => open(),
  play: async (world, turn: Turn) => {
    if (turn.kind === "prompt") {
      world.starts.push(world.w.fake.requests.length);
      await world.chat("c1").send({ person: sam.email, text: turn.text });
      await world.chat("c1").settled();
      return;
    }
    if (turn.kind !== "event" || turn.name !== "job_complete") throw new Error(`P2_TURN_UNSUPPORTED: ${turn.kind}`);
    // The first completion is the job's alarm; the second the same notice delivered again.
    if (world.completions++ === 0) {
      await world.w.fireJob(sam.email, JOB);
      await world.chat("c1").settled();
    } else await world.redeliver();
  },
};

describe("[F24] P2 loop: a job's completion wakes the agent, which may say nothing", () => {
  runTask(task as never, harness as never);
});

describe("[F24] T-P2-06's wake, planted", () => {
  const rng = new Seeded(task.setup.seed);
  it("the woken turn's input names the job, its failed run with the code, and Sam's notice fenced", async () => {
    const world = await open();
    await harness.play(world, task.turns[0] as Turn, rng);
    await harness.play(world, task.turns[1] as Turn, rng);
    const woken = world.requests().at(-1)?.messages.filter((m) => m.role === "user").at(-1)?.text ?? "";
    expect(woken).toContain(`From the harness, not the person: a result of your job ${JOB} (job:${JOB})`);
    expect(woken).toMatch(new RegExp(`Its last run \\(${JOB}:\\d+\\) failed, ${CODE}: ${EXPORT_FAILURE.reason}\\.`));
    expect(woken).toContain(`source="job:${JOB}"`);
    expect(world.notices()).toHaveLength(1);
    expect(world.turns().map((t) => [t.startedBy, t.status])).toEqual([["user", "done"], ["internal_handoff", "done"]]);
  });

  it("a woken turn that has something to say is drawn like any reply", async () => {
    const world = await open([...SCRIPT.slice(0, 2), { text: "The export failed: the archive would be over 50 MB. Want it split by folder?" }]);
    await harness.play(world, task.turns[0] as Turn, rng);
    await harness.play(world, task.turns[1] as Turn, rng);
    expect(world.entries().filter((e) => e.kind === "agent").map((e) => e.text)).toEqual([expect.stringContaining("running"), expect.stringContaining("split by folder")]);
  });

  it("mail that arrives wakes no one: only a job's notice is handed to the agent", async () => {
    const world = await open();
    world.chat("c1").notify({ id: "mail-1", source: "mail:received", text: "A letter came.", person: sam.email });
    await world.chat("c1").settled();
    expect(world.turns()).toEqual([]);
    expect(world.mailbox()).toEqual([]);
  });

  it("the same notice delivered twice is one handoff row and one woken turn", async () => {
    const world = await open();
    for (const t of task.turns) await harness.play(world, t, rng);
    expect((await world.redeliver())).toEqual({ ok: true, duplicate: true });
    expect(world.mailbox().map((m) => m.kind)).toEqual(["user", "internal_handoff"]);
    expect(world.turns()).toHaveLength(2);
  });
});
