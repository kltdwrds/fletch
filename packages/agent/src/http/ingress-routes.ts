// Push and mail routes (M6.1). The webhook route is public and answers before any session:
// its signature is its authentication, checked by the source's own `Ingress`, which logs a refusal.
// The rest serve a session: a person creates, inspects and switches their own sources and sends mail
// from their own chats; each object decides ownership again where the data lives.
import type { Created, IngressRefusal } from "../ingress/engine.ts";
import type { SourceKind } from "../ingress/store.ts";
import type { InboundMail, OutboundMail, ReceiveResult } from "../person/mail.ts";

export interface IngressStub {
  create(a: { id: string; owner: string; kind: SourceKind; jobs: string[]; dryRun?: boolean; url?: string }): Promise<Created>;
  webhook(headers: Record<string, string | undefined>, body: string): Promise<{ status: number; code: string; reason?: string }>;
  inspect(by: string): Promise<{ ok: true } | IngressRefusal>;
  setDryRun(by: string, dryRun: boolean): Promise<{ ok: true } | IngressRefusal>;
  start(by: string): Promise<{ ok: true } | IngressRefusal>;
  stop(by: string): Promise<{ ok: true } | IngressRefusal>;
}

/** How mail routes reach the person's objects; sending goes out through the host's mail (`hostOf(env).mail`). */
export interface MailDirectory {
  deliver(person: string, m: InboundMail): Promise<ReceiveResult>;
  send(person: string, m: OutboundMail): Promise<unknown>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const SOURCE_ID = /^[0-9a-f]{32}$/;
export const HOOK_PATH = /^\/hooks\/([^/]+)$/;
const SIGNED = ["webhook-id", "webhook-timestamp", "webhook-signature"] as const;
const OWNER_STATUS: Record<string, number> = { INGRESS_UNKNOWN: 404, INGRESS_NOT_OWNER: 404, INGRESS_EXISTS: 409 };

/** `POST /hooks/<id>`: the signed headers and the body, nothing else, go to the source's `Ingress`. */
export async function webhook(request: Request, id: string, ingress: (id: string) => IngressStub): Promise<Response> {
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  if (!SOURCE_ID.test(id)) return json({ code: "INGRESS_UNKNOWN" }, 404);
  const headers: Record<string, string | undefined> = {};
  for (const name of SIGNED) headers[name] = request.headers.get(name) ?? undefined;
  const answer = await ingress(id).webhook(headers, await request.text());
  return json({ code: answer.code, ...(answer.reason ? { reason: answer.reason } : {}) }, answer.status);
}

/** The session routes under `/api/hooks` and `/api/mail`; null when the path is not one of them. */
export async function pushRoutes(request: Request, url: URL, person: string, ingress: ((id: string) => IngressStub) | undefined, mail: MailDirectory | undefined): Promise<Response | null> {
  const body = async () => ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (url.pathname === "/api/mail" && request.method === "POST") {
    if (!mail) return json({ code: "NOT_FOUND" }, 404);
    const b = await body();
    const r = (await mail.send(person, { to: String(b.to ?? ""), subject: String(b.subject ?? ""), text: String(b.text ?? ""), chatId: String(b.chatId ?? "") })) as { ok: boolean; code?: string };
    return json(r, r.ok ? 202 : r.code === "MAIL_QUOTA_EXHAUSTED" ? 429 : 400);
  }
  if (!url.pathname.startsWith("/api/hooks")) return null;
  if (!ingress) return json({ code: "NOT_FOUND" }, 404);
  if (url.pathname === "/api/hooks" && request.method === "POST") {
    const b = await body();
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const created = await ingress(id).create({
      id, owner: person, kind: b.kind as SourceKind, jobs: Array.isArray(b.jobs) ? (b.jobs as string[]) : [], dryRun: b.dryRun === true, ...(typeof b.url === "string" ? { url: b.url } : {}),
    });
    return json(created, created.ok ? 201 : (OWNER_STATUS[created.code] ?? 400));
  }
  const m = url.pathname.match(/^\/api\/hooks\/([0-9a-f]{32})(\/dry-run|\/start|\/stop)?$/);
  if (!m) return json({ code: "NOT_FOUND" }, 404);
  const stub = ingress(m[1] as string);
  let r: { ok: true } | IngressRefusal;
  if (!m[2] && request.method === "GET") r = await stub.inspect(person);
  else if (m[2] === "/dry-run" && request.method === "POST") r = await stub.setDryRun(person, (await body()).dryRun === true);
  else if (m[2] === "/start" && request.method === "POST") r = await stub.start(person);
  else if (m[2] === "/stop" && request.method === "POST") r = await stub.stop(person);
  else return json({ code: "NOT_FOUND" }, 404);
  return json(r, r.ok ? 200 : (OWNER_STATUS[r.code] ?? 400));
}
