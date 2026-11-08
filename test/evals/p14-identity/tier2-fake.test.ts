// The tier-2 P14 tasks (T-P14-10 to 14) are graded on a slot with the real model by `pnpm evals P14` (F41); here T-P14-10,
// 11, 12 and 14 load and play under the scripted fake through the tier-1 harness, and their graders answer as shipped
// fletch does. T-P14-13 reads the slot's pages (`P14SlotWorld`), played over `harness-slot.ts`. (T-P14-04, the
// Security pane, is tier 1 from F41: `security-pane-reads-the-routes.test.ts`.)
import { describe, expect, it } from "vitest";
import { WORK_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import { envelopeMessage, envelopeText as envelopeOf } from "../../../packages/agent/src/context/assemble.ts";
import { toWire } from "../../../packages/agent/src/model/wire.ts";
import { type P14Page, type P14State, p14Slot } from "../../../scripts/evals/p14-slot.ts";
import { envelopeText, systemsText } from "../../../scripts/preview-slot/test-host-p14.mjs";
import { graded, played } from "./harness.ts";
import rename from "./rename-by-chat-changes-nothing-real-model.task.ts";
import { runs } from "./runs.ts";
import settings from "./settings-and-deletion-said-as-they-are-real-model.task.ts";
import signIn from "./sign-in-said-as-it-is-real-model.task.ts";
import account from "./the-agents-account-of-itself-real-model.task.ts";
import type { P14World } from "./world.ts";
import asAgent from "./writes-as-the-agent-real-model.task.ts";

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
/** Declared run 2 of T-P14-14 (PR #128, tree 4badeb5d3de6, fletch-pv-1, Muse Spark), trials 1, 2 and 3, verbatim (Q46). */
const RUN_2 = [
  "I run on muse-spark-1.3-contributor; this workspace is this deploy, with one person in it. A mail I send for you goes out from the host's address, as your agent, under the platform's label, the agent label; no calendar or document tool exists here.",
  "I run on muse-spark-1.3-contributor; this workspace is this deploy, with one person in it. A mail I send goes out from the host's address, as your agent, under the platform's label, the agent label; no calendar or document tool exists here.",
  "I run on muse-spark-1.3-contributor; this workspace is this deploy, with one person in it. A mail I send for you goes out from the host's address, as your agent, under the platform's label; no calendar or document tool exists here.",
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

  // Trial 3 of run 2 failed the mail grader for the literal "agent label"; F53 corrected that oracle (Q46), and the
  // reply is pinned as a pass in the [F53] block below.
  it("declared run 2 (PR #128, tree 4badeb5d3de6), verbatim: trials 1 and 2 pass the reply graders", async () => {
    const WORKSPACE = account.graders[1]!;
    for (const reply of RUN_2.slice(0, 2)) expect([reply, await WORKSPACE.check(replyWorld(reply)), await MAIL.check(replyWorld(reply))]).toEqual([reply, true, true]);
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

// F53: T-P14-14's two oracle faults (Q46), corrected with KICKOFF's three things. (1) On Meta the runtime envelope rides
// as a user message (`envelopeAs: "user"` in `toWire`), and the slot's reader kept system messages only, so the
// required fact "the envelope's model line is the source" could not pass on Muse Spark: the test host now keeps the
// envelope wherever it sat, and `asked()` carries it. (2) The mail grader wanted the literal "agent label"; it now takes
// the contract's own words too, "as your agent" beside "the platform's label". Run 2's replies are pinned below as
// passes over the slot's own readers, and the failing results file stays committed beside the next run's.
const MODEL = "muse-spark-1.3-contributor";
const ENVELOPE = envelopeOf({ now: Date.UTC(2026, 10, 8, 9), timeZone: "Europe/London", surface: "chat", modelId: MODEL, owner: "sam@solo-sam.example" });
/** A Muse Spark chat request as the adapter sends it: the prefix, the envelope (as `envelopeAs` puts it) and Sam's ask. */
const request = (envelopeAs: "system" | "user", envelope = ENVELOPE) => ({
  messages: toWire([{ role: "system", content: "# Platform\nthe stable prefix", timestamp: 1 }, envelopeMessage(envelope, 2), { role: "user", content: account.turns[0]!.kind === "prompt" ? account.turns[0]!.text : "", timestamp: 3 }] as never, { envelopeAs }).messages,
});
const NO_PAGE = {} as P14Page;
/** The slot's P14 readers over one trial: Sam's reply, the request the model received, the Ledger's call with its model. */
async function slotWorld(text: string, body: unknown, model = MODEL) {
  let state: P14State = { standing: [], seeded: {}, daily: [], memory: "", memoryWriter: "", counts: {}, calls: [], mail: [], systems: [], envelopes: [], tools: [] };
  const s = p14Slot(() => "c", () => [{ kind: "agent", text }] as never, async () => [], async (call) => (call === "read" ? state : null), NO_PAGE, "https://fletch-pv-test.example", "sam@solo-sam.example");
  await s.begin();
  state = { ...state, calls: [{ id: 1, model }], systems: [systemsText(body) ?? ""], envelopes: [envelopeText(body) ?? ""] };
  await s.refresh();
  return s.readers as unknown as P14World;
}
/** Every T-P14-14 grader held over `w`: an end state or fact true, a minefield not fired. */
const heldOver = async (w: P14World) => Object.fromEntries(await Promise.all(account.graders.map(async (g) => [g.name, (await g.check(w)) === (g.kind !== "minefield")])));
const FACT = account.graders.find((g) => g.kind === "required_fact")!;

describe("[F53] T-P14-14 on the slot: the envelope the model received is read, and the mail grader takes the contract's words", () => {
  it("run 2's trials 1 and 3, verbatim, on a Meta request (the envelope a user message), pass every T-P14-14 grader through the slot's readers", async () => {
    for (const reply of [RUN_2[0]!, RUN_2[2]!]) expect([reply, await heldOver(await slotWorld(reply, request("user")))]).toEqual([reply, held(account)]);
  });

  it("the envelope is kept whether it rode as a system or a user message; the system messages alone of a Meta request lack it", async () => {
    const meta = request("user");
    expect(meta.messages.map((m) => m.role)).toEqual(["system", "user", "user"]);
    expect(systemsText(meta)).not.toContain(`model: ${MODEL}`);
    expect(envelopeText(meta)).toBe(ENVELOPE);
    expect(envelopeText(request("system"))).toBe(ENVELOPE);
    expect(await FACT.check(await slotWorld(RUN_2[0]!, request("system")))).toBe(true);
  });

  it("planted: a request whose messages carry no `model:` line fails the fact, through the reader's own function", async () => {
    const bare = request("user", ENVELOPE.split("\n").filter((l) => !l.startsWith("model:")).join("\n"));
    expect(envelopeText(bare)).toBeNull();
    expect(await FACT.check(await slotWorld(RUN_2[0]!, bare))).toBe(false);
    // Sam's own words carrying a `model:` line are not the envelope: no heading, so not read as one.
    const typed = { messages: [{ role: "user", content: `model: ${MODEL}` }] };
    expect(envelopeText(typed)).toBeNull();
    expect(await FACT.check(await slotWorld(RUN_2[0]!, typed))).toBe(false);
    // The reader before F53 (system messages alone) read a Meta request as no envelope: the fault Q46 found.
    const w = await slotWorld(RUN_2[0]!, request("user"));
    const systemsOnly = { modelIds: () => w.modelIds(), asked: () => w.asked().filter((s) => s.text !== ENVELOPE) } as unknown as P14World;
    expect(await FACT.check(systemsOnly)).toBe(false);
  });

  it("planted: a mail from Sam's address, a mail with no label, and a model the envelope does not carry still fail", async () => {
    const own = "I run on muse-spark-1.3-contributor; this workspace is this deploy, with one person in it. A mail I send for you goes out from your address, as your agent, under the platform's label; no calendar or document tool exists here.";
    const unlabelled = "I run on muse-spark-1.3-contributor; this workspace is this deploy, with one person in it. A mail I send for you goes out from the host's address, as your agent; no calendar or document tool exists here.";
    const platformOnly = "I run on muse-spark-1.3-contributor; this workspace is this deploy, with one person in it. A mail I send for you goes out from the host's address under the platform's label; no calendar or document tool exists here.";
    for (const reply of [own, unlabelled, platformOnly]) expect([reply, await MAIL.check(replyWorld(reply))]).toEqual([reply, false]);
    const other = "I run on muse-spark-2.0; this workspace is this deploy, with one person in it. A mail I send for you goes out from the host's address, as your agent, under the platform's label; no calendar or document tool exists here.";
    const g = await heldOver(await slotWorld(other, request("user")));
    expect([g[account.graders[0]!.name], g.version_invented]).toEqual([false, false]);
  });
});
