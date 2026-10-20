// Serving a person's file by a signed link (M24.3). Two doors, one way of answering: the owner's
// download or preview link on M23.4's read route (`/app/file/raw?path=&exp=&sig=`, with the session),
// and the public share link (`/hooks/share/<token>`), which `serve.ts` answers before any session,
// under the hooks app's Access bypass. Neither decides anything: the person's own object checks the
// signature, the expiry and the content (`files/links.ts`) and this only answers with what it said.
// Nothing served is run: the type comes from the record or the extension, the browser may not sniff
// it, and the sandbox directive takes scripts and the origin away.
import type { ServedResult } from "../files/links.ts";
import { SHARE_PATH } from "../files/links.ts";
import { FILE_TYPES } from "./app-routes.ts";

const STATUS: Record<string, number> = {
  LINK_INVALID: 403, LINK_EXPIRED: 410, SHARE_INVALID: 403, SHARE_UNKNOWN: 404, SHARE_EXPIRED: 410, SHARE_CHANGED: 409,
  FILES_NOT_OWNER: 403, FILES_NOT_FOUND: 404, FILES_PATH_INVALID: 400, FILES_UNAVAILABLE: 503,
};
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** The answer for a served file or the refusal its owner gave, with its code. */
export function servedResponse(r: ServedResult, opts: { download: boolean; public?: boolean }): Response {
  if (!r.ok) return json({ code: r.code, reason: r.reason }, STATUS[r.code] ?? 400);
  const ext = r.path.split(".").pop()?.toLowerCase() ?? "";
  const name = r.path.split("/").pop()?.replace(/[^A-Za-z0-9._-]/g, "_") ?? "file";
  const headers: Record<string, string> = {
    "content-type": r.mediaType && !r.mediaType.startsWith("text/") ? r.mediaType : (FILE_TYPES[ext] ?? "text/plain; charset=utf-8"),
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    "cache-control": "no-store",
    "x-qyvr-complete": "true",
  };
  // A binary document is a download wherever it is opened; any other file only when asked.
  if (opts.download || (r.mediaType && !r.mediaType.startsWith("text/"))) headers["content-disposition"] = `attachment; filename="${name}"`;
  if (opts.public) {
    headers["referrer-policy"] = "no-referrer";
    headers["x-robots-tag"] = "noindex";
  }
  return new Response(r.bytes, { headers });
}

/** `GET /hooks/share/<token>` with no session; null when the path is not a share link. */
export async function shareRoute(request: Request, url: URL, shared: ((token: string) => Promise<ServedResult>) | undefined): Promise<Response | null> {
  if (!url.pathname.startsWith("/hooks/share/")) return null;
  const m = SHARE_PATH.exec(url.pathname);
  if (request.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  if (!m || !shared) return json({ code: "SHARE_UNKNOWN", reason: "no such share" }, 404);
  return servedResponse(await shared(m[1] as string), { download: url.searchParams.get("download") === "1", public: true });
}
