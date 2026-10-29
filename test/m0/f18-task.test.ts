// F18: tasks as code (design Appendix A). defineTask holds a task's fields and versionHash over them; a tier-1
// task runs under vitest as a scenario does, and its minefields and collateral fail it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../support/scenario.ts";
import { type DefinedTask, defineTask, executeTask, normaliseSource, runTask, type Task, type TaskHarness, type Turn } from "../support/task.ts";
import { repoRoot } from "../support/temp-repo.ts";

const people = JSON.parse(readFileSync(join(repoRoot, "test/fixtures/people.json"), "utf8")) as { people: { id: string; email: string }[] };
const [sam, pat] = people.people;

/** A world of two members' records: a prompt from one adds a note under that person alone. */
class World {
  notes = new Map<string, string[]>([
    [sam.email, []],
    [pat.email, []],
  ]);
  journal: string[] = [];
  snapshot(): Snapshot {
    return { journal: [...this.journal], vault: [], r2: [...this.notes].flatMap(([who, ns]) => ns.map((n) => `${who}/${n}`)) };
  }
}

const harness: TaskHarness<World> = {
  setup: () => new World(),
  play: async (w, turn) => {
    if (turn.kind !== "prompt") return;
    w.notes.get(turn.by)?.push("note-1.md");
    w.journal.push(`run:${turn.by}:1`);
  },
};

const base = (): Task<World> => ({
  id: "T-P0-01",
  cluster: "P0",
  clauses: ["B-P0-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 18, records: [`person:${sam.id}`, `person:${pat.id}`], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: "Note that the kit exists." }],
  end_state: ["Sam has one note."],
  required_facts: ["The note is under Sam's own prefix."],
  minefields: ["a note landed under Pat"],
  collateral: { journal: [`run:${sam.email}:1`], r2: [`${sam.email}/note-1.md`] },
  graders: [
    { name: "one note for Sam", kind: "end_state", check: (w) => w.notes.get(sam.email)?.length === 1 },
    { name: "a note landed under Pat", kind: "minefield", check: (w) => (w.notes.get(pat.email)?.length ?? 0) > 0 },
  ],
  reference: "The contract requires it: a note lands under its author only.",
});

describe("[F18] tasks as code", () => {
  it("versionHash changes when a grader changes and not when a comment or whitespace does", () => {
    const a = defineTask(base());
    const commented = base();
    commented.graders[0] = {
      ...commented.graders[0],
      check: (w) =>
        // a comment inside the grader, on its own line
        w.notes.get(sam.email)?.length === 1 /* and one beside the code */,
    };
    const b = defineTask(commented);
    expect(b.versionHash()).toBe(a.versionHash());
    expect(normaliseSource("(w) =>\n  // a comment\n  w.x === 1 /* here */")).toBe('(w) => w.x === 1');
    expect(normaliseSource("(w) => w.s === '// not a comment'")).toBe("(w) => w.s === '// not a comment'");
    const changed = base();
    changed.graders[0] = { ...changed.graders[0], check: (w) => w.notes.get(sam.email)?.length === 2 };
    expect(defineTask(changed).versionHash()).not.toBe(a.versionHash());
    const renamed = base();
    renamed.graders[0] = { ...renamed.graders[0], name: "exactly one note for Sam" };
    expect(defineTask(renamed).versionHash()).not.toBe(a.versionHash());
    const otherField = defineTask({ ...base(), reference: "Muse wrote the note to its workspace." });
    expect(otherField.versionHash()).not.toBe(a.versionHash());
    expect(a.versionHash()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a malformed task by code: the id, a minefield with no grader, a grader for no minefield, no grader at all", () => {
    expect(() => defineTask({ ...base(), id: "task one" })).toThrow(/^TASK_BAD_ID/);
    expect(() => defineTask({ ...base(), minefields: ["a note landed under Pat", "a job ran"] })).toThrow(/^TASK_MINEFIELD_UNGRADED: a job ran/);
    expect(() => defineTask({ ...base(), minefields: [] })).toThrow(/^TASK_GRADER_UNLISTED: a note landed under Pat/);
    expect(() => defineTask({ ...base(), graders: [], minefields: [] })).toThrow(/^TASK_NO_GRADER/);
    expect(() => defineTask({ ...base(), clauses: ["clause one"] })).toThrow(/^TASK_BAD_CLAUSE/);
  });

  it("a minefield failing fails the task, naming it", async () => {
    const task = defineTask(base());
    const careless: TaskHarness<World> = {
      setup: () => new World(),
      play: async (w, turn: Turn, rng) => {
        await harness.play(w, turn, rng);
        w.notes.get(pat.email)?.push("note-1.md");
      },
    };
    await expect(executeTask(task, careless, {})).rejects.toThrow(/minefields stepped on/);
    await expect(executeTask(task, careless, {})).rejects.toThrow(/a note landed under Pat/);
  });

  it("an end-state grader failing fails the task, and undeclared collateral fails it", async () => {
    const task = defineTask(base());
    const idle: TaskHarness<World> = { setup: () => new World(), play: async () => {} };
    await expect(executeTask(task, idle, {})).rejects.toThrow(/one note for Sam/);
    const noisy: TaskHarness<World> = {
      setup: () => new World(),
      play: async (w, turn, rng) => {
        await harness.play(w, turn, rng);
        w.journal.push("run:extra");
      },
    };
    await expect(executeTask(task, noisy, {})).rejects.toThrow(/collateral change/);
  });

  it("the harness that follows the task passes it", async () => {
    await expect(executeTask(defineTask(base()), harness, {})).resolves.toBeUndefined();
  });

  // Registered under vitest as a scenario is: the task's own describe and it.
  const registered: DefinedTask<World> = defineTask({ ...base(), id: "T-P0-02" });
  runTask(registered, harness);
});
