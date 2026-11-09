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
// F59 (Q50, Kyle's ruling of 2026-11-08): the sentence is code's. The gate says it from the refusal's own facts
// (`hostRefusalWords`) as the refused call's announce, before any card; the line keeps only what code does not say.
// The model-only pins below are planted with code's sentence taken out of the thread, the path before F59.
import { describe, expect, it } from "vitest";
import { ChatGate, ownTask } from "../../../packages/agent/src/chat/gate.ts";
import { EffectBuffer } from "../../../packages/agent/src/chat/tools.ts";
import { EgressRefusedError, hostRefusalWords } from "../../../packages/agent/src/connectors/egress.ts";
import type { ToolSpec } from "../../../packages/agent/src/tools/registry.ts";
import { CHAT_TASK, WORK_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import { asSam, exampleKey, played } from "./harness.ts";
import { BOUND_REPLY, call, load, runs } from "./runs.ts";
import unbound, { ASKS, CODE_WORDS } from "./unbound-host-real-model.task.ts";
import type { P9World } from "./world.ts";
import { API_REF, OTHER_HOST, PROBE_OTHER } from "./world.ts";

const FIRST = "the first reply says the host is not one the key is bound to";
const lines = WORK_WORDS.split("\n").filter((l) => l.includes("credential_host_propose so they decide on its card"));
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

/** Code's sentence as the tier-1 world says it: the harness's key carries no label, so it is named by its reference. */
const CODE = hostRefusalWords({ code: "EGRESS_HOST_DENIED", host: OTHER_HOST, ref: API_REF });
/** `w` as fletch drew it before F59: the model's words alone, code's sentence taken out (the rule removed). */
const modelOnly = (w: P9World): P9World =>
  Object.assign(Object.create(w) as P9World, { thread: (c?: Parameters<P9World["thread"]>[0]) => w.thread(c).filter((e) => !(e.kind === "agent" && e.text === CODE)) });

describe("[F42] a credential refused on a host: the bound-host line", () => {
  it("the task block carries one line for it, trimmed by F59 to what code does not say, quoting neither of its prompts", async () => {
    expect(lines).toHaveLength(1);
    expect(CHAT_TASK).toContain(LINE);
    expect(LINE).toMatch(/code has already said to them that the key is not bound to that host/);
    expect(LINE).toMatch(/"only you can bind it"/);
    expect(LINE).toMatch(/never call it a list of allowed hosts/);
    expect(WORK_WORDS).not.toContain('"is not bound to"');
    for (const ask of ASKS) expect(WORK_WORDS).not.toContain(ask);
  });

  it("T-P9-15 under the scripted fake: every chat request carries the line, code's sentence opens the first reply, and the run holds every grader", async () => {
    const w = await played(unbound, runs["T-P9-15"]!());
    expect(carried(w.prompts())).toBe(true);
    expect(w.replies("c1").slice(0, 2)).toEqual([CODE, BOUND_REPLY]);
    expect(await verdicts(w)).toEqual(held);
  });

  it("planted: the old allowed-hosts reply with no sentence of code's fails the grader, and a prompt without the line is caught", async () => {
    const w = await played(unbound, runs["T-P9-15"]!());
    expect(await firstHeard(saying(w, OLD))).toBe(false);
    const o = runs["T-P9-15"]!();
    const old = await played(unbound, { ...o, script: o.script.map((s, i) => (i === 2 ? { text: OLD } : s)) });
    expect(old.replies("c1").slice(0, 2)).toEqual([CODE, OLD]);
    expect((await verdicts(old))[FIRST]).toBe(true);
    expect((await verdicts(modelOnly(old)))[FIRST]).toBe(false);
    expect(carried(w.prompts().map((p) => p.replace(LINE, "")))).toBe(false);
  });

  describe("the oracle correction: a reply is the turn's, every bubble after the ask", () => {
    const o = runs["T-P9-15"]!();
    /** T-P9-15's run with the lead-in beside the first step's call and the turns' words replaced. */
    const slotLike = (words: string, second?: string) => ({ ...o, script: [...o.script.slice(0, 3).map((s, i) => (i === 0 && "toolCall" in s ? { ...s, text: SLOT_LEADIN } : i === 2 ? { text: words } : s)), ...(second === undefined ? o.script.slice(3) : [{ text: second }])] });

    it("the refused turn from the slot, pinned verbatim, passes every grader; the old grader read its lead-in and refused it", async () => {
      const w = await played(unbound, slotLike(SLOT_WORDS));
      // Since F45 the lead-in beside the first step's call is commentary: kept on its row for the model, never a bubble.
      expect(w.replies("c1").slice(0, 2)).toEqual([CODE, SLOT_WORDS]);
      expect(await verdicts(w)).toEqual(held);
      // The turn as the slot drew it before F45, the lead-in its own bubble, pinned verbatim.
      const drawn = asDrawn(w, [SLOT_LEADIN, SLOT_WORDS]);
      expect(drawn.replies("c1").slice(0, 2)).toEqual([SLOT_LEADIN, SLOT_WORDS]);
      expect(oldFirst(drawn)).toBe(false);
      expect((await verdicts(drawn))[FIRST]).toBe(true);
    });

    it("planted (code's sentence taken out): the old reply after the lead-in, the lead-in alone, and the words only in the second turn each fail", async () => {
      expect((await verdicts(modelOnly(await played(unbound, slotLike(OLD)))))[FIRST]).toBe(false);
      expect((await verdicts(modelOnly(await played(unbound, slotLike("Let me look into that host.")))))[FIRST]).toBe(false);
      expect((await verdicts(modelOnly(await played(unbound, slotLike("Let me look into that host.", SLOT_WORDS)))))[FIRST]).toBe(false);
    });

    it("planted: a second turn that raises no card and says neither fails the second-turn grader", async () => {
      const w = await played(unbound, slotLike(SLOT_WORDS, "I can look at other options for that host."));
      expect(w.cards("c1")).toEqual([]);
      expect((await verdicts(w))[SECOND]).toBe(false);
      const drawn = asDrawn(w, [SLOT_LEADIN, SLOT_WORDS]);
      expect(oldSecond(drawn)).toBe(true);
      expect((await verdicts(drawn))[SECOND]).toBe(false);
    });
  });
});

// F54 (B-P9-05): on the P9 re-sweep (PR #134, fletch-pv-1, tree f8d5ae4ad665) T-P9-15's trial 3 called `credential_list`
// and `credential_host_propose` after the refusal with no words of its own; the first turn's only bubble was code's
// waiting sentence and the words came in the second turn (`evidence/results/ac2cd4280c02….json`). F54 sharpened the line;
// Q50's trial 2 still failed. F59 moves the sentence to code: both turns, pinned verbatim, pass now that code speaks.
/** Code's waiting sentence for the host card (F48's `pauseWords`). */
const WAITING = "Waiting for your decision: credential host propose. It has not run yet.";
/** Trial 3's two lead-ins beside its first steps' calls, folded away as commentary (F45). */
const TRIAL3_LEADINS = ["Starting on that probe read – pulling the right tool first.", "Got it — reading that address with your key now."];
/** Trial 3's second turn as read from the slot (its opening sentences; the rest of that reply was not kept). */
const TRIAL3_SECOND = "Your Example API key is not bound to api.example.org, so nothing was sent there; only you can bind it.";

/** Trial 2 of F54's declared run on fletch-pv-2 (tree d174647ece72), read from the slot before release: its first turn's words, beside the propose call, then its second turn. */
const TRIAL2_FIRST = "That read was refused — I'll prepare the binding request now.";
const TRIAL2_SECOND = "Your Example API key is not bound to api.example.org, so nothing was sent there; only you can bind it.\n\nI can't add it myself — only you can bind it on the card I just sent for approval.";

/** T-P9-15's first turn as trial 3 played it: the read refused, then a list and the propose call; `words` beside the propose call. */
const trial3 = (words?: string) => ({
  seed: runs["T-P9-15"]!().seed,
  script: [
    { ...load("fixture"), text: TRIAL3_LEADINS[0] },
    { ...call("fixture_read", { url: PROBE_OTHER }, "read1"), text: TRIAL3_LEADINS[1] },
    load("credentials"),
    call("credential_list", {}, "list1"),
    { ...call("credential_host_propose", { ref: API_REF, host: OTHER_HOST }, "prop1"), ...(words ? { text: words } : {}) },
    { text: TRIAL3_SECOND },
  ],
});

describe("[F59] the refused host's sentence is code's, before any card", () => {
  it("the sentence is the refusal's own facts: the key's label, else its reference's name, and the host", () => {
    expect(hostRefusalWords({ code: "EGRESS_HOST_DENIED", host: OTHER_HOST, ref: API_REF, label: "Example API" })).toBe(TRIAL3_SECOND);
    expect(CODE).toBe("Your example-api key is not bound to api.example.org, so nothing was sent there; only you can bind it.");
    expect(hostRefusalWords({ code: "EGRESS_CRED_HOST_DENIED", host: "h.example", ref: "cred://w", label: "Weather key" })).toBe("Your Weather key is not bound to h.example, so nothing was sent there; only you can bind it.");
    expect(CODE_WORDS.test(CODE)).toBe(true);
  });

  it("trial 3's first turn (no words of the model's, then the propose call) now passes every grader: code's sentence comes before the card", async () => {
    const w = await played(unbound, trial3());
    expect(w.replies("c1").slice(0, 3)).toEqual([CODE, WAITING, TRIAL3_SECOND]);
    expect(w.replies("c1").some((r) => TRIAL3_LEADINS.includes(r))).toBe(false);
    expect(await verdicts(w)).toEqual(held);
    // Planted: the rule removed (code says nothing, the path before F59), the turn fails as it did on the slot.
    expect((await verdicts(modelOnly(w)))[FIRST]).toBe(false);
  });

  it("Q50's failed trial 2 (fletch-pv-2, tree d174647ece72), its first turn pinned verbatim, passes now that code speaks; without code's sentence it fails", async () => {
    const o = trial3(TRIAL2_FIRST);
    const w = await played(unbound, { ...o, script: [...o.script.slice(0, 3), o.script[4]!, { text: TRIAL2_SECOND }] });
    expect(w.replies("c1")).toEqual([CODE, TRIAL2_FIRST, WAITING, TRIAL2_SECOND]);
    expect(await verdicts(w)).toEqual(held);
    const before = await verdicts(modelOnly(w));
    expect(before[FIRST]).toBe(false);
    expect(Object.entries(before).find(([k]) => k.startsWith("the words are code's"))?.[1]).toBe(false);
  });

  it("the Vault names the key by the label Sam gave it on the form; without its lookup the reference's name stands in", async () => {
    const o = runs["T-P9-15"]!();
    const w = await played(unbound, { seed: async (x) => void (await x.vault().capture({ ...exampleKey(), label: "Example API" }, asSam())), script: o.script });
    expect(w.replies("c1")[0]).toBe(TRIAL3_SECOND);
    expect(w.replies("c1")).not.toContain(CODE);
  });

  it("planted: words beside the list call are commentary, never shown; code's sentence is still the first reply's", async () => {
    const o = trial3();
    const w = await played(unbound, { ...o, script: o.script.map((s, i) => (i === 3 ? { ...s, text: SLOT_WORDS } : s)) });
    expect(w.replies("c1")).not.toContain(SLOT_WORDS);
    expect(w.replies("c1").slice(0, 2)).toEqual([CODE, WAITING]);
  });

  it("a second keyed call refused in the same turn: one sentence per refusal", async () => {
    const w = await played(unbound, { seed: runs["T-P9-15"]!().seed, script: [load("fixture"), call("fixture_read", { url: PROBE_OTHER }, "read1"), call("fixture_read", { url: `${PROBE_OTHER}/again` }, "read2"), { text: "Both reads were refused." }, { text: "Only you can bind it." }] });
    expect(w.replies("c1").filter((r) => r === CODE)).toHaveLength(2);
    expect(w.auditRows().filter((a) => a.host === OTHER_HOST)).toHaveLength(2);
  });

  it("a refusal that is not a host refusal says no sentence: an unknown key", async () => {
    const w = await played(unbound, { seed: runs["T-P9-15"]!().seed, script: [load("fixture"), call("fixture_read", { url: PROBE_OTHER, credential: "cred://nope" }, "read1"), { text: "That key is not saved." }, { text: "Only you can bind it." }] });
    expect(w.auditRows().some((a) => a.outcome === "EGRESS_CRED_UNKNOWN")).toBe(true);
    expect(w.replies("c1").some((r) => CODE_WORDS.test(r) || / is not bound to /.test(r))).toBe(false);
  });

  describe("the gate, on the production path: only a keyed host refusal speaks, once per call", () => {
    const gate = (effects: EffectBuffer) => new ChatGate({ principal: "sam", context: ownTask("sam"), effects, state: { latched: () => false, latch: () => {}, card: () => null, sawExternal: false, awaiting: false }, now: () => 0, nameOf: (e) => e });
    const spec = { name: "fixture_read", kind: "observation", label: "x", description: "x", parameters: {} } as unknown as ToolSpec;
    const thrown = async (effects: EffectBuffer, id: string, err: Error) => gate(effects).call(spec, id, {}, async () => { throw err; }).catch((e: unknown) => e);

    it("a keyed host refusal: one announce per refused call, and the error still reaches the model", async () => {
      const effects = new EffectBuffer();
      const err = new EgressRefusedError({ ok: false, code: "EGRESS_CRED_HOST_DENIED", reason: "x", host: "h.example", ref: "cred://w", label: "Weather" });
      expect(await thrown(effects, "c1", err)).toBe(err);
      await thrown(effects, "c2", new EgressRefusedError({ ok: false, code: "EGRESS_HOST_DENIED", reason: "x", host: "h.example", ref: "cred://w" }));
      expect(effects.drain()).toEqual([
        { kind: "deliver", id: "c1:announce", text: "Your Weather key is not bound to h.example, so nothing was sent there; only you can bind it." },
        { kind: "deliver", id: "c2:announce", text: "Your w key is not bound to h.example, so nothing was sent there; only you can bind it." },
      ]);
    });

    it("planted: a keyless host refusal, another code, and the plain error of the path before F59 say nothing", async () => {
      const effects = new EffectBuffer();
      await thrown(effects, "c1", new EgressRefusedError({ ok: false, code: "EGRESS_HOST_DENIED", reason: "x", host: "h.example" }));
      await thrown(effects, "c2", new EgressRefusedError({ ok: false, code: "EGRESS_CRED_UNKNOWN", reason: "x", host: "h.example", ref: "cred://w" }));
      await thrown(effects, "c3", new EgressRefusedError({ ok: false, code: "EGRESS_METHOD_DENIED", reason: "x", host: "h.example", ref: "cred://w" }));
      await thrown(effects, "c4", new Error("EGRESS_HOST_DENIED: h.example is not a listed host"));
      expect(effects.drain()).toEqual([]);
    });
  });
});
