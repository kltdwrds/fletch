// The tier-1 runs of the P12 tasks (F38): each task's script and seed for `p12Harness`, shared by its `.test.ts` and by
// `planted.test.ts`, which plays the same runs with the fault planted. A chat's requests take the next step in order;
// a child's, a verifier's and a job step's are answered by what they are (`routed`, P3's).
import type { FakeStep } from "../../support/fake-model.ts";
import { report } from "../../support/fake-model.ts";
import { call, delegate, load, routed } from "../p3-delegation/runs.ts";
import type { P12HarnessOptions } from "./harness.ts";
import { SHOP, sam } from "./harness.ts";
import { CARD, DEAD_SHOP } from "./world.ts";

export { call, load };

/** The Live View link the fake browser answers for its first session (T-P12-07). */
export const LIVE_FIRST = "https://live.fixture.example/view/sess-1-token";

/** The typed card's reply (`WORK_WORDS`' card line). */
export const CARD_REPLY = "I will not keep that card in our chat; this deploy holds no card, and when you buy something I can hand you the live page to pay there yourself.";
export const KEPT_REPLY = "I kept nothing of it: the three values you typed are held as references that expire unused within a day, and no memory or file holds them.";

/** `shop_buy` for the probe item at `amount` in `currency`, and the words beside it. */
export const buy = (amount: number, currency = "USD", id = "buy1", words = "That purchase waits for your decision on its card."): FakeStep => ({ toolCall: { id, name: "shop_buy", arguments: { item: "p12 probe", amount, currency } }, text: words });

/** The one-shot grant a card's `once` makes, with the cap written on it (T-P12-03). */
export const cappedOnce = { grantor: { kind: "person", id: sam.email }, grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "purchase" }, mode: "auto", constraints: { max_amount: { value: 12, currency: "USD" } }, one_shot: true, created_from: "approval-card" };

/** T-P12-09's last reply: what the turns left, named from the counts the tables hold. */
export const LEFT_REPLY = "That left our chat's messages (your card masked), the three typed values held as references, the one purchase card with its one-time grant and the one purchase that ran, the Ledger's identifier rows, and this chat's task rows. Nothing went to memory, a job or a file. The one leftover you could remove is the typed values, and they expire on their own within a day.";

/** The allowance refusal (`WORK_WORDS`' allowance line). */
export const ALLOWANCE_REPLY = "I cannot hold an allowance: each purchase is allowed once on its own card or declined, never for longer. The daily cap in Settings limits what I spend on the model, not money I can spend for you.";

/** The daily-cap reply (`WORK_WORDS`' daily-cap line, F43): the line's sentence, then the card. */
export const CAP_REPLY = "The daily cap under Settings is my own model spend, never money I may spend for you. Each purchase still waits for you on its own card, allowed once or declined.";

/** The wallet reply (`WORK_WORDS`' wallet line, F43): the line's sentence alone. */
export const WALLET_REPLY = "This deploy has no wallet and holds no payment method, so there is nothing to connect or list; when you buy something, I can hand you the live page to pay there yourself.";

/** The job that is asked to buy (T-P12-05): one run, today at 11:30 London time (10:30 UTC, after the world's clock). */
export const JOB = { id: "p12-probe-job", title: "p12 probe: restock", instructions: "Buy one p12 probe for 12 USD with shop_buy." };
export const CHILD_BRIEF = "p12 child: buy one p12 probe for 12 USD with shop_buy, then report.";
export const NOTHING_BOUGHT = "Nothing was bought: the job and the sub-agent were each refused when they tried, and only a turn here in your chat can propose a purchase for your card, which you then allow once or decline.";

export const runs: Record<string, () => P12HarnessOptions> = {
  "T-P12-01": () => ({ script: [{ text: CARD_REPLY }, { text: KEPT_REPLY }] }),
  "T-P12-02": () => ({ script: [buy(12), { text: "Done: the p12 probe purchase ran once, as you allowed." }] }),
  "T-P12-03": () => ({
    seed: async (w) => {
      const r = w.w.host(sam.email).authority.create(sam.email, cappedOnce);
      if (!r.ok) throw new Error(`P12_SEED_GRANT: ${r.code}`);
    },
    script: [buy(15, "USD", "b1"), buy(12, "EUR", "b2"), buy(12, "USD", "b3", "That runs under the one purchase you allowed."), buy(12, "USD", "b4")],
  }),
  "T-P12-04": () => ({ script: [{ text: ALLOWANCE_REPLY }, buy(12)] }),
  "T-P12-05": () => ({
    seed: async (w) => {
      const r = await w.defineJob({ ...JOB, timing: { schedule: { kind: "runonce", at: "2026-10-13T11:30" }, zone: "Europe/London" }, noGateReason: "a one-time p12 probe" });
      if (!(r as { ok?: boolean }).ok) throw new Error(`P12_SEED_JOB: ${JSON.stringify(r)}`);
    },
    script: routed(
      // The job's notice wakes a turn of the chat first; then Sam's two messages.
      [{ text: "Your p12 probe job could not buy anything: a job reads and reports." }, load("subagents"), delegate([CHILD_BRIEF]), { text: "I started a sub-agent on that; I will tell you what it finds when it reports back." }, { text: "The sub-agent could not buy it: a sub-agent observes and reports, and its purchase was refused." }, { text: NOTHING_BOUGHT }],
      {
        children: [["p12 child", (results) => (results.length === 0 ? call("shop_buy", { item: "p12 probe", amount: 12, currency: "USD" }, "cb1") : { text: `I could not buy it: ${/SUBAGENT_[A-Z_]+/.exec(results[0] ?? "")?.[0] ?? "refused"}; sub-agents observe and report.` })]],
        jobs: [call("shop_buy", { item: "p12 probe", amount: 12, currency: "USD" }, "jb1"), report("I could not buy the p12 probe: a scheduled job can read and report, but it cannot buy.")],
        spare: 8,
      },
    ),
  }),
  "T-P12-06": () => ({
    script: [
      buy(12, "USD", "b1"), { text: "You declined it, so it did not run." },
      buy(10, "USD", "b2"), { text: "Done: it ran once, as you allowed." },
      { text: "One purchase: the p12 probe for 10 USD, allowed once at 10:02 UTC. I keep no receipt here; the shop's confirmation is in your email." },
    ],
  }),
  "T-P12-07": () => ({
    script: [
      load("browse"),
      call("browse_live", { url: SHOP }, "live1"),
      call("browse_handoff", { instructions: "Enter your card and pay on this page; I do not see or keep what you type here." }, "hand1"),
      { text: `The checkout is yours to finish: open ${LIVE_FIRST}, enter your card and pay there. Tell me when you are done.` },
      call("browse_live", {}, "live2"),
      { text: "I cannot see the payment's outcome from here, so I will not say it happened. Look for the merchant's confirmation in your email or in your account on the shop's site." },
    ],
  }),
  "T-P12-08": () => ({
    script: [
      call("memory_write", { target: "daily", text: `Sam's card for shopping: ${CARD}.` }, "m1"),
      call("memory_write", { target: "daily", text: "Sam allows $20 a month for purchases (p12 probe)." }, "m2"),
      { text: "I did not keep your card number: memory never keeps a card number (MEMORY_VALUE_REFUSED). I noted the $20 a month line, but a note is not an allowance; each purchase still waits for you on its own card." },
      { text: "I kept no card number: memory refused it (MEMORY_VALUE_REFUSED), and this deploy holds no card at all. I do have a note that you mentioned $20 a month for purchases; it allows nothing." },
      buy(12, "USD", "b1"),
    ],
  }),
  "T-P12-09": () => ({
    // The Vault is opened before the count, so its own first-open rows (its migrations and indexes) are not the turns'.
    seed: async (w) => void w.secrets(),
    script: [
      { text: CARD_REPLY },
      { text: KEPT_REPLY },
      buy(12, "USD", "b1"),
      { text: "Done: the p12 probe purchase ran once, as you allowed." },
      { text: ALLOWANCE_REPLY },
      { text: LEFT_REPLY },
    ],
  }),
  "T-P12-10": () => ({
    script: [
      load("browse"),
      call("browse_open", { url: `https://${DEAD_SHOP}` }, "open1"),
      { text: `I cannot pay for it: ${DEAD_SHOP} did not resolve, and this deploy holds no payment method, so I never pay on my own. I did not look for another seller. If the shop is reachable later, I can open its checkout and hand you the live page, where you pay yourself.` },
    ],
  }),
  "T-P12-11": () => ({ script: [{ text: CARD_REPLY }] }),
  "T-P12-12": () => ({
    script: [
      { text: ALLOWANCE_REPLY },
      { text: CAP_REPLY },
    ],
  }),
};
