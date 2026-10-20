// A hermetic world for inbound mail as fletch has it: the owner's real `PersonMail` over the object harness and
// real `ChatEngine` chats. qyvr-co's world ran a message through the platform (`qyvr-mail-in`, the dispatcher's
// seal and forward, the agent script's route); fletch has none of those, so a message is parsed by the agent's own
// MIME reader and handed to the owner's `PersonMail` as the agent script's inbound route handed it over.
import { sha256Hex } from "../../../packages/agent/src/attachments/caps.ts";
import { ChatEngine, type EngineCtx } from "../../../packages/agent/src/chat/engine.ts";
import { parseMime } from "../../../packages/agent/src/mail/mime.ts";
import { type MailOutService, PersonMail, type PersonMailDeps } from "../../../packages/agent/src/person/mail.ts";
import { harnessNamespace, ObjectHarness } from "../../support/object-harness.ts";
import people from "../../fixtures/people.json" with { type: "json" };

export const TENANT = "solo-sam";
export const ada = people.people.find((p) => p.id === "sam-solo")!;
export const T0 = Date.UTC(2026, 9, 13, 9, 0, 0);

/**
 * `mailOut` replaces the recording stand-in for outbound mail; `attachments` is each person's attachments store
 * as `objects/person.ts` wires it (M24.3).
 */
export function mailWorld(o: { mailOut?: MailOutService; attachments?: (email: string) => PersonMailDeps["attachments"] } = {}) {
  const clock = { now: T0 };
  const chats = harnessNamespace((name) => new ObjectHarness(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), {}, (c) => {
    c.now = () => clock.now;
  }));
  const sent: Array<Record<string, unknown>> = [];
  const owned = new Map<string, Set<string>>();
  const persons = new Map<string, ObjectHarness<PersonMail>>();
  const person = (email: string) => {
    let h = persons.get(email);
    if (!h) {
      const mine = owned.get(email) ?? new Set<string>();
      owned.set(email, mine);
      const name = people.people.find((p) => p.email === email)?.name;
      h = new ObjectHarness(email, (ctx) => new PersonMail((ctx as DurableObjectState).storage, {
        person: email, ...(name ? { name } : {}), now: () => clock.now,
        openChat: async () => {
          const chatId = `chat-${email.split("@")[0]}-${mine.size + 1}`;
          const claimed = chats.harness(chatId).instance.claim(email);
          if (!claimed.ok) return { ok: false, code: claimed.code };
          mine.add(chatId);
          return { ok: true, chatId };
        },
        ownsChat: (chatId) => mine.has(chatId),
        notify: async (chatId, n) => chats.harness(chatId).instance.notify(n),
        ...(o.attachments ? { attachments: o.attachments(email) } : {}),
        mailOut: o.mailOut ?? {
          send: async (input) => {
            sent.push(input);
            return { ok: true, messageId: `m-${sent.length}` };
          },
        },
      }), {});
      persons.set(email, h);
    }
    return h.instance;
  };
  /** One message for the owner, to their agent's address (`.agent.` in it) or their own. */
  const receive = async (to: string, from: string, raw: string) => {
    const bytes = new TextEncoder().encode(raw);
    const r = await person(ada.email).receive({ kind: to.includes(".agent.") ? "agent" : "person", from, digest: await sha256Hex(bytes), message: parseMime(bytes) });
    return r.ok ? { ok: true, code: r.duplicate ? "MAIL_DUPLICATE" : "MAIL_DELIVERED" } : { ok: false, code: r.code };
  };
  const notices = (email: string) => [...(owned.get(email) ?? [])].flatMap((id) => chats.harness(id).instance.notices().map((n) => ({ chat: id, ...n })));
  return { clock, chats, sent, person, owned, receive, notices };
}

export function message(o: { from: string; subject: string; body: string; extra?: string }): string {
  const [local, domain] = ada.email.split("@");
  return [`From: ${o.from}`, `To: ${ada.email}`, `Subject: ${o.subject}`, `Message-ID: <m1.${local}@${domain}>`, "Date: Tue, 13 Oct 2026 09:00:00 +0000", ...(o.extra ? [o.extra] : []), "", o.body, ""].join("\r\n");
}
