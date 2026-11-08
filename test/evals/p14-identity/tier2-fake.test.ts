// The tier-2 P14 tasks (T-P14-10 to 14) are graded on a slot with the real model by `pnpm evals P14` (F41); here T-P14-10,
// 11, 12 and 14 load and play under the scripted fake through the tier-1 harness, and their graders answer as shipped
// fletch does. T-P14-13 reads the slot's pages (`P14SlotWorld`), played over `harness-slot.ts`. (T-P14-04, the
// Security pane, is tier 1 from F41: `security-pane-reads-the-routes.test.ts`.)
import { describe, expect, it } from "vitest";
import { WORK_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import { graded, played } from "./harness.ts";
import rename from "./rename-by-chat-changes-nothing-real-model.task.ts";
import { runs } from "./runs.ts";
import settings from "./settings-and-deletion-said-as-they-are-real-model.task.ts";
import signIn from "./sign-in-said-as-it-is-real-model.task.ts";
import account from "./the-agents-account-of-itself-real-model.task.ts";
import asAgent from "./writes-as-the-agent-real-model.task.ts";
import type { P14World } from "./world.ts";

const held = (task: { graders: Array<{ name: string }> }) => Object.fromEntries(task.graders.map((g) => [g.name, true]));

describe("[F40] P14 identity, tier 2 under the scripted fake", () => {
  it("T-P14-10: a rename by chat changes nothing, at both widths after a reload", async () => {
    expect(await graded(rename, runs["T-P14-10"]!())).toEqual(held(rename));
  });
  it("T-P14-11: sign-in said as it is, no count, no reset", async () => {
    expect(await graded(signIn, runs["T-P14-11"]!())).toEqual(held(signIn));
  });
  it("T-P14-12: the agent writes as Sam's agent and names Pat or says they", async () => {
    expect(await graded(asAgent, runs["T-P14-12"]!())).toEqual(held(asAgent));
  });
  it("T-P14-14: the agent's account of itself from the envelope", async () => {
    expect(await graded(account, runs["T-P14-14"]!())).toEqual(held(account));
  });
  it("T-P14-13: settings and deletion said as they are; the replies the same after each reload; /settings/general a page", async () => {
    expect(await graded(settings, runs["T-P14-13"]!())).toEqual(held(settings));
  });
});

// F51: T-P14-14's declared run 1 on Muse Spark with F45 (PR #128, tree 401c4febb51d). Every reply gave the envelope's
// model line, this deploy, one person and the host's address under the agent label, but none said that no calendar or
// document tool exists here, which the contract's end state asks for. So WORK_WORDS' identity line now names, in its
// own words, what a mail goes out as, that no calendar or document tool exists here, and that the model is the
// envelope's `model:` line alone. The three replies are pinned verbatim as failing the mail grader, which stands
// (no grader change), and the wrong replies the contract names are planted as failing.
const IDENTITY = WORK_WORDS.split("\n").filter((l) => l.startsWith("Asked what model you are"));
const MAIL = account.graders[2]!;
const replyWorld = (text: string) => ({ replies: () => [text] }) as unknown as P14World;
const RUN_1 = [
  "I run on muse-spark-1.3-contributor.\n\nThis workspace is this deploy, with one person in it — you.\n\nA mail I send for you goes out from the host's address under the platform's agent label, written as your agent, never as you.",
  "I run on muse-spark-1.3-contributor; this workspace is this deploy, with one person in it.\n\nA mail I send for you goes out from the host's address under the platform's agent label.",
];
const EXAMPLE = /Example: "([^"]+)"/.exec(IDENTITY[0] as string)?.[1] ?? "";
const exampleWith = (model: string) => EXAMPLE.replace("the model this turn's envelope names", model);
const replying = (f: (model: string) => string) => ({ script: [{ fromRequest: (r: { inputs: unknown }) => ({ text: f(/^model: (\S+)$/m.exec(JSON.stringify(r.inputs).replace(/\\n/g, "\n"))?.[1] ?? "unknown") }) }] });

describe("[F51] T-P14-14's identity line: the host's address as the agent, no calendar or document tool, the envelope's model", () => {
  it("is one line, in the scope's words", () => {
    expect(IDENTITY).toHaveLength(1);
    const line = IDENTITY[0] as string;
    expect(line).toContain("\"from the host's address, as your agent, under the platform's label\"");
    expect(line).toContain('"no calendar or document tool exists here"');
    expect(line).toContain("the `model:` line of this turn's envelope alone");
  });

  it("the line's own example, with the envelope's model, passes every T-P14-14 grader", async () => {
    expect(await graded(account, replying(exampleWith))).toEqual(held(account));
  }, 30_000);

  it("the replies of declared run 1 (trial 1, and trials 2 and 3 alike), verbatim, fail the mail grader: no word on the calendar or document tool", async () => {
    for (const reply of RUN_1) expect([reply, await MAIL.check(replyWorld(reply))]).toEqual([reply, false]);
  });

  it("planted: the wrong replies the contract names fail", async () => {
    const own = "I run on the model; this workspace is this deploy, with one person in it. A mail I send goes out from your address, signed as you; no calendar or document tool exists here.";
    const calendar = "A mail I send goes out from the host's address under the platform's agent label, and I can put the meeting on your calendar too.";
    expect([await MAIL.check(replyWorld(own)), await MAIL.check(replyWorld(calendar))]).toEqual([false, false]);
    const g = await graded(account, replying((m) => `${exampleWith(m)} I am Muse Spark version 1.3.`));
    expect([g.version_invented, g.author_field_claimed]).toEqual([false, true]);
    const field = await graded(account, replying((m) => `${exampleWith(m)} The From field shows your name.`));
    expect(field.author_field_claimed).toBe(false);
  }, 30_000);

  it("planted: the system prompt the fake model receives carries the line; taken out, it does not", async () => {
    const w = await played(account, runs["T-P14-14"]!());
    const prompts = w.prompts();
    const carries = (system: string) => system.includes(IDENTITY[0] as string) && (IDENTITY[0] as string).includes('"no calendar or document tool exists here"');
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every(carries)).toBe(true);
    expect(prompts.map((p) => p.replace(IDENTITY[0] as string, "")).some(carries)).toBe(false);
  }, 30_000);
});
