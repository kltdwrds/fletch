// The words of the Connectors, Permissions and Search pages (M23.5) and the pure functions that turn the
// owning stores' answers into rows. Nothing here decides: a connector row's mode is the grants engine's own
// `inForce` and `subjectCovers` over the person's grants, a standing grant is a grant the person signed, and
// every sentence comes from a table, never from a code or an identifier. A row the tables do not know still
// gets a sentence.
import { inForce, subjectCovers } from "../../grants/engine.ts";
import type { Descriptor, Grant, Mode } from "../../grants/types.ts";

export const CONNECTORS_TEXT = {
  title: "Connectors",
  search: "Search connectors",
  connected: "Connected",
  available: "Available",
  view: "View",
  connect: "Connect",
  builtIn: "Built in",
  yours: "Yours",
  company: "Company",
  companyBy: "Company · {name} connected it",
  companyUnknown: "Company",
  emptyConnected: "Nothing is connected yet.",
  emptyAvailable: "Nothing more to connect.",
  noMatch: "No connector matches that.",
  reading: "Reading…",
  notRead: "Could not read this just now. Reload the page to try again.",
  revoke: "Revoke",
  revoked: "Revoked. Your agent asks each time again.",
  notRevoked: "That did not go through. Try again.",
  asksEach: "Asks each time",
  neverShown: "Your agent never sees the value.",
  close: "Close",
  fieldName: "Name, like cred://github",
  fieldHost: "Host it may be sent to, like api.github.com",
  fieldValue: "The key, token or password",
  saved: "Saved to your vault. The value is sealed and will not be shown again.",
  notSaved: "Not saved: check the name and the host, then type the value again.",
};

/** What the capture form can take, with the query that opens it on the right kind. */
export const AVAILABLE_CONNECTORS = [
  { id: "secret", mono: "K", name: "API key or token", sub: "Let your agent call a service you have a key for.", href: "/vault/capture?kind=secret" },
  { id: "login", mono: "L", name: "Login password", sub: "Let your agent sign in to a site for you.", href: "/vault/capture?kind=login" },
];

export const PERMISSIONS_TEXT = {
  title: "Permissions",
  standing: "What others can ask of your agent",
  standingEmpty: "Nobody can ask your agent for anything on their own.",
  intro: "What your agent does on its own and when it asks first.",
  connectors: "Connectors",
  allConnectors: "All connectors",
  coming: "Coming",
  granted: "Granted",
  until: "until",
  revoke: "Revoke",
  revoked: "Revoked.",
  notRevoked: "That did not go through. Try again.",
  notRead: "Could not read this just now. Reload the page to try again.",
  defaultsNote: "These are your agent's standing rules. They are not changed here.",
};

/** The two defaults the gates apply when no grant says otherwise: an action asks, a read goes ahead. */
export const GATE_DEFAULTS = [
  { id: "connector", label: "Connector defaults", on: "ask-some", options: [
    { id: "ask-some", t: "Ask for some actions", s: "Before actions that may share your information or make important changes" },
    { id: "always-ask", t: "Always ask", s: "Before any action" },
  ] },
  { id: "web", label: "Web access defaults", on: "ask-some", options: [
    { id: "ask-some", t: "Ask for some actions", s: "When your information may be shared or the website is unfamiliar" },
    { id: "always-ask", t: "Always ask", s: "Before visiting any website" },
  ] },
];

export const SEARCH_TEXT = {
  title: "Search",
  placeholder: "Search chats and memory",
  label: "Search everything",
  cancel: "Cancel",
  recents: "Recents",
  results: "Results",
  emptyRecents: "No chats yet.",
  none: "Nothing found.",
  memoryDown: "Memory could not be searched just now, so only chat titles are shown.",
  unplaced: ["{n} memory match did not come from a chat and is not listed.", "{n} memory matches did not come from a chat and are not listed."],
  notRead: "Could not search just now. Try again.",
  main: "Main chat",
};

const MODE_WORDS: Record<Mode, string> = { auto: "Allow", ask: "Ask", deny: "Never" };
const SEVERITY: Record<Mode, number> = { deny: 2, ask: 1, auto: 0 };

export interface PageSpec {
  title: string;
  blurb: string;
  groups: Array<{ label: string; rows: Array<{ id: string; label: string; fixed?: string; actionKind?: string; connector?: string }> }>;
}

/** The built-in connectors' pages. A read is not gated, so it says so; the one gated action is backed by the engine. */
export const BUILTIN_PAGES: Record<string, PageSpec> = {
  browser: {
    title: "Browser",
    blurb: "Built in. Lets your agent search the web and open websites in its own browser, never yours.",
    groups: [
      { label: "Read", rows: [{ id: "visit", label: "Visit websites", fixed: "Allowed" }] },
      { label: "Write and delete", rows: [{ id: "fill", label: "Fill saved credentials", actionKind: "browse.fill", connector: "browse" }] },
    ],
  },
  hackernews: {
    title: "Hacker News",
    blurb: "Built in. Lets your agent read Hacker News stories.",
    groups: [{ label: "Read", rows: [{ id: "read", label: "Read stories", fixed: "Allowed" }] }],
  },
};

export interface PermissionRow {
  id: string;
  label: string;
  /** The sentence or mode word the row shows. */
  words: string;
  /** Present only where a live grant backs the row: what Revoke acts on. */
  grantId?: string;
  /** Present only where the agent stops and waits on the person (an ask grant, or no grant): drawn in warn. */
  asks?: true;
}

/** A row backed by the engine: the person's strictest live grant for their own agent covering the action, else none. */
export function engineRow(grants: readonly Grant[], row: { id: string; label: string; actionKind: string; connector: string }, now: number): PermissionRow {
  const d = { actionKind: row.actionKind, subject: { scope: "personal", connector: row.connector } } as Descriptor;
  const covering = grants
    .filter((g) => g.grantee.kind === "own-agent" && inForce(g, now) && subjectCovers(g, d))
    .sort((a, b) => SEVERITY[b.mode] - SEVERITY[a.mode] || a.id.localeCompare(b.id));
  const top = covering[0];
  if (!top) return { id: row.id, label: row.label, words: CONNECTORS_TEXT.asksEach, asks: true };
  return { id: row.id, label: row.label, words: MODE_WORDS[top.mode], grantId: top.id, ...(top.mode === "ask" ? { asks: true as const } : {}) };
}

/** What a standing grant lets someone ask, by the action kind's family (the longest prefix wins). */
const ASK_WORDS: Array<[prefix: string, words: string]> = [
  ["calendar", "use your calendar"],
  ["reports", "read your reports"],
  ["docs", "share your documents"],
  ["notes", "post notes for you"],
  ["mail", "use your mail"],
  ["books", "read the company's books"],
  ["workspace", "work in your workspace"],
  ["memory", "use what it remembers"],
  ["browse", "use the web for you"],
];
const ASK_FALLBACK = "do something for them";

const askWords = (g: Grant): string => {
  const ref = g.subject.ref.replace(/^connector:/, "");
  const hit = ASK_WORDS.filter(([p]) => ref === p || ref.startsWith(`${p}.`) || ref.startsWith(`${p}_`)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : ASK_FALLBACK;
};

export interface StandingNote {
  /** The grant id, so Revoke can name it; never drawn. */
  id: string;
  title: string;
  at: number;
  until: number | null;
}

/** The grants the person signed that let someone else's request through, live now, as sentences. */
export function standingNotes(grants: readonly Grant[], nameOf: (email: string) => string, now: number): StandingNote[] {
  return grants
    .filter((g) => g.grantor.kind === "person" && g.grantee.kind !== "own-agent" && inForce(g, now))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    .map((g) => {
      const who =
        g.grantee.kind === "person" ? nameOf(g.grantee.id ?? "")
        : g.grantee.kind === "agent-of-person" ? `${nameOf(g.grantee.id ?? "")}'s agent`
        : g.grantee.kind === "team" ? "Your team"
        : "Anyone in your company";
      const what = askWords(g);
      const title = g.mode === "deny" ? `${who} cannot ask your agent to ${what}` : g.mode === "ask" ? `${who} can ask your agent to ${what}; it checks with you first` : `${who} can ask your agent to ${what}`;
      return { id: g.id, title, at: g.created_at, until: g.expires_at ?? null };
    });
}
