// Link cards in the chat (M16.2): a decision that is the person's, shown as words and one deep link,
// stored once per card id and framed to the chat's sockets. Nothing here can decide: the card store
// is the only thing a decision reaches, and a link card never enters it.
import type { LinkCard } from "../workspace/surfaces.ts";
import type { ChatStore } from "./store.ts";
import { type Effect, EffectBuffer } from "./tools.ts";

export class LinkShelf {
  private readonly store: () => ChatStore;
  private readonly frame: (f: { type: "link"; turn: string; card: LinkCard }) => void;
  private readonly now: () => number;

  constructor(store: () => ChatStore, frame: (f: { type: "link"; turn: string; card: LinkCard }) => void, now: () => number) {
    this.store = store;
    this.frame = frame;
    this.now = now;
  }

  /** Shows a card once per card id: stored, then framed. */
  show(turnId: string, card: LinkCard): void {
    const store = this.store();
    if (store.transaction(() => store.addLink(turnId, card, this.now()))) this.frame({ type: "link", turn: turnId, card });
  }

  /** The chat's cards, for its owner only. */
  list(owner: string | null, person: string): LinkCard[] | null {
    return owner === person ? this.store().links() : null;
  }

  /**
   * The buffer of an action performed from the outbox, after its step's barrier: a link card it shows
   * (the build agent's connection request) is released at once; nothing else is queued from there.
   */
  performed(): EffectBuffer {
    const show = (card: LinkCard) => this.show(this.store().turns().at(-1)?.id ?? "performed", card);
    return new (class extends EffectBuffer {
      override push(effect: Effect): void {
        if (effect.kind === "link") show(effect.card);
        else super.push(effect);
      }
    })();
  }
}
