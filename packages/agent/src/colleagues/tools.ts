// The `colleagues` namespace (AD-7, M7.1): the company directory, the grants a colleague has written
// naming this person, and a labeled request to a colleague's agent. A request is an action like any
// other (`colleagues.request`): the person's grants decide whether it goes, the latch refuses it, and
// it carries its origin and one more hop. The reply returns as input to this chat, labeled.
import { Type } from "@earendil-works/pi-ai";
import type { TurnContext } from "../chat/gate.ts";
import type { Grant } from "../grants/types.ts";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import type { AttachmentRef } from "../attachments/store.ts";

export interface DirectoryEntry {
  email: string;
  name?: string;
  role: import("../company/members.ts").Role;
}

export interface ColleagueRequest {
  from: string;
  to: string;
  text: string;
  /** The root principal whose request started the chain, and the agents it passed through. */
  origin: string;
  hops: number;
  viaAgent: boolean;
  replyTo?: { person: string; chatId: string };
  /** The sender's own uploads the request carries (M24.3), as the sender's `Person` described them; never bytes. */
  attachments?: AttachmentRef[];
}

export type RequestOutcome = { ok: true; requestId: string; status: string; text: string } | { ok: false; code: string; reason: string };

export interface ColleaguesApi {
  directory(): Promise<DirectoryEntry[]>;
  /** The colleague's live grants naming `requester`; the colleague's `Person` decides what that is. */
  grantsNaming(colleague: string, requester: string): Promise<Array<Pick<Grant, "id" | "subject" | "mode" | "constraints" | "expires_at">>>;
  request(input: ColleagueRequest): Promise<RequestOutcome>;
  /** Puts a colleague's reply into the requesting chat as a notice for its owner. */
  deliverReply(chatId: string, n: { id: string; source: string; text: string; person: string }): Promise<unknown>;
  /** The requester's own uploads by id, as their `Person` decides (M24.3); any not theirs refuses the request. */
  shareAttachments?(principal: string, ids: string[]): Promise<{ ok: true; refs: AttachmentRef[] } | { ok: false; code: string; reason: string }>;
}

const EMAIL = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const ok = (text: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text }], details });

export function colleaguesNamespace(api: ColleaguesApi, o: { principal: string; context: TurnContext; chatId: string }): Namespace {
  const directory: ToolSpec = {
    name: "colleagues_directory",
    kind: "observation",
    label: "Company directory",
    description: "List the people in your person's company: name, address and role.",
    parameters: Type.Object({}),
    execute: async () => {
      const people = await api.directory();
      return ok(people.map((p) => `- ${p.name ?? p.email} <${p.email}> (${p.role})`).join("\n") || "(no one)", { count: people.length });
    },
  };
  const checkGrant: ToolSpec = {
    name: "colleagues_check_grant",
    kind: "observation",
    label: "Check a colleague's grants",
    description: "See which grants a colleague has written naming your person, before asking their agent for something.",
    parameters: Type.Object({ colleague: Type.String({ description: "The colleague's address." }) }),
    execute: async (_id, p) => {
      const colleague = String((p as { colleague: string }).colleague).trim().toLowerCase();
      if (!EMAIL.test(colleague)) throw new Error("COLLEAGUE_INVALID: name a colleague by address");
      const grants = await api.grantsNaming(colleague, o.principal);
      const lines = grants.map((g) => `- ${g.subject.kind} ${g.subject.ref}: ${g.mode}${g.expires_at ? ` until ${new Date(g.expires_at).toISOString()}` : ""}`);
      return ok(lines.join("\n") || "no grant names your person", { count: grants.length });
    },
  };
  const request: ToolSpec = {
    name: "colleagues_request",
    kind: "action",
    label: "Ask a colleague's agent",
    description: "Send a request to a colleague's agent. It is labeled as coming from your person through you; their agent acts only under grants their person wrote, and the reply comes back to this chat.",
    parameters: Type.Object({
      to: Type.String({ description: "The colleague's address." }),
      text: Type.String({ minLength: 1, maxLength: 4000, description: "What you ask, in plain words." }),
      attachments: Type.Optional(Type.Array(Type.String(), { maxItems: 10, description: "Ids of your person's own attachments to send with it, from their [attachment <id>] lines." })),
    }),
    actionKind: "colleagues.request",
    forwardsToAgent: true,
    subject: (args) => ({ scope: "personal", resource: `colleague:${String(args.to).trim().toLowerCase()}` }),
    recipients: (args) => [String(args.to).trim().toLowerCase()],
    execute: async (id, p) => {
      const { to, text, attachments: ids } = p as { to: string; text: string; attachments?: string[] };
      let attachments: AttachmentRef[] | undefined;
      if (ids?.length) {
        const shared = api.shareAttachments ? await api.shareAttachments(o.principal, ids) : { ok: false as const, code: "ATTACHMENTS_UNAVAILABLE", reason: "attachments cannot be sent from here" };
        if (!shared.ok) throw new Error(`${shared.code}: ${shared.reason}`);
        attachments = shared.refs;
      }
      const outcome = await api.request({
        from: o.principal, to: to.trim().toLowerCase(), text, origin: o.context.origin, hops: o.context.hops + 1, viaAgent: true,
        replyTo: { person: o.principal, chatId: o.chatId }, ...(attachments ? { attachments } : {}),
      });
      const reply = outcome.ok ? outcome.text : `The request to ${to} was not delivered: ${outcome.code}.`;
      await api.deliverReply(o.chatId, { id: `colleague-reply:${id}`, source: `colleague:${to.trim().toLowerCase()}`, text: reply, person: o.principal });
      if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.reason}`);
      return ok(reply, { requestId: outcome.requestId, status: outcome.status });
    },
  };
  return { name: "colleagues", description: "the company directory, colleagues' grants naming your person, and labeled requests to their agents", deferral: "names", tools: [directory, checkGrant, request] };
}
