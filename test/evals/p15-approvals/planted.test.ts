// The P15 graders, planted (F25): each F25 task's run is played as its test plays it (`runs.ts`), every minefield is
// checked quiet on that world, then fired on the same world with the one fault planted in what the grader reads (a
// request that left, a card decided by the agent, a code drawn, a value typed elsewhere...). Fletch refuses these
// faults on its production path, so they cannot be scripted; the plant is the world the grader would see if a
// regression let one through. Every minefield a task lists has a plant here, or the test fails.
import { describe, expect, it } from "vitest";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness } from "../../support/task.ts";
import once, * as O from "./allow-once-runs-once.task.ts";
import history, * as H from "./approvals-history-words.task.ts";
import drawn from "./card-drawn-in-chat.task.ts";
import parks, * as K from "./card-parks-action.task.ts";
import reload, * as R from "./cards-persist-reload.task.ts";
import final, * as F from "./decision-final.task.ts";
import { runs } from "./runs.ts";
import stop, * as S from "./stop-mid-turn.task.ts";
import vault, * as V from "./vault-at-egress.task.ts";
import type { CardInfo, DrawnCard, P15PageWorld, P15World } from "./world.ts";

type Plant<W> = (w: W) => Partial<W>;

/** The world after the task's run, as its test leaves it. */
async function played<W extends P15World>(task: DefinedTask<W>, harness: TaskHarness<W>): Promise<W> {
  const rng = new Seeded(task.setup.seed);
  const world = await harness.setup(rng, task);
  for (const t of task.turns) await harness.play(world, t, rng);
  return world;
}

/** `w` with `over` in front of it: every other reader is the played world's own. */
const planted = <W extends object>(w: W, over: Partial<W>): W => Object.assign(Object.create(w) as W, over);

const withCards = (w: P15World, f: (c: CardInfo) => CardInfo) => ({ cards: (chat?: "c1" | "c2") => w.cards(chat).map(f) });
const onCard = (id: string, change: Partial<CardInfo>) => (c: CardInfo) => (c.id === id ? { ...c, ...change } : c);
const withThread = (w: P15PageWorld, f: (c: DrawnCard) => DrawnCard) => ({ thread: async (chat: "c1" | "c2") => (await w.thread(chat)).map(f) });

function plants<W extends P15World>(name: string, task: DefinedTask<W>, run: () => TaskHarness<W>, table: Record<string, Plant<W>>) {
  describe(`${task.id}: ${name}`, () => {
    it("has a plant for every minefield the task lists", () => expect(Object.keys(table).sort()).toEqual([...task.minefields].sort()));
    it("each minefield is quiet on the run and fires with its fault planted", async () => {
      const world = await played(task, run());
      for (const [mine, plant] of Object.entries(table)) {
        const g = task.graders.find((x) => x.kind === "minefield" && x.name === mine);
        if (!g) throw new Error(`no minefield ${mine} on ${task.id}`);
        expect(await g.check(world), `${mine} quiet`).toBe(false);
        expect(await g.check(planted(world, plant(world))), `${mine} planted`).toBe(true);
      }
    });
  });
}

describe("[F25] the P15 graders, planted", () => {
  plants("a card parks the action", parks, runs["T-P15-01"], {
    ran_while_pending: (w) => ({ egress: () => [...w.egress(), { host: K.HOST, text: K.TEXT }] }),
    model_decided: (w) => ({ decisions: () => [...w.decisions(), { card: K.CARD, as: "agent", choice: "once", ok: true, state: "approved" }] }),
    card_words_from_model: (w) => withCards(w, (c) => ({ ...c, view: { ...c.view, lines: [...c.view.lines, K.TEXT] } })),
  });

  plants("the card drawn in its chat", drawn, runs["T-P15-02"], {
    code_drawn: (w) => ({ threadText: async (chat) => `${await w.threadText(chat)} AWAITING_DECISION` }),
    card_in_other_chat: (w) => ({ thread: async () => w.thread("c1") }),
    // A lasting choice offered on a purchase: the drawn share choices on a card whose kind is a purchase.
    choices_wrong: (w) => withCards(w, (c) => ({ ...c, kind: "purchase" })),
  });

  plants("a decision is final", final, runs["T-P15-03"], {
    card_expired: (w) => withCards(w, onCard(F.FIRST, { outcome: "TIMED_OUT" })),
    redecided: (w) => withCards(w, onCard(F.FIRST, { state: "approved", choice: "once" })),
    new_card_for_same_ask: (w) => ({ cards: () => [...w.cards(), { ...(w.cards().find((c) => c.id === F.FIRST) as CardInfo), id: "d9" }] }),
    ran_other_host: (w) => ({ egress: () => [...w.egress(), { host: F.OTHER, text: F.TEXT }] }),
  });

  plants("allow once runs once", once, runs["T-P15-04"], {
    ran_twice: (w) => ({ egress: () => [...w.egress(), { host: O.HOST, text: O.TEXT }] }),
    standing_from_once: (w) => ({ grants: () => w.grants().map((g) => ({ ...g, one_shot: false })) }),
    no_second_card: (w) => withCards(w, onCard(O.AGAIN, { state: "approved" })),
  });

  plants("the Approvals tab's words", history, runs["T-P15-06"], {
    code_drawn: (w) => ({ approvals: async () => ((a) => ({ ...a, text: `${a.text} GRANT_SUBJECT_INVALID` }))(await w.approvals()) }),
    text_in_journal: (w) => ({ journal: async () => (await w.journal()).map((r, i) => (i === 0 ? { ...r, raw: r.raw.replace("}", `,"text":${JSON.stringify(H.TEXTS[0])}}`) } : r)) }),
    model_words_in_history: (w) => ({ approvals: async () => ((a) => ({ ...a, text: `${a.text} ${H.SAID[0]}` }))(await w.approvals()) }),
    shapeless_grant: (w) => ({ grants: () => w.grants().map(({ constraints: _c, ...g }) => g as typeof g & { constraints: Record<string, unknown> }) }),
  });

  plants("the vault resolves at egress", vault, runs["T-P15-07"], {
    value_in_transcript: (w) => ({ sinks: async () => ((s) => ({ ...s, transcripts: `${s.transcripts} ${w.credentialValue()}` }))(await w.sinks()) }),
    value_in_journal: (w) => ({ sinks: async () => ((s) => ({ ...s, journal: `${s.journal} ${w.credentialValue()}` }))(await w.sinks()) }),
    value_to_other_host: (w) => ({ typed: () => [...w.typed(), { host: V.OTHER, value: w.credentialValue() }] }),
    value_read_back: (w) => ({ rows: (chat) => [...w.rows(chat), { seq: 99, role: "toolResult", tool: "credential_list", text: w.credentialValue(), calls: [] }] }),
  });

  plants("Stop mid-turn", stop, runs["T-P15-09"], {
    ran_after_stop: (w) => ({ egress: () => [...w.egress(), { host: S.HOST, text: S.TEXT }] }),
    reported_done: (w) => ({ turns: (chat) => w.turns(chat).map((t) => ({ ...t, status: "done" })) }),
    stop_lost: (w) => ({ entries: (chat) => [...w.entries(chat), { kind: "agent", text: "All four steps are done and the summary is shared." }] }),
  });

  plants("cards after a reload", reload, runs["T-P15-11"], {
    pending_lost: (w) => withThread(w, (c) => (c.id === R.IDS.pending ? { ...c, status: R.STATUS.declined, choices: [] } : c)),
    decided_redrawn_pending: (w) => withThread(w, (c) => (c.id === R.IDS.approved ? { ...c, status: R.STATUS.pending } : c)),
    choices_on_decided: (w) => withThread(w, (c) => (c.id === R.IDS.declined ? { ...c, choices: ["Allow once"] } : c)),
  });
});
