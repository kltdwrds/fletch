// A hermetic world for M14.1's delivery: Ada's and Bo's real `PersonDelivery` over the object harness,
// real `ChatEngine` chats, the real `VaultCore` holding the tenant's VAPID key (with the dispatcher's
// real key service as KEYS), the real `Ledger` taking journal rows, a fake push service that checks
// VAPID and decrypts (`push-service.ts`), and recorded mail. A person's client is "connected" while a
// socket the world opened on one of their chats is open, as `Chat.hasClient` answers from its sockets.
import { ChatEngine, type EngineCtx } from "../../../packages/agent/src/chat/engine.ts";
import { type DeliveryCall, type DeliveryInput, PersonDelivery, runCall } from "../../../packages/agent/src/delivery/service.ts";
import { route, type Directory } from "../../../packages/agent/src/http/routes.ts";
import { Ledger } from "../../../packages/agent/src/objects/ledger.ts";
import { type ChatKind, PersonChats } from "../../../packages/agent/src/person/chats.ts";
import { VaultCore } from "../../../packages/agent/src/vault/core.ts";
import { harnessNamespace, ObjectHarness } from "../../support/object-harness.ts";
import people from "../../fixtures/people.json" with { type: "json" };
import { fakePushService } from "./push-service.ts";
import { keysFor, testMasterKey } from "./vault-harness.ts";

export const TENANT = "solo-sam";
export const ada = people.people.find((p) => p.id === "sam-solo")!;
/** Tuesday 13 October 2026, 10:00 UTC: inside waking hours in UTC. */
export const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);
export const HOST = "https://solo-sam.qyvr-staging.dev";

export function deliveryWorld(o: { vaultLocked?: boolean } = {}) {
  const clock = { now: T0 };
  const env = { TENANT_ID: TENANT, TENANT_SHAPE: "company", QYVR_ENV: "test" };
  const chats = harnessNamespace((name) => new ObjectHarness(name, (ctx, e) => new ChatEngine(ctx as EngineCtx, e as Env), {}, (c) => {
    c.now = () => clock.now;
  }));
  const ledgerH = new ObjectHarness("ledger", (ctx, e) => new Ledger(ctx as DurableObjectState, e as Env), env, (l) => {
    l.now = () => clock.now;
  });
  const keys = keysFor(TENANT, testMasterKey());
  const lockedKeys = { wrap: async () => ({ ok: false as const, code: "KEYS_UNAVAILABLE", reason: "test" }), unwrap: async () => ({ ok: false as const, code: "KEYS_UNAVAILABLE", reason: "test" }) };
  const vaultH = new ObjectHarness("vault", (ctx) => new VaultCore(ctx as never, { tenant: TENANT, keys: (o.vaultLocked ? lockedKeys : keys) as never, fetch: async () => new Response(null, { status: 599 }), now: () => clock.now }), {});
  const push = fakePushService(clock);
  const mail: Array<{ person: string; chat: string; subject: string; text: string }> = [];
  const mailFailures: string[] = [];
  const owned = new Map<string, string[]>();
  const clients = new Set<string>();
  const flushAt = new Map<string, number>();
  /** Every endpoint the Vault was asked to sign for. */
  const signed: string[] = [];
  const persons = new Map<string, ObjectHarness<PersonDelivery>>();

  /** Each person's real chat list (M14.2), where delivery finds its target: their first chat is the main one. */
  const chatLists = new Map<string, ObjectHarness<PersonChats>>();
  const chatList = (email: string) => {
    let h = chatLists.get(email);
    if (!h) {
      h = new ObjectHarness(`chats-${email}`, (ctx) => new PersonChats((ctx as DurableObjectState).storage, email, async (id, p) => chats.harness(id).instance.claim(p)), {});
      chatLists.set(email, h);
    }
    return h;
  };
  const openChat = (email: string, kind: ChatKind = "side"): string => {
    const mine = owned.get(email) ?? [];
    owned.set(email, mine);
    const id = `chat-${email.split("@")[0]}-${mine.length + 1}`;
    const c = chats.harness(id).instance.claim(email);
    if (!c.ok) throw new Error(c.code);
    const list = chatList(email);
    list.instance.entries();
    list.db.prepare("INSERT INTO chats (id, opened_at, kind, title) VALUES (?, ?, ?, ?)").run(id, clock.now + mine.length, mine.length === 0 ? "main" : kind, kind);
    mine.push(id);
    return id;
  };

  const harness = (email: string) => {
    let h = persons.get(email);
    if (!h) {
      h = new ObjectHarness(`person-${email}`, (ctx) => new PersonDelivery((ctx as DurableObjectState).storage, {
        person: email,
        now: () => clock.now,
        connected: async () => (owned.get(email) ?? []).some((id) => clients.has(id)),
        notify: async (chatId, n) => chats.harness(chatId).instance.notify(n),
        target: async (chat, kind) => {
          if (!owned.get(email)?.length) openChat(email);
          return chatList(email).instance.target(chat, kind, clock.now);
        },
        authorize: (endpoint) => {
          signed.push(endpoint);
          return vaultH.instance.vapid.authorization(endpoint);
        },
        post: (endpoint, init) => push.post(endpoint, init),
        mail: async (chatId, subject, text) => {
          // A queued failure code answers the next send instead (M15.2's retries).
          const failure = mailFailures.shift();
          if (failure) return { ok: false, code: failure, reason: "the mail service refused it" };
          mail.push({ person: email, chat: chatId, subject, text });
          return { ok: true };
        },
        journal: (row) => ledgerH.instance.journal(row),
        arm: async (at) => {
          flushAt.set(email, at);
        },
      }), {});
      persons.set(email, h);
    }
    return h;
  };
  const person = (email: string) => harness(email).instance;

  /** The app's routes for the signed-in person, with only the delivery directory wired. */
  const dir = {
    person: () => ({ openChat: async () => ({ ok: false, code: "UNUSED" }), ownsChat: async () => false }),
    company: () => ({ lookup: async () => null, list: async () => [], invite: async () => ({ ok: false, code: "NOT_AN_ADMIN" }) }),
    chat: () => ({ fetch: async () => new Response(null, { status: 404 }) }),
    ledger: () => ({ modelCalls: async () => [] }),
    delivery: { pushKey: () => vaultH.instance.vapid.publicKey(), call: (p: string, call: DeliveryCall) => runCall(person(p), p, call) },
  } as unknown as Directory;
  const http = (as: string, method: string, path: string, body?: unknown, origin: string | null = HOST) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...(origin ? { origin } : {}) };
    return route(new Request(`${HOST}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env as never, { tenant: TENANT, person: as }, dir);
  };

  return {
    clock,
    chats,
    push,
    mail,
    mailFailures,
    owned,
    flushAt,
    signed,
    ledger: () => ledgerH.instance,
    vault: () => vaultH.instance,
    vaultDb: vaultH.db,
    personDb: (email: string) => harness(email).db,
    person,
    http,
    openChat,
    chatList: (email: string) => chatList(email).instance,
    personChatsDb: (email: string) => chatList(email).db,
    /** A client of the person's open on one chat (the app in the foreground). */
    connect: (chatId: string) => {
      chats.harness(chatId).connect();
      clients.add(chatId);
    },
    disconnect: (chatId: string) => clients.delete(chatId),
    deliver: (email: string, input: DeliveryInput) => person(email).deliver(input),
    /** Runs the person's pending flush, as the scheduled callback would at its time. */
    flush: async (email: string) => {
      const at = flushAt.get(email);
      if (at !== undefined && at > clock.now) clock.now = at;
      flushAt.delete(email);
      await person(email).flush();
    },
    notices: (email: string) => (owned.get(email) ?? []).flatMap((id) => chats.harness(id).instance.notices().map((n) => ({ chat: id, ...n }))),
  };
}
