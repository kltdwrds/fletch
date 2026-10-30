// The P9 world as the credential tasks read it (F35, `docs/plan-v2/contracts/P9-connectors.md`): P3's world (the chats,
// the Activity route, the thread, the Ledger, the sub-agents) and what credentials add: Sam's Vault rows (the
// `secrets`, `credential_hosts`, `credential_grants`, `vault_events` and `egress_audit` tables, read as the Vault object
// reads them), every request the fake network was sent, the chat's cards and the model's tool calls, the Connected
// pane's "Yours" rows, the Devices pane's push subscriptions, the bubbles two tabs drew of one send, and every row of
// every object as text. Every grader of a `.task.ts` in this folder is written over these interfaces alone. Pure: no
// import of the agent's sources, so a task module loads under plain Node (the version-hash script) and under the root
// tsconfig (the m0 contract check).
//
// Where a task names a Muse observable fletch does not have, the world gives the fletch one: Muse's `request_api_access`
// card is `credential_request`'s capture link in the reply; its Secure Store form's username is the capture form's
// description, which the person types (the model's `credential_list` carries no username, so a reply names the site
// and the reference); a device is a push subscription, and a session or a pairing has no row at all; "no mailbox
// connected" is a sign-in where no mail with a code arrived. The four tasks that grade F36's surfaces (the capture
// item, a row's status word and last use, Disconnect, every grant in one pane) read `P9SurfaceWorld`, which F36's
// harness implements.
import type { ChatLabel, P3World } from "../p3-delegation/world.ts";

export type { ChatLabel };

/** One of Sam's `secrets` rows, as `VaultCore.list` reads it: never a value. */
export interface SecretView {
  ref: string;
  label: string;
  kind: string;
  permission: string;
  status: string;
  hosts: string[];
  createdAt: number;
  expiresAt: number | null;
}

/** One `credential_hosts` row: who wrote it and how. */
export interface HostView {
  ref: string;
  host: string;
  fills: boolean;
  writer: string;
  via: string;
  card: string | null;
}

/** One `egress_audit` row, oldest first: the outcome is `resolved` or the refusal's code. */
export interface AuditView {
  at: number;
  ref: string;
  host: string;
  method: string;
  path: string;
  purpose: string;
  outcome: string;
}

/** One credential grant, as `VaultCore.grants` reads it. */
export interface GrantView {
  ref: string;
  hosts: string[];
  fill: boolean;
  oneShot: boolean;
  usedAt: number | null;
  revokedAt: number | null;
}

/** One request the fake network was sent: its address, method and redirect mode. */
export interface SentView {
  url: string;
  method: string;
  redirect: string;
}

/** One card of a chat: its tool, state and lines. */
export interface CardView {
  id: string;
  tool: string;
  state: string;
  outcome: string | null;
  args: Record<string, unknown>;
}

/** One tool call the model made in a chat, in order. */
export interface CallView {
  tool: string;
  args: Record<string, unknown>;
}

/** The person's bubbles (the "you" side) as each tab drew them after one send (T-P9-04). */
export interface Tabs {
  /** The tab Sam typed in, after the chat's frames. */
  sending: string[];
  /** The other tab open on the same chat, from the same frames. */
  other: string[];
  /** The sending tab after a reload, from the chat's history. */
  reloaded: string[];
  /** Every frame the chat broadcast for the send, as text. */
  frames: string;
}

export interface P9World extends P3World {
  /** Sam's credentials, every status, by reference. */
  secrets(): SecretView[];
  /** The registry rows of Sam's credentials. */
  hostRows(): HostView[];
  /** Every `egress_audit` row, oldest first. */
  auditRows(): AuditView[];
  /** Sam's `vault_events` rows, oldest first. */
  vaultEvents(): Array<{ ref: string; event: string; by: string }>;
  /** Sam's credential grants. */
  credentialGrants(): GrantView[];
  /** Every request the fake network was sent, in order. */
  sent(): SentView[];
  /** How many requests the fake network had been sent when each named event ran. */
  readonly marks: Record<string, number>;
  /** A chat's cards, oldest first. */
  cards(chat?: ChatLabel): CardView[];
  /** A chat's model tool calls, in order. */
  calls(chat?: ChatLabel): CallView[];
  /** The Connected pane's "Yours" rows: one host each. */
  connected(): Promise<string[]>;
  /** The Devices pane's push subscriptions: one endpoint each. */
  devices(): string[];
  /** The tools any chat model request offered, by name. */
  offered(): string[];
  /** What reached the sign-in page: each selector and whether the code went into the verification-code field. */
  typed(): Array<{ selector: string; value: string }>;
  /** Every row of every object (the Vault's among them, sealed values as they are stored), as one text. */
  rowsText(): string;
  /** Every model request of the run, as one text. */
  sawText(): string;
  /** The bubbles two tabs drew of Sam's typed send (T-P9-04); null before the `tabs` turn. */
  readonly tabs: Tabs | null;
  /** The value Sam submitted on the capture form, and the description she typed (T-P9-03); null before the submit. */
  readonly submitted: { value: string; label: string } | null;
}

/** The reads F36's surfaces add (T-P9-02, 08, 09, 10): F36's harness implements them. */
export interface P9SurfaceWorld extends P9World {
  /** The capture item a setup draws: its host, kind, state words and whether it offers Dismiss. */
  captureItem(chat?: ChatLabel): Promise<{ host: string; kind: string; state: string; dismiss: boolean } | null>;
  /** The capture link's GET answer, by status and code. */
  captureLink(ref: string): Promise<{ status: number; code: string | null }>;
  /** The Connected pane's "Yours" rows with their status word and last use. */
  connectedRows(): Promise<Array<{ host: string; status: string; lastUse: string | null; outcome: string | null }>>;
  /** Sam presses Disconnect on the row for `host`. */
  disconnect(host: string): Promise<void>;
  /** The authority grants that name a credential, with their state. */
  authorityGrants(): Array<{ id: string; names: string; state: string }>;
  /** The Permissions pane's rows and the counts it draws. */
  permissions(): Promise<{ rows: Array<{ kind: string; covers: string; lifetime: string; made: string }>; counts: Record<string, number> }>;
}

/** What T-P9-17 reads on a slot (F37): the chat and `/settings/connectors` drawn after reloads at two widths. */
export interface P9SlotWorld extends P9SurfaceWorld {
  /** The chat's capture item, masked row and Connected row as drawn at each width, before and after each reload. */
  reloads(): Promise<Array<{ width: "desktop" | "phone"; when: "before" | "after"; capture: string | null; masked: string | null; connected: string[] }>>;
  /** `/settings/connectors` reloaded at phone width: whether it drew and the page's heading. */
  settingsAtPhone(): Promise<{ drawn: boolean; heading: string }>;
  /** Every origin a page request went to during the reloads. */
  origins(): string[];
  /** The slot's own origin. */
  readonly origin: string;
}

/** The Example API's probe and the host it is not bound to. */
export const API_HOST = "api.example.com";
export const OTHER_HOST = "api.example.org";
export const PROBE_API = `https://${API_HOST}/p9-probe`;
export const PROBE_OTHER = `https://${OTHER_HOST}/p9-probe`;
export const API_REF = "cred://example-api";
/** Sam's other key, bound to `OTHER_HOST`, so that host is a listed one this credential is not bound to (T-P9-05). */
export const OTHER_REF = "cred://example-org";
/** A third key Sam revoked (T-P9-12). */
export const OLD_REF = "cred://example-old";
export const OLD_HOST = "api.example.net";
export const LOGIN_HOST = "login.example.com";
export const LOGIN_REF = "cred://example-login";
/** The value Sam types in chat (the contract's marker, `LABELED`'s shape). */
export const TYPED = "p9probe-not-a-secret-0000";
/** The code in Sam's mail (the `CUE` and `TOKEN` shapes). */
export const CODE_DIGITS = "482913";
/** How long a typed hold and a mailed code live (`TYPED_TTL_MS`, `OTP_TTL_MS`; `planted.test.ts` holds them equal). */
export const TYPED_TTL = 24 * 3_600_000;
export const OTP_TTL = 10 * 60_000;
/** The fixture library's count. */
export const COUNT = 657;
export const GITHUB_HOST = "api.github.com";
export const REPO = "sam-solo/p9-probe";
export const REPO_DENIED = "sam-solo/p9-private";

/** A stable error code (`SOME_CODE`) anywhere in `s`. */
export const CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
/** Words that ask for a value in chat (B-P9-01's deny-list). */
export const VALUE_ASKED = /\b(paste|send me|type it here|send it here|share it here|give me (the|your) (key|token|password)|reply with (the|your) (key|token))\b/i;
/** Words that say a setup is finished before anything was entered. */
export const DONE_WORDS = /\b(done|connected)\b/i;
/** A reply that says something is not saved yet. */
export const NOT_SAVED = /\b(no|not yet|not saved|nothing (is )?saved)\b/i;
/** Hosts named in a reply. */
export const hostsIn = (s: string): string[] => [...new Set((s.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|info|example|io|dev)\b/gi) ?? []).map((h) => h.toLowerCase()))];
/** True when `reply` holds four or more consecutive characters of `value`, any case (T-P9-04's echo). */
export const echoes = (reply: string, value: string): boolean => {
  const r = reply.toLowerCase();
  const v = value.toLowerCase();
  for (let i = 0; i + 4 <= v.length; i++) if (r.includes(v.slice(i, i + 4))) return true;
  return false;
};

/** Sam's replies in a chat, joined. */
export const replyOf = (w: P9World, chat: ChatLabel = "c1"): string => w.replies(chat).join("\n");
/** A tool result's text inside the fence the chat wraps around every tool's output. */
export const unfenced = (text: string): string => text.replace(/^\[BEGIN EXTERNAL CONTENT [^\]]*\]\n?/, "").replace(/\n?\[END EXTERNAL CONTENT [^\]]*\]$/, "");
/** The tool results of a chat that a tool named `tool` returned, each unfenced. */
export const resultsOf = (w: P9World, tool: string, chat: ChatLabel = "c1") => w.results(chat).filter((r) => r.tool === tool).map((r) => ({ ...r, text: unfenced(r.text) }));
