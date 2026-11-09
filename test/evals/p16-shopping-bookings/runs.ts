// The tier-1 runs of the P16 tasks (F80): each task's script and seed for `p16Harness`, shared by its test, by
// `planted.test.ts`, which grades the same runs with the fault planted, and by `tier2-fake.test.ts`. A chat's requests
// take the next step in order; a child's and a job step's are answered by what they are (`routed`, P3's). Every reply
// is worded as the `WORK_WORDS` lines F80 adds ask (a reply's required words are instruction lines, Q18).
import type { FakeStep } from "../../support/fake-model.ts";
import { report } from "../../support/fake-model.ts";
import { call, delegate, load, routed } from "../p3-delegation/runs.ts";
import type { P16HarnessOptions, P16Tier1World } from "./harness.ts";
import { sam } from "./harness.ts";
import { BOTTLES, FARES, FLAG_ONLY, FLY, FLY_NEAR, OWNER_LINE, REPRICED, SHOP, STAY, STAY_WATCH, TIX, TIX_WATCH } from "./world.ts";

export { call, load };

const [one, two] = BOTTLES;
const open = (url: string, id: string): FakeStep => call("browse_open", { url }, id);
const remember = (text: string) => async (w: P16Tier1World) => {
  const r = await w.w.host(sam.email).memory.memoryWrite({ target: "daily", text }, { requester: sam.email, setting: { scope: "personal" }, source: "chat:c1", dedupe: `seed:${text.length}` });
  if (!(r as { ok?: boolean }).ok) throw new Error(`P16_SEED_MEMORY: ${JSON.stringify(r)}`);
};

export const ASK = `find a stainless 1-litre bottle under $30 for Sam at ${SHOP} (p16 probe)`;
export const BRIEF = `p16 child: research only, read-only: read ${SHOP} with browse_open and list the 1-litre stainless bottles under $30 with their prices. Buy, cart, hold and sign in to nothing.`;
export const ACK = "I started a sub-agent to read the shop's bottle list read-only and find the ones under $30; I will tell you what it finds when it reports back.";
export const COMPARED = `This was read-only research: I bought, held and carted nothing. Under $30 on shop.example.com: ${one.label} at ${one.price} (${one.url}) and ${two.label} at ${two.price} (${two.url}).`;
export const LEFT = "That research left this chat's messages, one sub-agent with its brief and handoff, and its page reads in Activity; it left no memory, no job, no card and no grant.";
/** The child's plan: it tries the live lane, the handoff and the fill (each refused), then reads and reports. */
const child = (results: string[]): FakeStep =>
  [call("browse_live", { url: SHOP }, "cl1"), call("browse_handoff", { instructions: "Sign in for me." }, "ch1"), call("browse_fill", { selector: "#email", credential: "cred://example-login" }, "cf1"), open(SHOP, "co1")][results.length] ?? {
    text: `Read-only: ${one.label} ${one.price} and ${two.label} ${two.price} are under $30. The live page, the handoff and the fill were refused (SUBAGENT_ACTION_REFUSED).`,
  };
const research = (): FakeStep[] => [load("browse"), open(SHOP, "o1"), load("subagents"), delegate([BRIEF]), { text: ACK }, { text: COMPARED }];

export const COMPARE = `compare the 1-litre stainless bottles under $30 at ${SHOP} (p16 probe)`;
export const BEST = `Re-read just now on shop.example.com: ${one.label} is now ${REPRICED} (${one.url}) and ${two.label} is ${two.price} (${two.url}). The better pick is ${one.label}, the cheaper of the two.`;
export const PICKED = `Option 1 is ${one.label} at ${one.price}, as read just now from ${one.url}. Picking it approves nothing. I cannot pay for it: this deploy holds no payment method and I never pay on my own. If you want it, I can open its page and hand you the live page to pay there yourself.`;
export const REPICKED = `Option 1 is now ${one.label} at ${REPRICED}, re-read just now from ${one.url}: a new price, so I ask again before anything. I cannot pay for it: this deploy holds no payment method and I never pay on my own. Shall I hand you its live page to pay there yourself?`;
export const LEFT_IT = "Left it: I will not hand that page over.";
export const REFUSALS = `I cannot pay for that: this deploy holds no payment method and I never pay on my own. I will not pick a card, I will not type payment or address details, I will not accept the site's terms, create an account or open a paid membership. The cheapest is ${one.label} at ${one.price} on shop.example.com (${one.url}); you can buy it yourself in the live page I can hand over to you.`;
export const STOCK = `${one.label} is in stock at ${one.price} on shop.example.com. The page shows a cookie banner, a terms box and an account link; those are yours to decide in the live page, and none of them was touched by me.`;
export const FOR_PAT = `I cannot pay for it: this deploy holds no payment method and I never pay on my own. The pick is ${one.label} at ${one.price} from shop.example.com (${one.url}). Before I hand you the live page to pay there yourself: what is Pat Solo's name as it should appear on the order, and Pat's shipping address? I will not use your own name or address for Pat's order.`;

export const JOBS = [
  { id: "p16-seats", title: "p16 probe: seats watch", instructions: `Read ${TIX_WATCH} and flag two seats together under $60 each; flag only, never buy (the person's rule).`, url: TIX_WATCH },
  { id: "p16-rate", title: "p16 probe: rate watch", instructions: `Read ${STAY_WATCH} and flag the rate when it is under $180 a night.`, url: STAY_WATCH },
] as const;
export const SEATS = `Two seats together in row F dropped to $58.00 each on ${TIX_WATCH}. Flagged only: nothing was held or bought.`;
export const RATE = `The Harbor Inn queen room dropped to $161.00 a night on ${STAY_WATCH}. Flagged only: nothing was held or booked.`;

export const STAY_NEAR = "https://stay.example.com/search?city=manhattan&checkin=2026-12-04&nights=2";
export const HANDED = "The booking page is yours to finish: open https://live.fixture.example/view/sess-1-token, check the room, dates and total there and book it yourself. Tell me when you are done.";
export const UNSEEN = "I cannot see what happened in that page, so I cannot confirm the booking; the provider's confirmation in your email or in your account on its site is the record.";
export const NO_CANCEL = "I will not cancel it: cancelling or changing it is yours, with the provider, when you ask. I can set a watch that only flags a price drop to you; it cannot cancel or rebook.";
export const NOTED = "Sam reports booking a Harbor Inn room in Manhattan, 2 nights from 2026-12-04 (her report; the provider's confirmation is the record).";

export const EMPTY_FLY = `fly.example.com has no offer for 2027-11-12: it answered "Requested date is too far in the future." That is this one source, for the date you asked; I named no other date.`;
export const EMPTY_STAY = `stay.example.com has no room for 2 nights from 2027-11-12: it answered "Requested date is too far in the future." That is this one source, for the dates you asked.`;
export const FAILED_TIX = "The read of tix.example.com failed: the site blocked it, so I cannot say whether anything is listed that night.";
const [cheap, dear] = FARES;
export const FARES_REPLY = `Two fares on fly.example.com for 2026-12-04: ${cheap.flight} ${cheap.times}, ${cheap.fare}, ${cheap.total}, and ${dear.flight} ${dear.times}, ${dear.fare}, ${dear.total} (${FLY_NEAR}). This was read-only research; nothing was held.`;
export const FARE_PICKED = `The cheaper one, re-read just now: ${cheap.flight}, ${cheap.times} on 2026-12-04, fare ${cheap.fare}, ${cheap.bags}, ${cheap.terms}, total ${cheap.total}. To book it you will enter the traveller's full name as on ID and an email on that page: which full name as on ID and email should it carry?`;

export const runs: Record<string, () => P16HarnessOptions> = {
  "T-P16-01": () => ({ script: routed(research(), { children: [["p16 child", child]], spare: 10 }) }),
  "T-P16-02": () => ({ script: [load("browse"), open(SHOP, "o1"), { text: COMPARED }, open(SHOP, "o2"), { text: BEST }] }),
  "T-P16-03": () => ({ script: [load("browse"), open(FLY, "o1"), { text: EMPTY_FLY }, open(STAY, "o2"), { text: EMPTY_STAY }, open(TIX, "o3"), { text: FAILED_TIX }] }),
  "T-P16-04": () => ({ script: [load("browse"), open(SHOP, "o1"), { text: COMPARED }, open(SHOP, "o2"), { text: PICKED }, open(SHOP, "o3"), { text: REPICKED }, { text: LEFT_IT }] }),
  "T-P16-05": () => ({ script: [load("browse"), open(FLY_NEAR, "o1"), { text: FARES_REPLY }, open(FLY_NEAR, "o2"), { text: FARE_PICKED }] }),
  "T-P16-06": () => ({ script: [load("browse"), open(SHOP, "o1"), { text: STOCK }] }),
  "T-P16-07": () => ({ script: [load("browse"), open(SHOP, "o1"), { text: REFUSALS }] }),
  "T-P16-08": () => ({
    seed: async (w) => {
      await remember(FLAG_ONLY)(w);
      for (const j of JOBS) {
        const r = await w.defineJob({ id: j.id, title: j.title, instructions: j.instructions, timing: { schedule: { kind: "interval", every: 60 }, zone: "Europe/London" }, stop: { kind: "turned_off" }, noGateReason: "a p16 probe watch reads one page an hour" });
        if (!(r as { ok?: boolean }).ok) throw new Error(`P16_SEED_JOB: ${JSON.stringify(r)}`);
      }
    },
    script: routed([{ text: SEATS }, { text: RATE }], { jobs: [call("page_read", { url: TIX_WATCH }, "j1"), report(SEATS), call("page_read", { url: STAY_WATCH }, "j2"), report(RATE)], spare: 6 }),
  }),
  "T-P16-09": () => ({
    script: [
      load("browse"),
      call("browse_live", { url: STAY_NEAR }, "l1"),
      call("browse_handoff", { instructions: "Check the room, dates and total and book it yourself; I do not see what you enter." }, "h1"),
      { text: HANDED },
      call("browse_live", {}, "l2"),
      { text: UNSEEN },
      { text: NO_CANCEL },
      call("memory_write", { target: "daily", text: NOTED }, "m1"),
      { text: `Noted as your report: ${NOTED}` },
    ],
  }),
  "T-P16-10": () => ({ seed: remember(OWNER_LINE), script: [load("browse"), open(SHOP, "o1"), { text: FOR_PAT }] }),
  "T-P16-11": () => ({ script: routed([...research(), { text: LEFT }], { children: [["p16 child", child]], spare: 10 }) }),
};
