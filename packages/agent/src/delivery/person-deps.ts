// How a `Person` object reaches what its delivery outbox needs (M14.1): its chats' clients and notices,
// the `Vault`'s push authorization, the push service, its own mail and the Ledger's journal. Kept out
// of `objects/person.ts`, which only constructs it.
import { getAgentByName } from "agents";
import type { PersonChats } from "../person/chats.ts";
import type { PersonMail } from "../person/mail.ts";
import { pushPost } from "../egress/outbound.ts";
import type { DeliveryDeps } from "./service.ts";

export interface PersonHost {
  env: Env;
  person: string;
  chats: () => PersonChats;
  mail: () => PersonMail;
  /** Replaces any pending flush with one at `at`. */
  armFlush: (at: number) => Promise<void>;
}

export function personDeliveryDeps(h: PersonHost): DeliveryDeps {
  const chat = async (id: string) => getAgentByName(h.env.CHAT, id);
  const vault = () => h.env.VAULT.get(h.env.VAULT.idFromName(h.env.TENANT_ID));
  return {
    person: h.person,
    now: () => Date.now(),
    connected: async () => (await Promise.all(h.chats().list().map(async (id) => (await chat(id)).hasClient(h.person)))).some(Boolean),
    notify: async (chatId, n) => (await chat(chatId)).notify(n),
    target: (chatId, kind) => h.chats().target(chatId, kind, Date.now()),
    authorize: (endpoint) => vault().pushAuthorization(endpoint),
    post: async (endpoint, init) => ({ status: (await pushPost(endpoint, init)).status }),
    mail: async (chatId, subject, text) => h.mail().send(h.person, { chatId, to: h.person, subject, text }),
    journal: async (row) => h.env.LEDGER.get(h.env.LEDGER.idFromName(h.env.TENANT_ID)).journal(row),
    arm: (at) => h.armFlush(at),
  };
}

/** The weekly review's drafts are an offer the person did not ask for: paced, and stoppable. */
export function skillDraftOffer(runId: string, n: number) {
  const text = `Your agent drafted ${n} skill${n > 1 ? "s" : ""} from this week's notes for you to review; none is used until you accept it.`;
  return { id: `offer:${runId}`, kind: "proactive" as const, category: "loop:skill-review", source: "loop:skill-review", text };
}
