// The `browse` namespace (M9): the read lane (`browse_open`), the live lane (`browse_live`), the human
// step (`browse_handoff`) and credential fill (`browse_fill`). Page text is data: it arrives fenced,
// its links are `url_id` numbers, and an address the model passes must be one the person or a page
// gave, verbatim. The credential value never reaches this module: `browse_fill` names a reference and
// the Vault, through the egress module, types it into the page.
import { Type } from "@earendil-works/pi-ai";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import { classify } from "./classify.ts";
import { numberLinks } from "./markdown.ts";
import type { EngineMemoryApi } from "./memory.ts";
import type { BrowserPort, PageView } from "./port.ts";
import { blocked, readPage, rememberedStop } from "./read.ts";
import { type UrlTable, validUrl } from "./urls.ts";

/** What the tools need of the Vault: typing a credential into a session, and scrubbing what is read back. */
export interface FillApi {
  fill(req: { session: string; url: string; selector: string; ref: string; field?: string }): Promise<{ ok: true; host: string } | { ok: false; code: string; reason: string }>;
  scrub(session: string, text: string): Promise<string>;
}

/**
 * What the tools need of the Vault for saved logins (M24.3): keep the live page's site login, and put a
 * saved one into a fresh session before it navigates. Both answer with a site and codes, never a value.
 */
export interface LoginsApi {
  save(req: { session: string; url: string }): Promise<{ ok: true; site: string; cookies: number } | { ok: false; code: string; reason: string }>;
  restore(req: { session: string; url: string }): Promise<{ ok: true; restored: boolean; site: string } | { ok: false; code: string; reason: string }>;
}

export interface BrowseDeps {
  port: BrowserPort;
  memory: EngineMemoryApi;
  urls: UrlTable;
  /** The reused live session's id, kept with the chat. */
  session: { get(): string | null; set(id: string | null): void };
  fill?: FillApi;
  logins?: LoginsApi;
  now: () => number;
}

const Target = {
  url_id: Type.Optional(Type.Integer({ minimum: 1, description: "A link's number from an earlier page, written as in [text](url_id:N)." })),
  url: Type.Optional(Type.String({ maxLength: 2000, description: "An address copied exactly from the person's message or a page. An address you built or completed is refused." })),
};
const OpenParams = Type.Object(Target);
const SaveParams = Type.Object({});
const HandoffParams = Type.Object({ instructions: Type.String({ minLength: 3, maxLength: 300, description: "What the person should do in the page, in one sentence." }) });
const FillParams = Type.Object({
  selector: Type.String({ minLength: 1, maxLength: 300, description: "CSS selector of the form field on the live page." }),
  credential: Type.String({ pattern: "^cred://[a-z][a-z0-9-]{0,62}$", description: "A credential reference such as cred://example-login; never a value." }),
  site: Type.Optional(Type.String({ pattern: "^[a-z0-9.-]{1,253}$", description: "The host of the page you fill, shown to the person on the approval card; a credential they typed in chat ([credential:cred://typed-...]) needs it." })),
  field: Type.Optional(Type.Literal("verification_code", { description: "Set when the credential is a one-time code ([credential:cred://otp-...]); a code goes into no other field." })),
});

const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });
const err = (code: string, reason: string) => new Error(`${code}: ${reason}`);

function target(deps: BrowseDeps, p: { url_id?: number | undefined; url?: string | undefined }, required: boolean): string | null {
  if (p.url_id !== undefined && p.url !== undefined) throw err("BROWSE_TARGET_AMBIGUOUS", "give a url_id or a url, not both");
  if (p.url_id !== undefined) {
    const u = deps.urls.resolve(p.url_id);
    if (!u) throw err("BROWSE_URL_ID_UNKNOWN", `no page has handed over link ${p.url_id}; use a number from a page you opened`);
    return u;
  }
  if (p.url !== undefined) {
    if (!validUrl(p.url)) throw err("BROWSE_URL_INVALID", "only http and https addresses without a login part open");
    if (!deps.urls.holds(p.url)) throw err("BROWSE_URL_NOT_VERBATIM", "that address is not one the person wrote or a page gave; ask the person for it, or use a link number");
    return p.url;
  }
  if (required) throw err("BROWSE_TARGET_REQUIRED", "give a url_id or a url");
  return null;
}

function render(url: string, via: string, markdown: string, deps: BrowseDeps): string {
  const n = numberLinks(markdown, url, deps.urls);
  const head = `${url} (via ${via}, ${n.links} links${n.truncated ? `, TRUNCATED: ${n.truncated} more characters were not shown` : ""})`;
  // The chat's tool fence already wraps this as external content and defangs any marker inside it.
  return `${head}\n${n.text}`;
}

/** A live page as text with numbered links, scrubbed of any value typed into this session. */
async function renderLive(deps: BrowseDeps, sessionId: string, page: PageView): Promise<string> {
  const sep = "\u0000";
  const parts = [page.url, page.title, page.text, ...page.links.flatMap((l) => [l.text, l.href])];
  let clean = parts;
  if (deps.fill) {
    try {
      clean = (await deps.fill.scrub(sessionId, parts.join(sep))).split(sep);
    } catch (e) {
      throw err("BROWSE_SCRUB_FAILED", `the page was not shown because it could not be checked for credentials (${String(e instanceof Error ? e.message : e).split(": ")[0]})`);
    }
  }
  const [url = page.url, title = "", body = ""] = clean;
  const ids = deps.urls.add(page.links.map((_, i) => clean[4 + i * 2] ?? "").filter((h) => validUrl(h)));
  const shown = page.links.map((_l, i) => ({ label: clean[3 + i * 2] ?? "", href: clean[4 + i * 2] ?? "" })).filter((l) => validUrl(l.href));
  const lines = shown.slice(0, 60).map((l, i) => `[${l.label || "link"}](url_id:${ids[i]})`);
  return `${url} (live session; title: ${title || "none"}; ${shown.length} links)\n${body.slice(0, 20_000)}${lines.length ? `\n\nLinks:\n${lines.join("\n")}` : ""}`;
}

export function browseNamespace(deps: BrowseDeps): Namespace {
  const open: ToolSpec<typeof OpenParams> = {
    name: "browse_open",
    kind: "observation",
    label: "Read a web page",
    description:
      "Read a public web page as markdown with numbered links. Give a url_id from a page you opened, or an address copied exactly from the person's message. If the site blocks the read, browsing that site stops; report it and do not try another way in.",
    parameters: OpenParams,
    external: true,
    execute: async (_id, p) => {
      const url = target(deps, p, true) as string;
      const r = await readPage(deps, url);
      if (!r.ok) throw err(r.code, r.reason);
      return text(render(url, r.engine, r.markdown, deps), { engine: r.engine, status: r.status });
    },
  };
  const live: ToolSpec<typeof OpenParams> = {
    name: "browse_live",
    kind: "observation",
    label: "Use the live browser",
    description:
      "Open a page in the person's own live Chromium session, which keeps its cookies between calls. With no url_id or url it re-reads the current page, which is how to continue after a handoff. Stops at a bot wall like browse_open.",
    parameters: OpenParams,
    external: true,
    mutates: true,
    execute: async (_id, p) => {
      const url = target(deps, p, false);
      if (url) {
        const stop = await rememberedStop(deps, new URL(url).hostname.toLowerCase());
        if (stop) throw err(stop.code, stop.reason);
      }
      const known = deps.session.get();
      if (url === null) {
        if (!known) throw err("BROWSE_NO_SESSION", "no live page is open; give a url_id or a url");
        const st = await deps.port.handoffState(known);
        if (st.ok && st.active) return text("HANDOFF_PENDING: the person has not finished in the live view yet. Wait for them to say they are done; nothing has changed on the page.", { code: "HANDOFF_PENDING" });
      }
      const s = await deps.port.session(known);
      if (!s.ok) throw err(s.code, s.reason);
      deps.session.set(s.sessionId);
      // A fresh session starts signed in where the person kept a login and granted its use (M24.3): restored
      // before its first navigation, which is then to the address it was opened for. A refusal is said, not hidden.
      let login = "";
      if (!s.reused && url && deps.logins) {
        const r = await deps.logins.restore({ session: s.sessionId, url });
        if (r.ok && r.restored) login = `\nSigned in with the login kept for ${r.site}.`;
        else if (!r.ok) login = `\nLOGIN_NOT_RESTORED (${r.code}): ${r.reason}. The page opened without it.`;
      }
      const g = await deps.port.goto(s.sessionId, url);
      if (!g.ok) throw err(g.code, g.reason);
      const domain = new URL(g.page.url).hostname.toLowerCase();
      const block = classify(g.page.status, g.page.text);
      if (block) {
        const stop = await blocked(deps, domain, "live", block.code, `${domain}: ${block.reason}.`, block.retryAfter);
        throw err(stop.code, `${stop.reason} The person can take over this page with browse_handoff if they want to.`);
      }
      await deps.memory.record({ domain, engine: "live", state: "ok", code: null });
      return text(`${await renderLive(deps, s.sessionId, g.page)}${login}`, { engine: "live", status: g.page.status, reused: s.reused });
    },
  };
  const handoff: ToolSpec<typeof HandoffParams> = {
    name: "browse_handoff",
    kind: "observation",
    label: "Hand the page to the person",
    description:
      "Ask the person to act in the live page themselves (a login code, a bot check, a payment). Returns a Live View link that is a credential: give it only to the person, in this chat, and wait. Call browse_live with no arguments after they say they are done.",
    parameters: HandoffParams,
    mutates: true,
    execute: async (_id, p) => {
      const known = deps.session.get();
      if (!known) throw err("BROWSE_NO_SESSION", "no live page is open to hand over");
      const h = await deps.port.handoff(known, p.instructions);
      if (!h.ok) throw err(h.code, h.reason);
      return text(
        `HANDOFF_REQUESTED: the page is waiting for the person. Give them this Live View link (valid ${Math.round(h.expiresInMs / 60000)} minutes, for them only): ${h.liveViewUrl}\nWhen they say they are done, call browse_live with no arguments.`,
        { handoff: h.handoffId },
      );
    },
  };
  const fill: ToolSpec<typeof FillParams> = {
    name: "browse_fill",
    kind: "action",
    label: "Fill a field with a stored credential",
    description:
      "Type a stored credential into a field of the live page. Name the field's selector and the credential's reference; you never see the value. Needs the person's grant for that credential.",
    parameters: FillParams,
    actionKind: "browse.fill",
    subject: (a) => ({ scope: "personal", connector: "browse", resource: `credential:${String(a.credential).slice("cred://".length)}` }),
    execute: async (_id, p) => {
      const session = deps.session.get();
      if (!session || !deps.fill) throw err("BROWSE_NO_SESSION", "no live page is open to fill");
      const g = await deps.port.goto(session, null);
      if (!g.ok) throw err(g.code, g.reason);
      const r = await deps.fill.fill({ session, url: g.page.url, selector: p.selector, ref: p.credential, ...(p.field ? { field: p.field } : {}) });
      if (!r.ok) throw err(r.code, r.reason);
      return text(`FILLED: ${p.selector} on ${r.host} from ${p.credential}. The value was not shown to you.`, { host: r.host });
    },
  };
  const save: ToolSpec<typeof SaveParams> = {
    name: "browse_save_login",
    kind: "observation",
    mutates: true,
    label: "Keep this site's login",
    description:
      "Keep the login of the live page's site, sealed in the person's vault, so a later live session can start signed in. It is restored only under the person's own grant for that site, which they give in settings; you never see it.",
    parameters: SaveParams,
    execute: async () => {
      const session = deps.session.get();
      if (!session || !deps.logins) throw err("BROWSE_NO_SESSION", "no live page is open whose login could be kept");
      const g = await deps.port.goto(session, null);
      if (!g.ok) throw err(g.code, g.reason);
      const r = await deps.logins.save({ session, url: g.page.url });
      if (!r.ok) throw err(r.code, r.reason);
      return text(`LOGIN_KEPT: the login for ${r.site} is sealed in the person's vault. A new live session restores it only once they grant its use for ${r.site} in settings.`, { site: r.site });
    },
  };
  return {
    name: "browse",
    description: "read web pages (a light read lane, then a live browser session), hand a page to the person, fill a stored credential",
    deferral: "names",
    tools: [open, live, handoff, fill, ...(deps.logins ? [save] : [])] as ToolSpec[],
  };
}
