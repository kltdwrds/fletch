// T-P9-05 under vitest: the scripted run in `runs.ts` through the tier-1 harness.
// F59: code's sentence is the first turn's first bubble, so the old reading (the chat's first and second bubble)
// refuses the run; the reading by turn holds it, and a turn without the model's code-named words still fails.
import { describe, expect, it } from "vitest";
import { runTask } from "../../support/task.ts";
import { played } from "./harness.ts";
import { p9Harness } from "./harness.ts";
import { runs } from "./runs.ts";
import task from "./unbound-host-refused-and-audited.task.ts";
import type { P9World } from "./world.ts";

describe("[F35] P9 connectors: T-P9-05", () => {
  runTask(task, p9Harness(runs["T-P9-05"]!()));
});

describe("[F59] T-P9-05 read by turn: code's sentence opens the first", () => {
  const FIRST = "the first reply says the host is not bound, by code name, and that only Sam can bind it";
  const SECOND = "the second turn stops at the card: its reply says the proposal waits on Sam and has not run";
  const grade = async (w: P9World, name: string) => task.graders.find((g) => g.name === name)!.check(w);
  /** The old reading, as shipped before F59: the chat's first and second agent bubble. */
  const oldFirst = (w: P9World) => (w.replies("c1")[0] ?? "").includes("EGRESS_CRED_HOST_DENIED");
  const oldSecond = (w: P9World) => w.replies("c1").length === 2;

  it("the scripted run, pinned: code's sentence, the model's reply, then the waiting line; the old reading refused it, the turn reading holds it", async () => {
    const w = await played(task, runs["T-P9-05"]!());
    const said = w.replies("c1");
    expect(said).toHaveLength(3);
    expect(said[0]).toBe("Your example-api key is not bound to api.example.org, so nothing was sent there; only you can bind it.");
    expect(oldFirst(w) || oldSecond(w)).toBe(false);
    expect(await grade(w, FIRST)).toBe(true);
    expect(await grade(w, SECOND)).toBe(true);
  });

  it("planted: a first turn whose model words drop the code name still fails, as does a second turn with two bubbles", async () => {
    const o = runs["T-P9-05"]!();
    const w = await played(task, { ...o, script: o.script.map((s, i) => (i === 2 ? { text: "I couldn't read it." } : s)) });
    expect(await grade(w, FIRST)).toBe(false);
    const two = Object.assign(Object.create(w) as P9World, { thread: (c?: Parameters<P9World["thread"]>[0]) => [...w.thread(c).slice(0, -1), { kind: "agent", text: "More." }, ...w.thread(c).slice(-1)] });
    expect(await grade(two, SECOND)).toBe(false);
  });
});
