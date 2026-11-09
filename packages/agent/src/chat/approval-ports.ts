// The chat's own halves of the Approvals ports (split from engine.ts at F15, which stood at the 600-line cap): a
// turn's tally of what its cards became, kept in the chat's meta, the context a turn runs under, the reply a
// colleague's request gets when its card is decided, carried back to the chat that asked, and the words code says
// for a performed action (F59).
import type { ApprovalPorts, Tally } from "./approvals.ts";
import type { ChatFrame } from "./frames.ts";
import { ownTask, type TurnContext } from "./gate.ts";
import type { EngineHooks } from "./hooks.ts";
import type { ChatStore } from "./store.ts";

/** The context a turn was opened under, kept in the chat's meta; a turn without one is the person's own task. */
export function turnContext(store: ChatStore, turnId: string, person: string): TurnContext {
  const raw = store.meta(`context:${turnId}`);
  return raw ? (JSON.parse(raw) as TurnContext) : ownTask(person);
}

/** A turn's tally: how many of its cards were done, are pending and were refused. */
export function tallyOf(store: ChatStore, turnId: string): Tally {
  return { done: 0, pending: 0, refused: 0, ...JSON.parse(store.meta(`tally:${turnId}`) ?? "{}") };
}

/** Adds to a turn's tally in one transaction. */
export function addTally(store: ChatStore, turnId: string, add: Partial<Tally>): void {
  const t = tallyOf(store, turnId);
  store.transaction(() => store.setMeta(`tally:${turnId}`, JSON.stringify({ done: t.done + (add.done ?? 0), pending: t.pending + (add.pending ?? 0), refused: t.refused + (add.refused ?? 0) })));
}

/** Tells the colleague whose request opened the card's turn how it ended, in the chat that asked. */
export const replyToColleague =
  (store: ChatStore, hooks: EngineHooks, chatId: () => string): NonNullable<ApprovalPorts["reply"]> =>
  async (card, text) => {
    const to = JSON.parse(store.meta(`context:${card.turnId}`) ?? "null") as TurnContext | null;
    const target = to?.request?.replyTo;
    if (target && hooks.colleagues) await hooks.colleagues.deliverReply(target.chatId, { id: `colleague-update:${chatId()}:${card.id}`, source: `colleague:${card.descriptor.principal}`, text, person: target.person });
  };

/**
 * Words code wrote for the person about a performed action (F59), delivered as `flushOutbox` delivers a committed
 * `deliver` effect: an outbox row under the given id, so history draws them at their call, and the live frame.
 */
export const sayAnnounce =
  (store: ChatStore, broadcast: (frame: ChatFrame) => void, now: () => number): ApprovalPorts["say"] =>
  (turnId, id, text) => {
    store.transaction(() => {
      store.queue(turnId, { kind: "deliver", id, text });
      store.markDelivered(id, now());
    });
    broadcast({ type: "message", turn: turnId, id, text });
  };
