// The agent script's request path (M4.1): props must name this script's tenant; the dispatcher's
// own provisioning calls reach the platform routes; everything else is identified from the Access
// token (`identity.ts`) before any route runs. `/health` alone answers without a session.
import { OBJECT_CLASSES } from "../objects/names.ts";
import type { KeySource } from "./access.ts";
import { type DispatchProps, identify } from "./identity.ts";
import { HOOK_PATH, webhook } from "./ingress-routes.ts";
import { shareRoute } from "./share-routes.ts";
import { platformLifecycle } from "./lifecycle-routes.ts";
import { type Directory, route } from "./routes.ts";
import { log } from "../obs/log.ts";

export interface ServeDeps {
  dir: Directory;
  keys: KeySource;
  now(): number;
}

type ServeEnv = Pick<Env, "TENANT_ID" | "TENANT_SHAPE" | "QYVR_ENV" | "ACCESS_ISSUER" | "ACCESS_AUD" | "ACCESS_LIVE_CLIENT_ID">;

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function serve(request: Request, env: ServeEnv, props: DispatchProps | null, deps: ServeDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return json({ ok: true, tenant: env.TENANT_ID, objects: OBJECT_CLASSES });
  }
  // The script serves only its own tenant: props that name another are a platform fault.
  if (!props || props.tenant !== env.TENANT_ID) return json({ code: "TENANT_MISMATCH" }, 403);

  if (url.pathname.startsWith("/_platform/")) {
    // The dispatcher answers /_platform on a tenant host itself; only its own calls carry the flag.
    if (!props.platform) return json({ code: "NOT_FOUND" }, 404);
    if (url.pathname === "/_platform/members" && request.method === "GET") return json({ members: await deps.dir.company().list() });
    if (url.pathname === "/_platform/migrations" && request.method === "POST" && deps.dir.migrations) return json(await deps.dir.migrations());
    if (url.pathname === "/_platform/rollup" && request.method === "POST" && deps.dir.rollup) {
      const day = ((await request.json().catch(() => null)) as { day?: unknown } | null)?.day;
      const r = (await deps.dir.rollup(day)) as { ok: boolean; code?: string };
      return json(r, r.ok ? 200 : r.code === "ROLLUP_DAY_INVALID" ? 400 : 503);
    }
    if (url.pathname === "/_platform/render" && request.method === "POST" && deps.dir.render) {
      const r = await deps.dir.render(await request.json().catch(() => null));
      return json(r, r.ok ? 200 : r.code === "RENDER_UNAVAILABLE" || r.code === "RENDER_FAILED" ? 502 : 400);
    }
    const lifecycle = await platformLifecycle(request, url, { ...(deps.dir.lifecycle ? { lifecycle: deps.dir.lifecycle } : {}), isMember: async (e) => !!(await deps.dir.company().lookup(e)) });
    if (lifecycle) return lifecycle;
    return json({ code: "NOT_FOUND" }, 404);
  }

  // A public share link carries no session (M24.3): the sharing person's object checks its signature and expiry.
  const shared = await shareRoute(request, url, deps.dir.share);
  if (shared) return shared;

  // Webhooks carry no session: the source's signature is checked by its `Ingress` (M6.1).
  const hook = url.pathname.match(HOOK_PATH);
  if (hook && deps.dir.ingress) return webhook(request, hook[1] as string, deps.dir.ingress);

  const who = await identify(request, env, props, { keys: deps.keys, lookup: (email) => deps.dir.company().lookup(email), now: deps.now });
  if (!who.ok) {
    if (who.status === 503) log("identity.unavailable", { tenant: env.TENANT_ID, code: who.code }, "error");
    return json({ code: who.code, reason: who.reason }, who.status);
  }
  return route(request, env, { tenant: who.session.tenant, person: who.session.person, role: who.session.role }, deps.dir);
}
