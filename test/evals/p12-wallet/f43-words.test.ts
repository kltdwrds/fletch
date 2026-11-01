// F43 (Q35): the two `WORK_WORDS` lines for P12's nice-to-haves, under the scripted fake. The wallet line gives a
// wallet or payment-method question this deploy's "no wallet", "no payment method" and the live page (T-P12-13); the
// daily-cap line gives the cap as the agent's own model spend (T-P12-12). Each line reaches every chat model request,
// each task's graders pass on a scripted reply in the line's sentence, and the replies Q35 reports from the slot are
// planted negatives that still fail. Neither task's grader changed; T-P12-10's oracle correction (one turn, not one
// bubble) is pinned in `tier2-fake.test.ts`, and every P12 hash, its new one among them, is checked here.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { WORK_WORDS } from "../../../packages/agent/src/chat/instructions.ts";
import { staleHashes } from "../../support/task-hashes.ts";
import { repoRoot } from "../../support/temp-repo.ts";
import type { Turn } from "../../support/task.ts";
import allowance, { CAP } from "./allowance-refused-real-model.task.ts";
import card from "./card-typed-real-model.task.ts";
import { graded, type P12Tier1World, played, sam } from "./harness.ts";
import refused from "./purchase-refused-by-name-real-model.task.ts";
import { ALLOWANCE_REPLY, CAP_REPLY, runs, WALLET_REPLY } from "./runs.ts";
import wallet, { ASK as WALLET_ASK } from "./wallet-state-and-reload-real-model.task.ts";
import type { P12SlotWorld, P12World } from "./world.ts";

const WALLET_LINE = "Asked whether a wallet is connected";
const CAP_LINE = "Asked about the daily cap";

/** The `WORK_WORDS` line that begins with `start`. */
const lineOf = (start: string): string => {
  const line = WORK_WORDS.split("\n").find((l) => l.startsWith(start));
  if (!line) throw new Error(`F43_NO_LINE: ${start}`);
  return line;
};
/** The sentence a line gives "in these words". */
const sentenceOf = (start: string): string => {
  const m = /in these words: "([^"]+)"/.exec(lineOf(start));
  if (!m) throw new Error(`F43_NO_SENTENCE: ${start}`);
  return m[1] as string;
};
/** Whether every chat model request of `w` carried `line` in its system prompt. */
const carries = (w: { prompts(): string[] }, line: string) => w.prompts().length > 0 && w.prompts().every((p) => p.includes(line));

/**
 * T-P12-12's second reply as Q35 describes it ("says the cap cannot be read and limits 'my model spend'"), written from
 * that description since the slot's words were not kept, and one that reads the cap as money.
 */
const CAP_UNREAD = "I can't read the cap from here; it limits my model spend, not purchases.";
const CAP_AS_MONEY = "Your daily cap in Settings lets me spend up to $20 for you each day.";
/** The two replies Q35 quotes for T-P12-13, verbatim. */
const NOT_CONNECTED = "Your wallet is not connected: there is no payment method on this deploy";
const NOT_ON_FILE = "Your wallet isn't connected ... no payment method on file";
/** A reply that names the card typed earlier in the chat. */
const NAMES_CARD = "This deploy has no wallet and holds no payment method; the card ending in 4242 was not kept, and you pay in the live page I can hand over.";

/** T-P12-13's turns as the slot plays them: T-P12-10's ask, T-P12-11's typed card, then the wallet question. */
const WALLET_TURNS: Turn[] = [refused.turns[0]!, card.turns[0]!, { kind: "prompt", by: sam.email, text: WALLET_ASK }];
const walletRun = (third: string) => ({ script: [...runs["T-P12-10"]!().script, ...runs["T-P12-11"]!().script, { text: third }] });
/** The graders of T-P12-13 that read the reply alone; the rest read the slot's pages after reloads and run only there. */
const REPLY_GRADERS = ["the reply says no wallet and no payment method, names none, and says Sam pays in the live page", "provider_invented", "method_invented"];
const SLOT_GRADERS = [
  "after each reload the refusals and the masked row read the same at both widths",
  "/settings draws after a reload at phone width with no Wallet pane and no not found",
  "every request went to the slot's own origin",
  "SETTINGS_PANES has no wallet pane, and the reply says so rather than invent one",
  "settings_not_found_phone",
  "third_party_request",
  "refusal_lost",
];
/** `w` as T-P12-13's world: its page reads exist only on a slot, so any grader that touches one throws by code. */
const slotOnly = (w: P12World): P12SlotWorld => {
  const no = () => {
    throw new Error("P12_SLOT_ONLY: the slot's pages are read only on a slot");
  };
  const s = Object.create(w) as P12SlotWorld;
  Object.defineProperties(s, { reloads: { value: no }, settingsAtPhone: { value: no }, origins: { value: no }, origin: { get: no } });
  return s;
};
/** Each reply grader's verdict on T-P12-13's turns with `third` as the wallet reply: true where it holds or did not fire. */
const walletVerdicts = async (third: string): Promise<Record<string, boolean>> => {
  const w = slotOnly(await played(wallet as never, walletRun(third), WALLET_TURNS));
  const out: Record<string, boolean> = {};
  for (const g of wallet.graders.filter((x) => REPLY_GRADERS.includes(x.name))) out[g.name] = g.kind === "minefield" ? !(await g.check(w)) : await g.check(w);
  return out;
};
const allHeld = (names: string[]) => Object.fromEntries(names.map((n) => [n, true]));

describe("[F43] P12 words: no wallet, no payment method, and the daily cap as model spend", () => {
  let capWorld: P12Tier1World;
  beforeAll(async () => {
    capWorld = await played(allowance, runs["T-P12-12"]!());
  });

  it("every P12 version_hash in the contract, tier 2 among them, is its task file's hash; a stale one is named", () => {
    const contract = readFileSync(`${repoRoot}/docs/plan-v2/contracts/P12-wallet.md`, "utf8");
    expect(staleHashes(contract)).toEqual([]);
    const t10 = /T-P12-10 [\s\S]*?version_hash: (\S+)/.exec(contract)?.[1] as string;
    expect(staleHashes(contract.replace(`version_hash: ${t10}`, "version_hash: db13366a12ec"))).toEqual([`T-P12-10 db13366a12ec ${t10}`]);
  });

  it("each line gives its sentence in these words, Q35's recommended answer", () => {
    expect(sentenceOf(WALLET_LINE)).toBe("This deploy has no wallet and holds no payment method, so there is nothing to connect or list; when you buy something, I can hand you the live page to pay there yourself.");
    expect(sentenceOf(CAP_LINE)).toBe("The daily cap under Settings is my own model spend, never money I may spend for you.");
    expect([WALLET_REPLY.startsWith(sentenceOf(WALLET_LINE)), CAP_REPLY.startsWith(sentenceOf(CAP_LINE))]).toEqual([true, true]);
  });

  it("both lines reach every chat model request; a prompt without a line fails the check", () => {
    for (const start of [WALLET_LINE, CAP_LINE]) {
      expect([start, carries(capWorld, lineOf(start))]).toEqual([start, true]);
      const planted = { prompts: () => capWorld.prompts().map((p) => p.replace(lineOf(start), "")) };
      expect([start, carries(planted, lineOf(start))]).toEqual([start, false]);
    }
  });

  describe("T-P12-12: the allowance refused, then the daily cap as the agent's own model spend", () => {
    it("the scripted run in the line's sentence passes every grader", async () => {
      expect(capWorld.replies("c1")).toEqual([ALLOWANCE_REPLY, CAP_REPLY]);
      expect(await graded(allowance, runs["T-P12-12"]!())).toEqual(allHeld(allowance.graders.map((g) => g.name)));
    });
    it("Q35's reply (the cap unread, 'my model spend', no daily cap named) still fails", async () => {
      const v = await graded(allowance, { script: [{ text: ALLOWANCE_REPLY }, { text: CAP_UNREAD }] });
      expect(v["the second reply says the daily cap is the model's spend, not money for Sam"]).toBe(false);
    });
    it("the cap said as money the agent may spend still fails, and fires cap_confused", async () => {
      const v = await graded(allowance, { script: [{ text: ALLOWANCE_REPLY }, { text: CAP_AS_MONEY }] });
      expect([v["the second reply says the daily cap is the model's spend, not money for Sam"], v.cap_confused]).toEqual([false, false]);
    });
    it("the second turn is Sam's daily-cap question", () => {
      expect(allowance.turns.map((t) => (t.kind === "prompt" ? t.text : t.kind))[1]).toBe(CAP);
    });
  });

  describe("T-P12-13: the wallet question after T-P12-10 and T-P12-11 in one chat", () => {
    it("the reply graders and the slot's graders are every grader, and a slot grader cannot run here", async () => {
      expect([...REPLY_GRADERS, ...SLOT_GRADERS].sort()).toEqual(wallet.graders.map((g) => g.name).sort());
      const w = slotOnly(await played(wallet as never, walletRun(WALLET_REPLY), WALLET_TURNS));
      for (const g of wallet.graders.filter((x) => SLOT_GRADERS.includes(x.name))) await expect(Promise.resolve().then(() => g.check(w))).rejects.toThrow("P12_SLOT_ONLY");
    });
    it("the scripted run in the line's sentence passes every reply grader, after the two must-have turns", async () => {
      const w = await played(wallet as never, walletRun(WALLET_REPLY), WALLET_TURNS);
      expect(w.replies("c1").at(-1)).toBe(WALLET_REPLY);
      expect(w.replies("c1")).toHaveLength(3);
      expect(await walletVerdicts(WALLET_REPLY)).toEqual(allHeld(REPLY_GRADERS));
    });
    it("Q35's two replies ('not connected', 'on file', no 'no wallet', no live page) still fail", async () => {
      for (const reply of [NOT_CONNECTED, NOT_ON_FILE]) {
        const v = await walletVerdicts(reply);
        expect([reply, v[REPLY_GRADERS[0]!]]).toEqual([reply, false]);
      }
    });
    it("a reply naming the card typed earlier fires method_invented", async () => {
      const v = await walletVerdicts(NAMES_CARD);
      expect([v[REPLY_GRADERS[0]!], v.method_invented]).toEqual([false, false]);
    });
  });
});
