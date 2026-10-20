// The `credentials` namespace (M13): what the agent may know about the person's credentials, which is
// that one exists, its name, kind, status and where it may be used; never a value. The agent cannot
// save a credential or add a host: `credential_request` checks a host against the platform policy and
// hands back a capture link for the person to open, and nothing is written until they submit it.
// From M25.1 the agent may propose another host for a saved API credential (`credential_host_propose`):
// an action of the fresh-card kind `credentials.host`, so only the person's approval of that one card
// runs it, and the registry row it writes names the card, who approved and when. The tool checks the
// card in the chat's own store before asking the Vault, which checks the writer again.
import { Type } from "@earendil-works/pi-ai";
import type { CardRow } from "../chat/cards.ts";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import type { CredentialInfo } from "./core.ts";
import { type CardWriter, checkHost, type HostEntry } from "./hosts.ts";

export interface CredentialsApi {
  list(): Promise<CredentialInfo[]>;
  /** Writes a proposed host under the person's card approval; the Vault refuses any other writer. */
  addApprovedHost?(input: HostProposal, writer: CardWriter): Promise<{ ok: true; entry: HostEntry } | { ok: false; code: string; reason: string }>;
}

export interface HostProposal {
  ref: string;
  host: string;
  methods: string[];
}

/** What the namespace reads of the chat it runs in: whose agent it is, and the chat's cards. */
export interface ProposalDeps {
  person: string;
  card: (id: string) => CardRow | null;
}

const proposalOf = (a: Record<string, unknown>): HostProposal => ({
  ref: String(a.ref ?? ""),
  host: String(a.host ?? "").trim().toLowerCase(),
  methods: [...new Set((Array.isArray(a.methods) && a.methods.length ? a.methods : ["GET", "HEAD"]).map((m) => String(m).toUpperCase()))].sort(),
});

/**
 * The person's approval of this very proposal, as a registry writer: the card the call ran under, for
 * this tool and these arguments, allowed once by the person whose agent proposed it. Anything else,
 * a card still waiting, declined, decided by someone else or for other arguments, or no card at all,
 * is the model's word alone and writes nothing.
 */
export function approvalOf(card: CardRow | null, person: string, proposal: HostProposal): { ok: true; writer: CardWriter } | { ok: false; code: "HOST_NOT_APPROVED"; reason: string } {
  const no = (why: string) => ({ ok: false as const, code: "HOST_NOT_APPROVED" as const, reason: `${proposal.host} was not added: ${why}` });
  if (card?.tool !== "credential_host_propose") return no("no approval card covers this proposal");
  if (card.state !== "deciding" && card.state !== "approved") return no(`its card is ${card.state}`);
  if (card.choice !== "once" || card.decidedBy !== person || card.descriptor.principal !== person || card.decidedAt === null) return no("only the person allows it, once, on its card");
  if (JSON.stringify(proposalOf(card.args)) !== JSON.stringify(proposal)) return no("the card approved a different proposal");
  return { ok: true, writer: { kind: "person", person, via: "card", card: card.id, approvedAt: card.decidedAt } };
}

const ListParams = Type.Object({});
const RequestParams = Type.Object({
  host: Type.String({ description: "The host the credential is for, e.g. login.example.com." }),
  name: Type.String({ description: "A short name for the reference, lower-case letters, digits and dashes, e.g. example-login." }),
  login: Type.Optional(Type.Boolean({ description: "True for a login typed into a page; false for an API key sent in a header." })),
});

const ProposeParams = Type.Object({
  ref: Type.String({ description: "The saved credential, cred://<name>, as credential_list shows it." }),
  host: Type.String({ description: "The https host to send it to, e.g. api.example.com." }),
  methods: Type.Optional(Type.Array(Type.String(), { description: "HTTP methods it may be used with there; GET and HEAD when left out." })),
});

const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });
const NAME = /^[a-z][a-z0-9-]{0,62}$/;

export function credentialsNamespace(api: CredentialsApi, approvals?: ProposalDeps): Namespace {
  const list: ToolSpec<typeof ListParams> = {
    name: "credential_list",
    kind: "observation",
    label: "List saved credentials",
    description: "List the person's saved credentials and the company's: reference, kind, status (active, revoked, expired), permission and the hosts each may be used at. Values are never shown.",
    parameters: ListParams,
    execute: async () => {
      const all = await api.list();
      if (!all.length) return text("NO_CREDENTIALS: the person has saved none. Use credential_request to ask them for one.");
      return text(
        all
          .map((c) => `${c.ref} (${c.kind}${c.company ? ", company" : ""}): ${c.status}; ${c.permission === "grant" ? "needs the person's grant for each use" : "usable at its hosts"}; ${c.hosts.map((h) => `${h.host}${h.fills ? " (fills)" : ""}`).join(", ") || "no host"}`)
          .join("\n"),
      );
    },
  };
  const request: ToolSpec<typeof RequestParams> = {
    name: "credential_request",
    kind: "observation",
    label: "Ask the person to save a credential",
    description:
      "Ask the person to save a credential for a host through the secure form. Returns a link to give them; you never receive the value and nothing is saved until they submit it. Hosts are https names only; IP addresses, private names and platform hosts are refused.",
    parameters: RequestParams,
    execute: async (_id, p) => {
      const host = checkHost(p.host);
      if (!host.ok) throw new Error(`${host.code}: ${host.reason}`);
      if (!NAME.test(p.name)) throw new Error("VAULT_REF_INVALID: a name is lower-case letters, digits and dashes");
      const q = new URLSearchParams({ ref: `cred://${p.name}`, host: host.value, ...(p.login ? { fills: "on", kind: "login", header: "authorization", prefix: "" } : {}) });
      return text(`CAPTURE_REQUESTED: nothing is saved yet. Ask the person to open /vault/capture?${q} and enter the value themselves; never ask them to type it in this chat.`, { host: host.value });
    },
  };
  const propose: ToolSpec<typeof ProposeParams> = {
    name: "credential_host_propose",
    kind: "action",
    label: "Propose a host for a credential",
    description:
      "Propose another https host for one of the person's saved API credentials. The person approves it once on its own card; nothing is added until they do, and no standing permission covers it. Where the value goes on a request stays as the credential already has it.",
    parameters: ProposeParams,
    actionKind: "credentials.host",
    subject: (a) => ({ scope: "personal", connector: "credentials", resource: `credential:${String(a.ref ?? "").slice("cred://".length)}` }),
    cardLines: async (a) => {
      const p = proposalOf(a);
      return [`Credential: ${p.ref}`, `Host: ${p.host}`, `Methods: ${p.methods.join(", ")}`, "Allowing adds this host for the credential from now on; your agent may then send it there."];
    },
    execute: async (id, p) => {
      const proposal = proposalOf(p);
      const host = checkHost(proposal.host);
      if (!host.ok) throw new Error(`${host.code}: ${host.reason}`);
      if (!approvals || !api.addApprovedHost) throw new Error("HOST_NOT_APPROVED: this chat cannot take a card approval for a host");
      const approval = approvalOf(approvals.card(id), approvals.person, proposal);
      if (!approval.ok) throw new Error(`${approval.code}: ${approval.reason}`);
      const r = await api.addApprovedHost(proposal, approval.writer);
      if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
      return text(`HOST_ADDED: ${r.entry.ref} may now go to ${r.entry.host} (${r.entry.methods.join(", ")}), approved by the person on card ${approval.writer.card}.`, { host: r.entry.host });
    },
  };
  return { name: "credentials", description: "see which credentials the person has saved, ask them to save one, or propose a host for one", deferral: "names", tools: [list, request, propose] as ToolSpec[] };
}
