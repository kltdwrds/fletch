// The `documents` namespace (M24.3, spec P3 "Out"): `render_document` makes a docx, odt or html file
// from Markdown on the Renderer (AD-8) and saves it as a Library item, and `share_document` makes a
// public share link to one of the person's files. Rendering changes only the person's own files, so it
// is an observation that commits when called (refused while a colleague's request runs). Sharing
// publishes, so it is an action of the fresh-card kind `files.share`: the gate raises an approval card
// every time and the grants engine honours no standing grant for it (`grants/engine.ts`); only that
// card's approval runs it, and then the chat shows a share card with the link's expiry.
import { Type } from "@earendil-works/pi-ai";
import type { WriteResult } from "../files/store.ts";
import type { DocumentCall, LinkResult, ShareListResult, ShareResult } from "../files/links.ts";
import type { JournaledRevoke } from "../files/journaled.ts";
import { REPLACED_WORDS } from "../files/tools.ts";
import { LINK_TTL_MS, lifeWords, SHARE_DEFAULT_MINUTES, SHARE_MAX_MINUTES } from "../files/links.ts";
import type { EffectBuffer } from "../chat/tools.ts";
import type { Namespace, ToolSpec } from "../tools/registry.ts";
import type { Host, HostFailure } from "@qyvr/host";
import { RENDER_FORMATS, type RenderCode, type RenderFormat, type RenderResult } from "./render.ts";

/** What the chat reaches: the host's renderer (`hostOf(env).render`, refused where the host has none), and the owner's files on their `Person` object, which decides. */
export interface DocumentsApi {
  render(input: { markdown: string; to: RenderFormat }): Promise<RenderResult | HostFailure>;
  /** A rendered document saved as one of the owner's files: html as text, docx and odt as bytes. */
  save(input: { path: string; text?: string; base64?: string; mediaType: string }, requester: string): Promise<WriteResult>;
  link(input: { path: string; download?: boolean }, requester: string): Promise<LinkResult>;
  share(input: { path: string; minutes?: number }, requester: string): Promise<ShareResult>;
  /** The owner's shares from the store (F101). */
  shares(requester: string): Promise<ShareListResult>;
  /** Ends one share by id, journaled `files.unshare` on the Person (F101). */
  revoke(id: string, requester: string): Promise<JournaledRevoke>;
}

/**
 * The render the chat and the routes reach (F56): the host's renderer where its deploy binds one, else the host's own
 * refusal as it is (`HOST_RENDER_UNAVAILABLE` with the binding it lacks), never an empty success.
 */
export function hostRender(host: Pick<Host, "render">): DocumentsApi["render"] {
  return async (input) => {
    const r = host.render;
    if ("ok" in r && r.ok === false) return r as HostFailure;
    return (await (r as Exclude<Host["render"], HostFailure>).render(input)) as RenderResult | HostFailure;
  };
}

/** The chat's `DocumentsApi` over the owner's `Person` (`documentCall`) and the Renderer. */
export function documentsApi(call: (c: DocumentCall, requester: string) => Promise<unknown>, render: DocumentsApi["render"]): DocumentsApi {
  return {
    render,
    save: (input, requester) => call({ op: "save", ...input }, requester) as Promise<WriteResult>,
    link: (input, requester) => call({ op: "link", ...input }, requester) as Promise<LinkResult>,
    share: (input, requester) => call({ op: "share", ...input }, requester) as Promise<ShareResult>,
    shares: (requester) => call({ op: "shares" }, requester) as Promise<ShareListResult>,
    revoke: (id, requester) => call({ op: "revoke", id }, requester) as Promise<JournaledRevoke>,
  };
}

/** Each Renderer code in words, so the agent can say what happened; nothing was saved for any of them. */
export const RENDER_WORDS: Record<RenderCode, string> = {
  RENDER_INPUT_INVALID: "the Markdown was missing, so there was nothing to render",
  RENDER_FORMAT_REFUSED: `only ${RENDER_FORMATS.join(", ")} can be made`,
  RENDER_TOO_LARGE: "the Markdown is too long for one document; split it into parts",
  RENDER_UNAVAILABLE: "the document renderer did not start in time; try again in a minute",
  RENDER_FAILED: "the renderer could not convert this Markdown",
  RENDER_OUTPUT_INVALID: "the renderer's answer was not a valid file of that type",
};

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;
const DIR = "documents";
const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });
const err = (code: string, reason: string) => new Error(`${code}: ${reason}`);
const when = (at: number) => new Date(at).toISOString().replace(/:\d\d\.\d{3}Z$/, " UTC").replace("T", " ");

/** Where a rendered document is saved: `documents/<name>.<format>`, the extension added when missing. */
export function documentPath(name: string, to: RenderFormat): string | null {
  const base = name.toLowerCase().endsWith(`.${to}`) ? name.slice(0, -(to.length + 1)) : name;
  return NAME.test(base) ? `${DIR}/${base}.${to}` : null;
}

const RenderParams = Type.Object({
  markdown: Type.String({ minLength: 1, description: "The whole document in Markdown." }),
  // A plain string, so a format the Renderer does not make is refused by the Renderer's own code, in words.
  to: Type.String({ description: "The file type to make: docx (Word), odt (OpenDocument), html, or pptx (a deck: one slide per part of the Markdown between --- lines)." }),
  name: Type.String({ minLength: 1, maxLength: 60, description: "The file name without folder, such as quarterly-brief; it is saved under documents/." }),
});
const ListParams = Type.Object({});
const RevokeParams = Type.Object({ id: Type.String({ minLength: 1, description: "The share's id, as share_list gives it, or its whole /hooks/share/ link." }) });
/** A share id from its id or its whole public link. */
const idOf = (s: string) => /(?:^|\/hooks\/share\/)([0-9a-f]{32})(?:\.[0-9a-f]{64})?$/.exec(s.trim())?.[1] ?? s.trim();
const ShareParams = Type.Object({
  path: Type.String({ minLength: 1, description: "The file to share, such as documents/quarterly-brief.docx." }),
  minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: SHARE_MAX_MINUTES, description: `How long the link works, in minutes; ${SHARE_DEFAULT_MINUTES} (a day) when omitted, ${SHARE_MAX_MINUTES} (a week) at most.` })),
});

export function documentsNamespace(api: DocumentsApi, requester: string, effects: EffectBuffer): Namespace {
  const render: ToolSpec<typeof RenderParams> = {
    name: "render_document",
    kind: "observation",
    mutates: true,
    label: "Make a document",
    description: "Render Markdown to a Word (docx), OpenDocument (odt), html or PowerPoint (pptx, one slide per part between --- lines) file and save it in the person's Library under documents/. Say it is saved only after this returns.",
    parameters: RenderParams,
    execute: async (_id, p) => {
      const to = p.to as RenderFormat;
      const path = documentPath(p.name, (RENDER_FORMATS as readonly string[]).includes(to) ? to : "html");
      if (!path) throw err("RENDER_NAME_INVALID", "a name is letters, digits, dot, dash and underscore, up to 60 characters");
      const r = await api.render({ markdown: p.markdown, to });
      if (!r.ok) throw err(r.code, `the document was not made and nothing was saved: ${(RENDER_WORDS as Record<string, string>)[r.code] ?? r.reason}`);
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const saved = await api.save(r.to === "html" ? { path, text: new TextDecoder().decode(bytes), mediaType: r.mediaType } : { path, base64: r.base64, mediaType: r.mediaType }, requester);
      if (!saved.ok) throw err(saved.code, `the document was rendered but not saved: ${saved.reason}`);
      const link = await api.link({ path, download: true }, requester);
      const download = link.ok ? ` Download link for the person only, valid ${Math.round(LINK_TTL_MS / 60_000)} minutes: ${link.url}` : ` No download link was made (${link.code}); it opens from the Library.`;
      // B-P2-10: the reply links the file as markdown to `files/<path>`, which the chat draws as a file card (`thread-work.ts`).
      // F101 (F100's Reconcile 6, B-P11-04): a render over an existing document says it replaced it, as `file_write` does.
      const head = saved.replaced ? `REPLACED: saved ${path} (${r.to}, ${saved.size} bytes) in the person's Library; ${REPLACED_WORDS}.` : `SAVED: ${path} (${r.to}, ${saved.size} bytes) is in the person's Library.`;
      return text(`${head}${download} Link it in your reply as [${path.split("/").pop()}](files/${path}), which the chat shows as a file card.`, { path, to: r.to, bytes: saved.size });
    },
  };
  const share: ToolSpec<typeof ShareParams> = {
    name: "share_document",
    kind: "action",
    label: "Share a file by public link",
    description: "Make a public link anyone can open, to one of the person's files, for a number of minutes. The person approves each share on its own card; no standing permission ever covers it.",
    parameters: ShareParams,
    actionKind: "files.share",
    subject: (a) => ({ scope: "personal", connector: "files", resource: `file:${String(a.path ?? "")}` }),
    cardLines: async (a) => [`File: ${String(a.path ?? "")}`, `Anyone with the link can open it for ${lifeWords(Number(a.minutes ?? SHARE_DEFAULT_MINUTES))}.`],
    execute: async (id, p) => {
      const r = await api.share({ path: p.path, ...(p.minutes ? { minutes: p.minutes } : {}) }, requester);
      if (!r.ok) throw err(r.code, r.reason);
      const name = r.path.split("/").pop() ?? r.path;
      effects.push({ kind: "link", id: `${id}:share`, card: { id: `share:${r.id}`, kind: "share", title: `Shared publicly: ${name}`, text: `Anyone with this link can open ${name} until ${when(r.expiresAt)}. After that it stops working.`, href: r.url } });
      return text(`SHARED: ${r.path} at ${r.url}, open to anyone with the link until ${when(r.expiresAt)}.`, { share: r.id, expiresAt: r.expiresAt });
    },
  };
  // F101 (delta 6): the owner's shares read from the store, and one ended by id. A revoke narrows exposure, so it is an
  // observation with no card; it says revoked only from the store's answer.
  const list: ToolSpec<typeof ListParams> = {
    name: "share_list",
    kind: "observation",
    label: "List my share links",
    description: "List the person's public share links from the store: each one's id, file and expiry. A link's state is read here, never from a chat card.",
    parameters: ListParams,
    execute: async () => {
      const r = await api.shares(requester);
      if (!r.ok) throw err(r.code, r.reason);
      const live = r.shares.filter((s) => !s.expired);
      const lines = live.map((s) => `- ${s.id}: ${s.path}, expires ${when(s.expiresAt)}`);
      const gone = r.shares.length - live.length;
      const head = live.length ? `LIVE SHARES: ${live.length}` : "LIVE SHARES: none; no file of the person's is shared by a link that opens now";
      return text([head, ...lines, ...(gone ? [`${gone} expired link${gone === 1 ? "" : "s"} no longer open${gone === 1 ? "s" : ""}.`] : [])].join("\n"), { shares: live.map((s) => ({ id: s.id, path: s.path, expiresAt: s.expiresAt })) });
    },
  };
  const revoke: ToolSpec<typeof RevokeParams> = {
    name: "share_revoke",
    kind: "observation",
    mutates: true,
    label: "Revoke a share link",
    description: "End one of the person's public share links by its id (from share_list): afterwards the link opens nothing. The file stays. Say it is revoked only after this returns REVOKED.",
    parameters: RevokeParams,
    execute: async (_id, p) => {
      const r = await api.revoke(idOf(p.id), requester);
      if (!r.ok) throw err(r.code, `nothing was revoked: ${r.reason}`);
      return text(`REVOKED: the share link ${r.id} to ${r.path} is ended; it now opens nothing, as a link that never existed. ${r.path} itself is unchanged.${r.journaled ? "" : " No journal row was written for it."}`, { id: r.id, path: r.path });
    },
  };
  return { name: "documents", description: "make Word, OpenDocument, html or PowerPoint documents from Markdown; share a file by public link, list the links and revoke one", deferral: "names", tools: [render, share, list, revoke] as ToolSpec[] };
}
