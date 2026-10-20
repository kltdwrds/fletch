// Proactivity (B16, B17), deterministic, with the two-member fixtures. B16: over a week of the agent's
// offers, Ada's "not now" on two of them stops nothing, her "stop these" stops the rest, and Bo's offers
// of the same kind keep arriving. B17: thirty results Ada asked for, at seeded hours including the night,
// each arrives at once in the chat it belongs to, a seeded third of them is sent again and shows nothing
// twice, and the night's offer waits for her morning. The collateral check holds every journal row,
// delivery row and the Vault's key row to what the turns declare.
import { describe } from "vitest";
import { expect } from "vitest";
import { defineScenario, type Snapshot } from "../../support/scenario.ts";
import { ada, deliveryWorld, } from "../../workers/support/delivery-world.ts";

type World = ReturnType<typeof deliveryWorld> & { snapshot(): Promise<Snapshot>; marks: { rejected: number[]; stopDay: number; hours: number[]; resent: number[] } };

const DAY = 86_400_000;
const offerOn = (day: number) => ({ id: `offer:d${day}`, kind: "proactive" as const, category: "loop:skill-review", source: "loop:skill-review", text: `Day ${day}: your agent drafted a skill from this week's notes.` });

async function world(): Promise<World> {
  const w = deliveryWorld();
  const snapshot = async (): Promise<Snapshot> => {
    const rows = [ada.email].flatMap((p) => {
      try {
        return (w.personDb(p).prepare("SELECT id FROM delivery_items").all() as Array<{ id: string }>).map((r) => `delivery:${p}:${r.id}`);
      } catch {
        return [];
      }
    });
    let vault: string[] = [];
    try {
      vault = (w.vaultDb.prepare("SELECT id FROM vapid_key").all() as Array<{ id: number }>).map((r) => `vapid_key:${r.id}`);
    } catch {}
    return { journal: [...(await w.ledger().journalRows()).map((r) => `journal:${r.id}`), ...rows], vault, r2: [] };
  };
  return Object.assign(w, { snapshot, marks: { rejected: [], stopDay: 0, hours: [], resent: [] } });
}

describe("[M14.1] proactivity", () => {

  defineScenario<World>({
    id: "S-B17-requested-arrives-once",
    clauses: ["B17"],
    seed: 1417,
    async setup(rng) {
      const w = await world();
      w.marks.hours = Array.from({ length: 30 }, () => rng.int(0, 23));
      w.marks.resent = rng.distinct(10, 0, 29);
      w.openChat(ada.email);
      w.openChat(ada.email);
      await w.http(ada.email, "POST", "/push/subscribe", { subscription: (await w.push.browser()).subscription });
      return w;
    },
    async turns(w) {
      const [first, second] = w.owned.get(ada.email) as [string, string];
      const base = Date.UTC(2026, 9, 13);
      for (let i = 0; i < 30; i++) {
        w.clock.now = base + i * DAY + w.marks.hours[i]! * 3_600_000;
        const r = { id: `hn-watch:notice:${i}`, kind: "requested" as const, category: "job:hn-watch", chat: i % 2 ? second : first, source: "job:hn-watch", text: `Edition ${i}.` };
        await w.deliver(ada.email, r);
        if (w.marks.resent.includes(i)) await w.deliver(ada.email, r);
      }
      // One offer of the agent's own, at 02:00 on the last day: it waits for her morning.
      w.clock.now = base + 30 * DAY + 2 * 3_600_000;
      await w.deliver(ada.email, offerOn(30));
    },
    endState(w) {
      const [first, second] = w.owned.get(ada.email) as [string, string];
      const byChat = (c: string) => w.notices(ada.email).filter((n) => n.chat === c).map((n) => Number(n.id.split(":")[2]));
      expect(byChat(first)).toEqual(Array.from({ length: 15 }, (_, k) => 2 * k));
      expect(byChat(second)).toEqual(Array.from({ length: 15 }, (_, k) => 2 * k + 1));
      expect(w.push.delivered()).toHaveLength(30);
      expect(w.flushAt.get(ada.email)).toBe(Date.UTC(2026, 9, 13) + 30 * DAY + 8 * 3_600_000);
    },
    minefields: [
      { name: "a requested result was held", happened: (w) => (w.personDb(ada.email).prepare("SELECT COUNT(*) AS n FROM delivery_items WHERE kind = 'requested' AND state != 'delivered'").get() as { n: number }).n > 0 },
      { name: "a result shown twice", happened: (w) => new Set(w.notices(ada.email).map((n) => n.id)).size !== w.notices(ada.email).length },
      { name: "a result pushed twice", happened: (w) => new Set(w.push.delivered().map((r) => JSON.stringify(r.payload))).size !== w.push.delivered().length },
      { name: "the night's offer shown at night", happened: (w) => w.notices(ada.email).some((n) => n.id === "offer:d30") },
      { name: "mail sent while push delivered", happened: (w) => w.mail.length > 0 },
    ],
    declared: () => ({
      journal: [...Array.from({ length: 30 }, (_, i) => `delivery:${ada.email}:hn-watch:notice:${i}`), `delivery:${ada.email}:offer:d30`],
      vault: ["vapid_key:1"],
    }),
  });
});
