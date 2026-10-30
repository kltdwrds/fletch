// F30: what a reply says about a job is three instruction lines in the chat's task block (`JOB_WORDS`): a one-shot set
// in one turn, its time named and nothing asked (B-P7-01, T-P7-09 on a slot); a job that would act refused in words with
// the offer to do it now in the chat (B-P7-09, delta 4); a stop, a pause and a remove each confirmed in one line
// (B-P7-05, B-P7-06, B-P7-10). Here each line reaches every chat request of the tier-1 runs whose replies follow it, and
// those runs' graders hold; a reply that breaks a line is caught by its task's grader.
import { describe, expect, it } from "vitest";
import { CHAT_TASK, JOB_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import type { DefinedTask } from "../../support/task.ts";
import { played } from "./harness.ts";
import cannot from "./job-cannot-act.task.ts";
import oneShot, { PROMPT } from "./one-shot-set.task.ts";
import remove from "./remove-ends-runs.task.ts";
import { runs } from "./runs.ts";
import update from "./update-in-place.task.ts";
import type { P7World } from "./world.ts";

const lines = JOB_WORDS.split("\n");
const verdicts = async (task: DefinedTask<P7World>, w: P7World) => Object.fromEntries(await Promise.all(task.graders.map(async (g) => [g.name, g.kind === "minefield" ? !(await g.check(w)) : await g.check(w)])));
const held = (task: DefinedTask<P7World>) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F30] what a reply says about a job: the instruction lines", () => {
  it("the task block carries three lines, each saying what its clause asks and none quoting an eval's prompt", () => {
    expect(CHAT_TASK).toContain(JOB_WORDS);
    expect(lines).toHaveLength(3);
    const [once, act, confirm] = lines as [string, string, string];
    expect(once).toMatch(/one runonce job made in this turn with no question first/);
    expect(once).toMatch(/HH:MM/);
    expect(once).toMatch(/say it is set and when, and stop: no question, no offer/);
    expect(act).toMatch(/A job reads and reports; it cannot send/);
    expect(act).toMatch(/make no job: say in words/);
    expect(act).toMatch(/offer to do it now, here in the chat/);
    expect(confirm).toMatch(/stop, pause or remove a job, confirm it in one line/);
    expect(confirm).toMatch(/does not run until turned on/);
    expect(confirm).toMatch(/its past runs are kept/);
    for (const prompt of [PROMPT, cannot.turns[0], update.turns[0], remove.turns[0]].map((t) => (typeof t === "string" ? t : t && "text" in t ? t.text : ""))) {
      if (prompt) expect(JOB_WORDS).not.toContain(prompt);
    }
  });

  for (const task of [oneShot, cannot, update, remove]) {
    it(`${task.id}: every chat request carries each line, and the run whose replies follow them holds every grader`, async () => {
      const w = await played(task, runs[task.id]!());
      const chat = w.w.fake.requests.filter((r) => !JSON.stringify(r.inputs).includes("You are running one step of a scheduled job"));
      expect(chat.length).toBeGreaterThan(0);
      for (const r of chat) for (const line of lines) expect(JSON.stringify(r.inputs)).toContain(JSON.stringify(line).slice(1, -1));
      expect(await verdicts(task, w)).toEqual(held(task));
    });
  }

  it("planted: a reply that asks first, one that names a code, and a remove said without its kept runs are each caught", async () => {
    const asked = await played(oneShot, { script: [{ text: "Shall I schedule that for you?" }] });
    expect((await verdicts(oneShot, asked)).asked_permission).toBe(false);
    const coded = await played(cannot, { script: [{ text: "JOB_WRITE_REFUSED: a job cannot send. I can send it now, here." }] });
    expect((await verdicts(cannot, coded))["the reply names what a job cannot do, in words, not a code"]).toBe(false);
    const o = runs["T-P7-13"]!();
    const bare = await played(remove, { ...o, script: o.script.map((s, i) => (i === o.script.length - 1 ? { text: "Removed." } : s)) });
    expect((await verdicts(remove, bare))["the reply says it is removed and that past runs are kept"]).toBe(false);
  });
});
