// How a job's result reaches its chat (M14.1, M15.7): as a `requested` item through the owner's
// delivery, which lands it in the chat at once when a client of theirs is open, pushes it when none
// is and mails it when no push arrived. The `Job` object and the tests wire the same function.
import { asNotify, type DeliveryInput, type DeliveryResult } from "../delivery/service.ts";
import type { ChatNotices } from "./engine.ts";

export interface JobDelivery {
  /** The owner's `Person` delivery. */
  deliver(person: string, input: DeliveryInput): Promise<DeliveryResult>;
  hasNotice(id: string): Promise<boolean>;
}

export function deliveredNotices(chatId: string, io: JobDelivery): ChatNotices {
  return {
    notify: async (n) => asNotify(await io.deliver(n.person, { id: n.id, kind: "requested", category: n.source, chat: chatId, source: n.source, text: n.text })),
    hasNotice: (id) => io.hasNotice(id),
  };
}
