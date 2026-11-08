// F42 (B-P9-05, Q31): a credential refused on a host is one instruction line in the chat's task block (`WORK_WORDS`):
// the reply says the key is not bound to that host, naming it, and that only the person can bind it. Code has already
// refused the call and written its audit row; the line only words the reply. On fletch-pv-1 (F37) the model said the
// host "isn't on your list of allowed hosts", which T-P9-15's grader does not hear. Here the line reaches every chat
// request of T-P9-15's scripted run, whose reply follows it and holds every grader, and the old reply, planted in its
// place, still fails the grader.
// The oracle correction (KICKOFF, all three things): on fletch-pv-2 the model said the line's words in every trial of
// four runs, after a lead-in bubble of its own ("I'll read that probe with your Example API key."), which the old
// grader took for the first reply. The refused turn is pinned verbatim below as a pass; the old reply, a turn with only
// the lead-in, and words said in the wrong turn each still fail; the failed runs are `evidence/results/b3f0abb43bf0….json`.
import { describe, expect, it } from "vitest";
import { CHAT_TASK, WORK_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import { played } from "./harness.ts";
import { BOUND_REPLY, call, load, runs } from "./runs.ts";
import unbound, { ASKS } from "./unbound-host-real-model.task.ts";
import type { P9World } from "./world.ts";
import { API_REF, OTHER_HOST, PROBE_OTHER } from "./world.ts";

const FIRST = "the first reply says the host is not one the key is bound to";
const lines = WORK_WORDS.split("\n").filter((l) => l.includes('"is not bound to"'));
const LINE = lines[0] ?? "";
/** The reply Q31 records from the slot, in place of the scripted first reply. */
const OLD = `I couldn't read that: ${OTHER_HOST} isn't on your list of allowed hosts for this key, so nothing was sent.`;
/** The first trial of the fourth run on fletch-pv-2 (6cec36d), its first turn's two bubbles verbatim: refused by the old grader. */
const SLOT_LEADIN = "I'll read that probe with your Example API key.";
const SLOT_WORDS = "Your Example API key is not bound to api.example.org, so nothing was sent there; only you can bind it to that host.";
/** The old grader's first-reply check, as shipped before F42: the chat's first agent bubble. */
const oldFirst = (w: P9World) => /not (bound|allowed|permitted)|isn't (bound|allowed)/i.test(w.replies("c1")[0] ?? "") && (w.replies("c1")[0] ?? "").includes(OTHER_HOST);
/** The old grader's second-turn words, as shipped before F42: the chat's second agent bubble. */
const oldSecond = (w: P9World) => /only you/i.test(w.replies("c1")[1] ?? "");
const SECOND = "the second turn raises the credentials.host card or says only Sam can bind it, and no host row appears";

const verdicts = async (w: P9World) => Object.fromEntries(await Promise.all(unbound.graders.map(async (g) => [g.name, g.kind === "minefield" ? !(await g.check(w)) : await g.check(w)])));
const held = Object.fromEntries(unbound.graders.map((g) => [g.name, true]));
const firstHeard = (w: P9World) => unbound.graders.find((g) => g.name === FIRST)!.check(w);
/** `w` with its first turn's reply in other words (Sam's ask, then one bubble), as the grader would read it had the model said them. */
const saying = (w: P9World, text: string): P9World =>
  Object.assign(Object.create(w) as P9World, {
    thread: (c?: Parameters<P9World["thread"]>[0]) => {
      const t = w.thread(c);
      const next = t.findIndex((e, i) => i > 0 && e.kind === "you");
      return [t[0]!, { kind: "agent", text }, ...(next < 0 ? [] : t.slice(next))];
    },
  });
/** `w` with its first turn drawn as `bubbles` (Sam's ask, then each bubble), as the slot drew it before F45. */
const asDrawn = (w: P9World, bubbles: string[]): P9World =>
  Object.assign(Object.create(w) as P9World, {
    thread: (c?: Parameters<P9World["thread"]>[0]) => {
      const t = w.thread(c);
      const next = t.findIndex((e, i) => i > 0 && e.kind === "you");
      return [t[0]!, ...bubbles.map((text) => ({ kind: "agent", text })), ...(next < 0 ? [] : t.slice(next))];
    },
  });
/** Every chat model request carries the line, as the prompt assembles it. */
const carried = (prompts: string[]) => prompts.length > 0 && prompts.every((p) => p.includes(LINE));

describe("[F42] a credential refused on a host: the bound-host line", () => {
  it("the task block carries one line for it, in the words T-P9-15's grader hears, quoting neither of its prompts", async () => {
    expect(lines).toHaveLength(1);
    expect(CHAT_TASK).toContain(LINE);
    expect(LINE).toMatch(/only the person can bind it/);
    expect(LINE).toMatch(/"only you can bind it"/);
    expect(LINE).toMatch(/never call it a list of allowed hosts/);
    expect(LINE).toMatch(/nothing was sent: your first message says in these words/);
    for (const ask of ASKS) expect(WORK_WORDS).not.toContain(ask);
    const example = /Example: "([^"]+)"/.exec(LINE)?.[1] ?? "";
    const w = await played(unbound, runs["T-P9-15"]!());
    expect(await firstHeard(saying(w, example.replace("api.weather.example", OTHER_HOST)))).toBe(true);
  });

  it("T-P9-15 under the scripted fake: every chat request carries the line, and the run whose first reply follows it holds every grader", async () => {
    const w = await played(unbound, runs["T-P9-15"]!());
    expect(carried(w.prompts())).toBe(true);
    expect(w.replies("c1")[0]).toBe(BOUND_REPLY);
    expect(await verdicts(w)).toEqual(held);
  });

  it("planted: the old allowed-hosts reply fails the grader, and a prompt without the line is caught", async () => {
    const w = await played(unbound, runs["T-P9-15"]!());
    expect(await firstHeard(saying(w, OLD))).toBe(false);
    const o = runs["T-P9-15"]!();
    const old = await played(unbound, { ...o, script: o.script.map((s, i) => (i === 2 ? { text: OLD } : s)) });
    expect(old.replies("c1")[0]).toBe(OLD);
    expect((await verdicts(old))[FIRST]).toBe(false);
    expect(carried(w.prompts().map((p) => p.replace(LINE, "")))).toBe(false);
  });

  describe("the oracle correction: a reply is the turn's, every bubble after the ask", () => {
    const o = runs["T-P9-15"]!();
    /** T-P9-15's run with the lead-in beside the first step's call and the turns' words replaced. */
    const slotLike = (words: string, second?: string) => ({ ...o, script: [...o.script.slice(0, 3).map((s, i) => (i === 0 && "toolCall" in s ? { ...s, text: SLOT_LEADIN } : i === 2 ? { text: words } : s)), ...(second === undefined ? o.script.slice(3) : [{ text: second }])] });

    it("the refused turn from the slot, pinned verbatim, passes every grader; the old grader read its lead-in and refused it", async () => {
      const w = await played(unbound, slotLike(SLOT_WORDS));
      // Since F45 the lead-in beside the first step's call is commentary: kept on its row for the model, never a bubble.
      expect(w.replies("c1")[0]).toBe(SLOT_WORDS);
      expect(await verdicts(w)).toEqual(held);
      // The turn as the slot drew it before F45, the lead-in its own bubble, pinned verbatim.
      const drawn = asDrawn(w, [SLOT_LEADIN, SLOT_WORDS]);
      expect(drawn.replies("c1").slice(0, 2)).toEqual([SLOT_LEADIN, SLOT_WORDS]);
      expect(oldFirst(drawn)).toBe(false);
      expect(await verdicts(drawn)).toEqual(held);
    });

    it("planted: the old reply after the lead-in, the lead-in alone, and the words only in the second turn each still fail", async () => {
      expect((await verdicts(await played(unbound, slotLike(OLD))))[FIRST]).toBe(false);
      expect((await verdicts(await played(unbound, slotLike("Let me look into that host."))))[FIRST]).toBe(false);
      expect((await verdicts(await played(unbound, slotLike("Let me look into that host.", SLOT_WORDS))))[FIRST]).toBe(false);
    });

    it("planted: the first turn's \"only you\" with no card and a second turn that says neither fails the second-turn grader, which the old reading passed", async () => {
      const w = await played(unbound, slotLike(SLOT_WORDS, "I can look at other options for that host."));
      expect(w.cards("c1")).toEqual([]);
      expect((await verdicts(w))[SECOND]).toBe(false);
      // Drawn as before F45, the lead-in a bubble of its own: the old reading took the first turn's words for the second's.
      const drawn = asDrawn(w, [SLOT_LEADIN, SLOT_WORDS]);
      expect(oldSecond(drawn)).toBe(true);
      expect((await verdicts(drawn))[SECOND]).toBe(false);
    });
  });
});

// F54 (B-P9-05): on the P9 re-sweep (PR #134, fletch-pv-1, tree f8d5ae4ad665) T-P9-15's trial 3 called `credential_list`
// and `credential_host_propose` after the refusal with no words of its own; the first turn's only bubble was code's
// waiting sentence and the words came in the second turn (`evidence/results/ac2cd4280c02….json`). The line now asks for
// the words as the text of the step after the refusal, before or beside any `credential_host_propose` call, never beside
// another call. Words beside a call in a step that pauses on a card are that turn's reply (F45, `commentary.ts`), so a
// turn that waits on the host card has already said them; words beside a list or a search are commentary and never shown.
const F54_CLAUSE = "before or beside any credential_host_propose call and never beside another call";
/** Code's waiting sentence for the host card (F48's `pauseWords`), the only bubble of trial 3's first turn. */
const WAITING = "Waiting for your decision: credential host propose. It has not run yet.";
/** Trial 3's two lead-ins beside its first steps' calls, folded away as commentary (F45). */
const TRIAL3_LEADINS = ["Starting on that probe read – pulling the right tool first.", "Got it — reading that address with your key now."];
/** Trial 3's second turn as read from the slot (its opening sentences; the rest of that reply was not kept). */
const TRIAL3_SECOND = "Your Example API key is not bound to api.example.org, so nothing was sent there; only you can bind it.";

describe("[F54] the refused host is said before any card", () => {
  /** T-P9-15's first turn as trial 3 played it: the read refused, then a list and the propose call; `words` beside `wordsAt` ("list" or "propose"). */
  const trial3 = (words?: { text: string; at: "list" | "propose" }) => ({
    seed: runs["T-P9-15"]!().seed,
    script: [
      { ...load("fixture"), text: TRIAL3_LEADINS[0] },
      { ...call("fixture_read", { url: PROBE_OTHER }, "read1"), text: TRIAL3_LEADINS[1] },
      load("credentials"),
      { ...call("credential_list", {}, "list1"), ...(words?.at === "list" ? { text: words.text } : {}) },
      { ...call("credential_host_propose", { ref: API_REF, host: OTHER_HOST }, "prop1"), ...(words?.at === "propose" ? { text: words.text } : {}) },
      { text: TRIAL3_SECOND },
    ],
  });

  it("the system prompt the fake model receives carries the sharpened line on every chat request; without it the prompt is caught", async () => {
    expect(LINE).toContain(F54_CLAUSE);
    expect(LINE).toMatch(/as the text of the step that follows the refusal/);
    expect(LINE).toMatch(/so a turn that waits on the host card has already said them/);
    const w = await played(unbound, trial3({ text: SLOT_WORDS, at: "propose" }));
    expect(w.prompts().length).toBeGreaterThan(0);
    expect(w.prompts().every((p) => p.includes(LINE) && p.includes(F54_CLAUSE))).toBe(true);
    // Planted: the line removed from the system prompt, and the line's old text (before F54) in its place.
    expect(carried(w.prompts().map((p) => p.replace(LINE, "")))).toBe(false);
    const before = LINE.replace(/, as the text of the step that follows the refusal, .*?, so a turn that waits on the host card has already said them/, "");
    expect(before).not.toContain(F54_CLAUSE);
    expect(w.prompts().map((p) => p.replace(LINE, before)).every((p) => p.includes(F54_CLAUSE))).toBe(false);
  });

  it("trial 3's first turn, pinned verbatim (no words of the model's, then the propose call and code's waiting sentence), fails the first-reply grader", async () => {
    const w = await played(unbound, trial3());
    const said = w.replies("c1");
    expect(said[0]).toBe(WAITING);
    expect(said.slice(0, 2)).toEqual([WAITING, TRIAL3_SECOND]);
    expect(said.some((r) => TRIAL3_LEADINS.includes(r))).toBe(false);
    expect(w.cards("c1").some((c) => c.tool === "credential_host_propose")).toBe(true);
    expect((await verdicts(w))[FIRST]).toBe(false);
  });

  it("planted: the words before the propose call in the first turn, beside it, pass every grader", async () => {
    const w = await played(unbound, trial3({ text: SLOT_WORDS, at: "propose" }));
    expect(w.replies("c1").slice(0, 2)).toEqual([SLOT_WORDS, WAITING]);
    expect(await verdicts(w)).toEqual(held);
  });

  it("planted: the words beside the list call are commentary, never shown, and the first reply still fails", async () => {
    const w = await played(unbound, trial3({ text: SLOT_WORDS, at: "list" }));
    expect(w.replies("c1")[0]).toBe(WAITING);
    expect((await verdicts(w))[FIRST]).toBe(false);
  });
});
