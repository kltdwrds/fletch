// The chat's own halves of the Approvals ports (split from engine.ts at F15, which stood at the 600-line cap): a
// turn's tally of what its cards became, kept in the chat's meta, and the reply a colleague's request gets when its
// card is decided, carried back to the chat that asked.
import type { ApprovalPorts, Tally } from "./approvals.ts";
import type { TurnContext } from "./gate.ts";
import type { EngineHooks } from "./hooks.ts";
import type { ChatStore } from "./store.ts";

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
