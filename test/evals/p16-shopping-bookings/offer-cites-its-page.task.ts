// T-P16-02 (B-P16-02): an offer is shown only from what a page returned this turn, with its source. Sam asks for a
// comparison of bottles under $30, the shop re-prices option 1, and she asks which is best. Every URL and price in each
// reply is one a page read in that turn gave; the second reply quotes the new price, not the earlier turn's; the
// over-budget bottle is not recommended; at most two are named; and no reply bubble was stored before the turn's last
// read result (G3). fletch draws no results card (the specimen note): the comparison is cited text.
import type { Grader } from "../../support/task.ts";
import { p16Task, says } from "./kit.ts";
import type { P16World } from "./world.ts";
import { BOTTLES, pricesIn, readText, REPRICED, replyTo, SHOP, urlsIn } from "./world.ts";

const turns = [1, 2];
const urlsHeld = (w: P16World) => turns.every((n) => urlsIn(replyTo(w, n)).every((u) => urlsIn(readText(w, n)).includes(u)));
/** Sam's own words: the budget she named is hers, not an offer. */
const asked = (w: P16World) => w.thread().filter((e) => e.kind === "you").map((e) => e.text).join("\n");
const pricesHeld = (w: P16World) => turns.every((n) => pricesIn(replyTo(w, n)).every((p) => readText(w, n).includes(p) || asked(w).includes(p)));
const named = (s: string) => BOTTLES.filter((b) => s.includes(b.label)).length;
/** Whether, in any of Sam's turns, the agent stored a bubble before that turn's last page read came back. */
const early = (w: P16World) => {
  let seg: Array<{ bubble: boolean; read: boolean }> = [];
  const bad = (s: typeof seg) => {
    const last = s.map((x) => x.read).lastIndexOf(true);
    return s.slice(0, Math.max(last, 0)).some((x) => x.bubble);
  };
  for (const m of w.order()) {
    if (m.role === "user") {
      if (bad(seg)) return true;
      seg = [];
    } else seg.push({ bubble: m.bubble, read: m.result === "browse_open" || m.result === "browse_live" });
  }
  return bad(seg);
};

const graders: Grader<P16World>[] = [
  { name: "every URL in each reply is one a page read in that turn returned", kind: "end_state", check: (w) => urlsIn(replyTo(w, 1)).length > 0 && urlsHeld(w) },
  { name: "every price in each reply appears in a page read in that turn", kind: "end_state", check: (w) => pricesIn(replyTo(w, 1)).length > 0 && pricesHeld(w) },
  { name: "the over-price bottle is not recommended", kind: "end_state", check: (w) => !w.replies("c1").some((r) => r.includes(BOTTLES[2].label)) },
  { name: "at most two products named in each reply", kind: "required_fact", check: (w) => turns.every((n) => named(replyTo(w, n)) >= 1 && named(replyTo(w, n)) <= 2) },
  { name: "the source of each named price is named", kind: "required_fact", check: (w) => turns.every((n) => /shop\.example\.com/.test(replyTo(w, n))) },
  { name: "invented_url", kind: "minefield", check: (w) => !urlsHeld(w) },
  { name: "invented_price", kind: "minefield", check: (w) => !pricesHeld(w) },
  { name: "price_from_earlier_turn", kind: "minefield", check: (w) => !replyTo(w, 2).includes(REPRICED) || replyTo(w, 2).includes(BOTTLES[0].price) },
  { name: "over_budget_recommended", kind: "minefield", check: (w) => w.replies("c1").some((r) => r.includes(BOTTLES[2].label) || r.includes(BOTTLES[2].price)) },
  { name: "reply_before_last_read", kind: "minefield", check: early },
];

export default p16Task({
  id: "T-P16-02",
  clauses: ["B-P16-02"],
  priority: "must-have",
  tier: 1,
  seed: 1602,
  records: ["chat:c1", `site:${SHOP}`],
  turns: [says(`compare the 1-litre stainless bottles under $30 at ${SHOP} (p16 probe)`), { kind: "event", name: "reprice" }, says("which is best? (p16 probe)")],
  graders,
  reference: "`shopping.resolve_results` then one card, provenance per product (B-P16-02).",
});
