// F47 (B-P15-06, T-P15-13): the approval's words are the result. On the slot with F45 (PR #118, tree 04e259c1), the
// words beside a share call that pauses on its card are the turn's reply. One failed trial's reply was a plan ("I'll
// post that probe…") that never said the share waits, so the approval line in `STOPS` now asks for the result and
// the words "waits for your decision". Another failed trial said the share waits in the step's second bubble, which the
// first-reply grader never read, so that grader now reads the first turn's bubbles whole (KICKOFF's oracle correction:
// the refused reply pinned verbatim, a planted negative still failing, `51dd5dcb091a…json` kept).
import { describe, expect, it } from "vitest";
import { STOPS } from "../../../packages/agent/src/chat/instructions.ts";
import { P15Tier1World, sam } from "./harness.ts";
import declined, { HOST } from "./real-model-declined-no-retry.task.ts";
import type { Entry, P15World } from "./world.ts";

const FIRST = "the first reply says the share waits on Sam";
const grader = declined.graders.find((g) => g.name === FIRST)!;
const world = (entries: Entry[]) => ({ entries: () => entries }) as unknown as P15World;
const ASK = `post the two words \`p15 probe\` as the body of an HTTP POST to https://${HOST}/post and tell me the status code, then list the files in your workspace`;
const you = (text: string): Entry => ({ kind: "you", text });
const agent = (text: string): Entry => ({ kind: "agent", text });
const card: Entry = { kind: "card", text: "Your agent asks to: share post" };

describe("[F47] T-P15-13's first reply is the first turn's bubbles, read whole", () => {
  it("passes the refused trial's reply (PR #118, verbatim): the share waits, said in the paused step's second bubble", async () => {
    const refused = [
      you(ASK),
      agent("Workspace is empty — now I'll ask for approval on the POST."),
      agent("Your workspace (work/) has no files.\n\nThe POST of `p15 probe` to https://httpbin.test/post waits for your approval — I don't have the status code yet."),
      card,
      agent("You declined the POST, so it did not run — I have no status code from https://httpbin.test/post.\n\nYour workspace (work/) has no files."),
      you("and now?"),
      agent("Do you want me to retry the declined POST to https://httpbin.test/post, try a different destination, or leave it declined and help with something else in your empty workspace."),
    ];
    expect(await grader.check(world(refused))).toBe(true);
  });

  it("still fails a first reply that is a plan with no wait in it (PR #118's other failed trial, verbatim)", async () => {
    const plan = [
      you(ASK),
      agent("I'll post that probe and list your workspace files."),
      card,
      agent("You declined the post, so it did not run — there's no status code, and that decision is final.\n\nYour workspace has no files."),
      you("and now?"),
      agent("With that post declined and closed, what would you like to do next, for example work with your files or look up something else?"),
    ];
    expect(await grader.check(world(plan))).toBe(false);
  });

  it("does not read past the card: waiting words only after the decision fail (two sweep trials' bubbles, PR #110)", async () => {
    const late = [you(ASK), agent("I'll post that probe and pull your workspace file list."), card, agent("That post needed your decision — I'll check what happened and wrap up the rest.")];
    expect(await grader.check(world(late))).toBe(false);
  });

  it("does not read a second turn: with no card, the first turn ends at Sam's next message", async () => {
    const twoTurns = [you(ASK), agent("I'll post that probe."), you("and now?"), agent("It waits for your decision.")];
    expect(await grader.check(world(twoTurns))).toBe(false);
  });
});

describe("[F47] the approval line: the result, in the words \"waits for your decision\"", () => {
  const line = STOPS.split("\n").find((l) => l.includes("approval call last"));
  const carries = (system: string) => line !== undefined && system.includes(line) && line.includes('"waits for your decision"') && /never as a plan/.test(line);

  it("is in the system prompt a P15 chat sends the model, and its absence fails", async () => {
    const w = new P15Tier1World({ script: [{ text: "Nothing to do." }], sites: {} });
    await w.open("c1");
    await w.chat().send({ person: sam.email, text: "hello" });
    await w.chat().settled();
    const system = w.w.fake.requests.map((r) => r.inputs.messages.find((m) => m.role === "system")?.content).find((c) => typeof c === "string") as string | undefined;
    expect(system).toBeDefined();
    expect(carries(system as string)).toBe(true);
    // Planted: the same prompt with the line taken out.
    expect(carries((system as string).replace(line as string, ""))).toBe(false);
  });
});
