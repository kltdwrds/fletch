// F19: the tier-2 runner against a fake slot. Three trials and the pass rule; an infrastructure failure is
// `infra`, never `fail`; a result for the same versionHash is the baseline (regressed, improved) and a changed
// grader is a new hash with no baseline; the Markdown table's shape; a task the slot cannot drive is refused
// before any trial. No network: the slot is scripted, the clock is the test's.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { driveable, readResults, resultsPath, runTask, runTasks, selectTasks, table, TRIALS, verdictOf } from "../../scripts/evals/runner.ts";
import { EMPTY_SNAPSHOT, InfraError, type SlotWorld, TurnError } from "../support/evals.ts";
import { type DefinedTask, defineTask, type Task } from "../support/task.ts";
import { repoRoot } from "../support/temp-repo.ts";

const people = JSON.parse(readFileSync(join(repoRoot, "test/fixtures/people.json"), "utf8")) as { people: { id: string; email: string }[] };
const [sam, pat] = people.people;

/** One scripted trial: the reply the agent gives, or how the slot or the turn fails. */
type Script = { reply: string } | { infra: InfraError } | { turn: TurnError };

/** A slot whose trials are scripted in order; `opened` counts the chats it made. */
function fakeSlot(scripts: Script[]) {
  let opened = 0;
  return {
    name: "fletch-pv-9",
    get opened() {
      return opened;
    },
    async open(): Promise<SlotWorld> {
      const script = scripts[opened];
      opened++;
      if (!script) throw new Error("the fake slot ran out of script");
      if ("infra" in script) throw script.infra;
      const replies: string[] = [];
      return {
        chatId: `chat-${opened}`,
        replies,
        snapshot: () => EMPTY_SNAPSHOT,
        async send() {
          if ("turn" in script) throw script.turn;
          replies.push(script.reply);
          return script.reply;
        },
        async read() {
          return { status: 200, body: { ok: true } };
        },
      };
    },
  };
}

const pong = (): Task<SlotWorld> => ({
  id: "T-P0-11",
  cluster: "P0",
  clauses: ["B-P0-11"],
  priority: "must-have",
  tier: 2,
  setup: { seed: 19, records: [`person:${sam.id}`], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: "Answer with just the word pong." }],
  end_state: ["One reply came back."],
  required_facts: ["The reply says pong."],
  minefields: ["the agent asked a question instead"],
  collateral: {},
  graders: [
    { name: "one reply came back", kind: "end_state", check: (w) => w.replies.length === 1 },
    { name: "the reply says pong", kind: "required_fact", check: (w) => /pong/i.test(w.replies.at(-1) ?? "") },
    { name: "the agent asked a question instead", kind: "minefield", check: (w) => (w.replies.at(-1) ?? "").includes("?") },
  ],
  reference: "The contract requires it: the agent answers the one word it was asked for.",
});

const dirs: string[] = [];
const resultsDir = () => {
  const d = mkdtempSync(join(tmpdir(), "fletch-evals-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A clock the test owns: one second per call. */
const clock = () => {
  let t = Date.UTC(2026, 9, 29, 12, 0, 0);
  return () => {
    t += 1000;
    return new Date(t);
  };
};

const deps = (slot: ReturnType<typeof fakeSlot>, dir: string) => ({ slot, resultsDir: dir, now: clock(), owner: sam.email, log: () => {} });

describe("[F19] the tier-2 runner", () => {
  it("runs three trials and passes a task only when all three pass", async () => {
    const task = defineTask(pong());
    const slot = fakeSlot([{ reply: "pong" }, { reply: "Pong." }, { reply: "pong" }]);
    const r = await runTask(task, deps(slot, resultsDir()));
    expect(TRIALS).toBe(3);
    expect(slot.opened).toBe(3);
    expect(r.trials.map((t) => t.outcome)).toEqual(["pass", "pass", "pass"]);
    expect(r.verdict).toBe("pass");
    expect(r.note).toBeUndefined();
    expect(r.trials.map((t) => t.trial)).toEqual([1, 2, 3]);
    for (const t of r.trials) expect(Date.parse(t.finished_at)).toBeGreaterThan(Date.parse(t.started_at));

    const mixed = await runTask(task, deps(fakeSlot([{ reply: "pong" }, { reply: "ping" }, { reply: "pong" }]), resultsDir()));
    expect(mixed.trials.map((t) => t.outcome)).toEqual(["pass", "fail", "pass"]);
    expect(mixed.trials[1]).toMatchObject({ code: "GRADER_FAILED", grader: "the reply says pong" });
    expect(mixed.verdict).toBe("fail");

    const mined = await runTask(task, deps(fakeSlot([{ reply: "pong?" }, { reply: "pong" }, { reply: "pong" }]), resultsDir()));
    expect(mined.trials[0]).toMatchObject({ outcome: "fail", code: "MINEFIELD", grader: "the agent asked a question instead" });
    expect(mined.verdict).toBe("fail");

    const failedTurn = await runTask(task, deps(fakeSlot([{ turn: new TurnError("TURN_FAILED:MODEL_UNAVAILABLE") }, { reply: "pong" }, { reply: "pong" }]), resultsDir()));
    expect(failedTurn.trials[0]).toMatchObject({ outcome: "fail", code: "TURN_FAILED:MODEL_UNAVAILABLE" });
    expect(failedTurn.verdict).toBe("fail");
  });

  it("never counts an infrastructure failure as fail: the trial is infra, the task stops there, and the verdict is infra", async () => {
    const task = defineTask(pong());
    const noSlot = fakeSlot([{ infra: new InfraError("SLOT_MISSING", "this worktree holds no slot") }, { reply: "pong" }, { reply: "pong" }]);
    const r = await runTask(task, deps(noSlot, resultsDir()));
    expect(r.trials).toHaveLength(1);
    expect(r.trials[0]).toMatchObject({ trial: 1, outcome: "infra", code: "SLOT_MISSING" });
    expect(r.verdict).toBe("infra");
    expect(noSlot.opened).toBe(1);

    // A 5xx before the first model call on the third trial: two passes do not make a pass, and nothing is a fail.
    const late = await runTask(task, deps(fakeSlot([{ reply: "pong" }, { reply: "pong" }, { infra: new InfraError("SLOT_5XX", "POST /chats answered 503") }]), resultsDir()));
    expect(late.trials.map((t) => t.outcome)).toEqual(["pass", "pass", "infra"]);
    expect(late.verdict).toBe("infra");

    // Where the agent did fail, infra elsewhere does not hide it.
    expect(verdictOf([{ outcome: "fail" }, { outcome: "infra" }])).toBe("fail");
    expect(verdictOf([{ outcome: "pass" }, { outcome: "pass" }])).toBe("infra");
    expect(verdictOf([{ outcome: "pass" }, { outcome: "pass" }, { outcome: "pass" }])).toBe("pass");
  });

  it("writes results by versionHash, reads the same hash's last pass or fail as the baseline, and a changed grader starts a new one", async () => {
    const dir = resultsDir();
    const task = defineTask(pong());
    const first = await runTask(task, deps(fakeSlot([{ reply: "pong" }, { reply: "pong" }, { reply: "pong" }]), dir));
    const file = resultsPath(dir, task.versionHash());
    expect(file).toBe(join(dir, `${task.versionHash()}.json`));
    expect(existsSync(file)).toBe(true);
    expect(first.note).toBeUndefined();
    const written = readResults(file);
    expect(written).toMatchObject({ task: "T-P0-11", cluster: "P0", versionHash: task.versionHash() });
    expect(written?.runs).toHaveLength(1);
    expect(written?.runs[0]).toMatchObject({ slot: "fletch-pv-9", verdict: "pass" });
    // Content-free: the file carries codes, names and times, never what the agent or the person said.
    expect(readFileSync(file, "utf8")).not.toMatch(/pong|Answer with/);

    // The same hash again, now failing: regressed, appended to the same file.
    const second = await runTask(task, deps(fakeSlot([{ reply: "pong" }, { reply: "nope" }, { reply: "pong" }]), dir));
    expect(second.verdict).toBe("fail");
    expect(second.note).toBe("regressed");
    expect(readResults(file)?.runs).toHaveLength(2);

    // An infra run neither moves the baseline nor earns a note; the next pass is improved against the fail.
    const third = await runTask(task, deps(fakeSlot([{ infra: new InfraError("LEASE_LAPSED", "the lease is another branch's") }]), dir));
    expect(third.note).toBeUndefined();
    const fourth = await runTask(task, deps(fakeSlot([{ reply: "pong" }, { reply: "pong" }, { reply: "pong" }]), dir));
    expect(fourth.note).toBe("improved");
    expect(readResults(file)?.runs.map((r) => r.verdict)).toEqual(["pass", "fail", "infra", "pass"]);

    // The same outcome twice is neither.
    const fifth = await runTask(task, deps(fakeSlot([{ reply: "pong" }, { reply: "pong" }, { reply: "pong" }]), dir));
    expect(fifth.note).toBeUndefined();

    // A changed grader is a new hash: its own file, no baseline, no note, whatever the old file says.
    const changed = pong();
    changed.graders[1] = { ...changed.graders[1], check: (w) => /^pong\.?$/i.test((w.replies.at(-1) ?? "").trim()) };
    const other = defineTask(changed);
    expect(other.versionHash()).not.toBe(task.versionHash());
    const theirs = await runTask(other, deps(fakeSlot([{ reply: "pong" }, { reply: "nope" }, { reply: "pong" }]), dir));
    expect(theirs.verdict).toBe("fail");
    expect(theirs.note).toBeUndefined();
    expect(readdirSync(dir).toSorted()).toEqual([`${other.versionHash()}.json`, `${task.versionHash()}.json`].toSorted());
    expect(readResults(resultsPath(dir, other.versionHash()))?.runs).toHaveLength(1);
  });

  it("summarises a run as one Markdown table: task, version, each trial, verdict, note", async () => {
    const dir = resultsDir();
    const task = defineTask(pong());
    const r1 = await runTask(task, deps(fakeSlot([{ reply: "pong" }, { reply: "pong" }, { reply: "pong" }]), dir));
    const r2 = await runTask(task, deps(fakeSlot([{ reply: "pong" }, { reply: "nope" }, { infra: new InfraError("SLOT_5XX", "503") }]), dir));
    const md = table([r1, r2]);
    const lines = md.trimEnd().split("\n");
    expect(lines[0]).toBe("| Task | Version | Trial 1 | Trial 2 | Trial 3 | Verdict | Note |");
    expect(lines[1]).toBe("|---|---|---|---|---|---|---|");
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe(`| T-P0-11 | \`${task.versionHash().slice(0, 12)}\` | pass | pass | pass | **pass** |  |`);
    expect(lines[3]).toBe(`| T-P0-11 | \`${task.versionHash().slice(0, 12)}\` | pass | fail (GRADER_FAILED) | infra (SLOT_5XX) | **fail** | regressed |`);
    // A task that stopped on its first infra trial shows what did not run.
    const r3 = await runTask(task, deps(fakeSlot([{ infra: new InfraError("SLOT_MISSING", "no slot") }]), dir));
    expect(table([r3]).trimEnd().split("\n")[2]).toBe(`| T-P0-11 | \`${task.versionHash().slice(0, 12)}\` | infra (SLOT_MISSING) | not run | not run | **infra** |  |`);
  });

  it("refuses, before any trial, a task the slot cannot drive: a prompt by anyone but the slot's owner, or a turn that is not a prompt", async () => {
    const byPat = defineTask({ ...pong(), turns: [{ kind: "prompt", by: pat.email, text: "Answer with just the word pong." }] });
    expect(driveable(byPat, sam.email)).toBe(`EVALS_TASK_UNDRIVABLE: turn 1 of T-P0-11 is by ${pat.email}, not the slot's owner ${sam.email}`);
    const slot = fakeSlot([{ reply: "pong" }, { reply: "pong" }, { reply: "pong" }]);
    await expect(runTask(byPat, deps(slot, resultsDir()))).rejects.toThrow(/^EVALS_TASK_UNDRIVABLE: turn 1 of T-P0-11 is by pat@/);
    expect(slot.opened).toBe(0);
    const event = defineTask({ ...pong(), turns: [{ kind: "prompt", by: sam.email, text: "hello" }, { kind: "event", name: "mail" }] });
    expect(driveable(event, sam.email)).toBe("EVALS_TASK_UNDRIVABLE: turn 2 of T-P0-11 is an event; the runner drives prompts only");
    expect(driveable(defineTask(pong()), sam.email)).toBeNull();
  });

  it("selects tasks by cluster or id, tier 2 only, and names a selector that matches nothing", () => {
    const a = defineTask(pong());
    const b = defineTask({ ...pong(), id: "T-P0-12", clauses: ["B-P0-12"] });
    const tier1 = defineTask({ ...pong(), id: "T-P0-13", tier: 1 }) as unknown as DefinedTask<SlotWorld>;
    const p1 = defineTask({ ...pong(), id: "T-P1-01", cluster: "P1", clauses: ["B-P1-01"] });
    const all = [a, b, tier1, p1];
    expect(selectTasks(all, "P0")).toEqual({ selected: [a, b], skippedTier1: ["T-P0-13"] });
    expect(selectTasks(all, "T-P0-12")).toEqual({ selected: [b], skippedTier1: [] });
    expect(selectTasks(all, "P1")).toEqual({ selected: [p1], skippedTier1: [] });
    expect(selectTasks(all, "T-P0-13")).toEqual({ selected: [], skippedTier1: ["T-P0-13"] });
    expect(selectTasks(all, "P7")).toEqual({ selected: [], skippedTier1: [] });
  });

  it("runs a selection in order, one results file each, and tells each task apart in the table", async () => {
    const dir = resultsDir();
    const a = defineTask(pong());
    const b = defineTask({ ...pong(), id: "T-P0-12", clauses: ["B-P0-12"] });
    const slot = fakeSlot([{ reply: "pong" }, { reply: "pong" }, { reply: "pong" }, { reply: "pong" }, { reply: "nope" }, { reply: "pong" }]);
    const results = await runTasks([a, b], deps(slot, dir));
    expect(results.map((r) => [r.task, r.verdict])).toEqual([
      ["T-P0-11", "pass"],
      ["T-P0-12", "fail"],
    ]);
    expect(readdirSync(dir)).toHaveLength(2);
    expect(table(results)).toContain("| T-P0-12 |");
  });
});
