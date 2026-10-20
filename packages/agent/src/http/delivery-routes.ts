// Push subscriptions, delivery feedback and preferences (M14.1), for the signed-in person only. The
// `Person` decides every call against its own person; the route only carries the session's identity,
// and writes must come from the app's own page, as the vault's do. The VAPID public key is the
// `Vault`'s; nothing here can read its private half.
import type { DeliveryCall } from "../delivery/service.ts";

export interface DeliveryDirectory {
  pushKey(): Promise<{ ok: true; key: string } | { ok: false; code: string; reason: string }>;
  call(person: string, call: DeliveryCall): Promise<unknown>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const sameOrigin = (request: Request, url: URL) => request.headers.get("origin") === url.origin;
const statusOf = (r: unknown) => {
  const code = (r as { ok?: boolean; code?: string }).ok === false ? (r as { code: string }).code : null;
  if (!code) return 200;
  if (code === "DELIVERY_NOT_OWNER") return 403;
  if (code === "DELIVERY_ITEM_UNKNOWN") return 404;
  if (code === "DELIVERY_NOT_DELIVERED") return 409;
  return /^(PUSH|DELIVERY)_/.test(code) ? 400 : 502;
};

const WRITES: Record<string, (b: Record<string, unknown>) => DeliveryCall> = {
  "/push/subscribe": (b) => ({ op: "subscribe", subscription: b.subscription }),
  "/push/test": () => ({ op: "test_push" }),
  "/push/unsubscribe": (b) => ({ op: "unsubscribe", endpoint: b.endpoint }),
  "/delivery/feedback": (b) => ({ op: "feedback", id: b.id, verdict: b.verdict }),
  "/delivery/preferences": (b) => ({ op: "preferences", stop: b.stop, allow: b.allow, zone: b.zone, mail: b.mail }),
};

export async function deliveryRoutes(request: Request, url: URL, person: string, dir: DeliveryDirectory | undefined): Promise<Response | null> {
  const write = WRITES[url.pathname];
  if (!write && url.pathname !== "/push/key" && url.pathname !== "/delivery") return null;
  if (!dir) return json({ code: "NOT_FOUND" }, 404);
  if (request.method === "GET" && url.pathname === "/push/key") {
    const k = await dir.pushKey();
    return k.ok ? json({ key: k.key }) : json({ code: k.code }, 503);
  }
  if (request.method === "GET" && url.pathname === "/delivery") {
    const v = await dir.call(person, { op: "view" });
    return json(v, statusOf(v));
  }
  if (!write || request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  if (!sameOrigin(request, url)) return json({ code: "DELIVERY_ORIGIN" }, 403);
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const r = await dir.call(person, write(body));
  return json(r, statusOf(r));
}
