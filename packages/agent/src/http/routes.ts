// The agent script's HTTP surface. Every route but /health serves a session `serve.ts` resolved through
// the host's identity (`hostOf(env).identity`) and the `Company`'s member list; each object it reaches decides access
// again where the data lives (the `Company` checks the inviter is an admin, the `Person` owns which
// chats are whose, the `Chat` admits only its owner, the `Ledger` returns only that person's rows).
// Nothing in a request names the person.
import type { InviteResult, Member } from "../company/members.ts";
import type { OpenResult } from "../person/chats.ts";
import type { Profile } from "../person/profile.ts";
import type { ModelCallRow } from "../ledger/types.ts";
import type { ServedResult } from "../files/links.ts";
import { OBJECT_CLASSES } from "../objects/names.ts";
import { type AuthorityDirectory, authorityRoutes } from "./authority-routes.ts";
import { type AdminDirectory, adminRoutes } from "./admin-routes.ts";
import { type LifecycleDirectory, lifecycleRoutes } from "./lifecycle-routes.ts";
import { isAdminRole } from "../company/members.ts";
import { type IngressStub, type MailDirectory, pushRoutes } from "./ingress-routes.ts";
import { PERSON_HEADER } from "./identity.ts";
import { hostOf } from "../host.ts";
import { APP_PAGE, MANIFEST, SERVICE_WORKER } from "./page.ts";
import { type VaultDirectory, vaultRoutes } from "./vault-routes.ts";
import { type DeliveryDirectory, deliveryRoutes } from "./delivery-routes.ts";
import { type AppDirectory, appRoutes } from "./app-routes.ts";
import { type DashboardDirectory, dashboardRoutes } from "./dashboard-routes.ts";

/** The session a route serves; `serve.ts` builds it, and only from a verified token. */
export interface AgentProps {
  tenant: string;
  person?: string;
  role?: Member["role"];
}

/** How routes reach the objects; production uses the Agents SDK's named stubs. */
export interface Directory {
  person(person: string): {
    openChat(): Promise<OpenResult>;
    ownsChat(chatId: string): Promise<boolean>;
    /** Owned, and recorded as the chat the person last had open (M17.1); false for anyone else's. */
    connectChat(chatId: string): Promise<boolean>;
    enroll?(input: { role: Profile["role"]; enrolledBy: string | null }): Promise<Profile>;
  };
  company(): {
    lookup(email: string): Promise<Member | null>;
    list(): Promise<Member[]>;
    invite(by: string, email: string, role: unknown): Promise<InviteResult>;
    resyncAccess(by: string): Promise<{ ok: boolean; code?: string }>;
  };
  chat(chatId: string): { fetch(request: Request): Promise<Response> };
  ledger(): { modelCalls(filter: { runId?: string; person: string }): Promise<ModelCallRow[]> };
  /** M6.1: a push source's `Ingress` by its id. */
  ingress?(id: string): IngressStub;
  /** M6.1: the seal check and the person's mail. */
  mail?: MailDirectory;
  /** M7.1: cards, grants, colleagues' requests, company policies. */
  authority?: AuthorityDirectory;
  /** M10.1: journals and ledgers for admins, refused personal reads, teams, roles, instructions, company memory. */
  admin?: AdminDirectory;
  /** M11.2: the promotion queue, memory import, offboarding, onboarding and a conversion's platform calls. */
  lifecycle?: LifecycleDirectory;
  /** M13: the capture form and the credential settings, writing as the signed-in person. */
  vault?: VaultDirectory;
  /** M14.1: push subscriptions, delivery feedback and preferences, as the signed-in person. */
  delivery?: DeliveryDirectory;
  /** M14.2: the chat list, approvals, library, jobs and loops of the app's pages. */
  app?: AppDirectory;
  /** M15.3: the cost dashboard, the person's own and a company admin's. */
  dashboard?: DashboardDirectory;
  /** M25.3: the dormant sweep over every object of the tenant, reached only through the dispatcher's platform call. */
  migrations?(): Promise<unknown>;
  /** M15.3: the sweeper's daily rollup, reached only through the dispatcher's platform call. */
  rollup?(day: unknown): Promise<unknown>;
  /** M24.3: a public share link's file, from the person who shared it; answered with no session (`serve.ts`). */
  share?(token: string): Promise<ServedResult>;
  /** M15.6: the render sidecar, reached only through the dispatcher's platform call. */
  render?(input: unknown): Promise<{ ok: boolean; code?: string }>;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function route(request: Request, env: Env, props: AgentProps | null, dir: Directory): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return json({ ok: true, tenant: env.TENANT_ID, objects: OBJECT_CLASSES });
  }
  // The script serves only its own tenant: props that name another are a platform fault.
  if (!props || props.tenant !== env.TENANT_ID) return json({ code: "TENANT_MISMATCH" }, 403);
  const person = props.person;
  if (!person) return json({ code: "NO_SESSION" }, 401);

  if (url.pathname === "/" && request.method === "GET") {
    return new Response(APP_PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (url.pathname === "/manifest.webmanifest" && request.method === "GET") {
    return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
  }
  if (url.pathname === "/sw.js" && request.method === "GET") {
    return new Response(SERVICE_WORKER, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
  }
  if (url.pathname === "/me" && request.method === "GET") {
    return json({ tenant: env.TENANT_ID, shape: hostOf(env).tenant.shape, person, role: props.role ?? null });
  }
  if (url.pathname === "/admin/members" && request.method === "GET") {
    // The Company decides: only an admin it lists sees the member list.
    if (!isAdminRole((await dir.company().lookup(person))?.role)) return json({ code: "NOT_AN_ADMIN" }, 403);
    return json({ members: await dir.company().list() });
  }
  if (url.pathname === "/admin/invites" && request.method === "POST") {
    const body = ((await request.json().catch(() => null)) ?? {}) as { email?: unknown; role?: unknown };
    const invited = await dir.company().invite(person, typeof body.email === "string" ? body.email : "", body.role);
    if (!invited.ok) return json({ code: invited.code }, invited.code === "NOT_AN_ADMIN" ? 403 : invited.code === "ALREADY_A_MEMBER" || invited.code === "SEATS_FULL" ? 409 : 400);
    // The invitation creates the Person; the Company has already told Access (M14.3), and a sync
    // that did not happen or failed is said with its code, never as admitted.
    const profile = await dir.person(invited.member.email).enroll?.({ role: invited.member.role, enrolledBy: person });
    const access = invited.access ?? { ok: false, code: "ACCESS_NOT_SYNCED", reason: "this directory's company does not sync Access" };
    return json({ member: invited.member, profile: profile ?? null, access }, 201);
  }
  if (url.pathname === "/admin/members/access" && request.method === "POST") {
    const synced = await dir.company().resyncAccess(person);
    return json(synced, synced.ok ? 200 : synced.code === "NOT_AN_ADMIN" ? 403 : 502);
  }
  if (url.pathname === "/chats" && request.method === "POST") {
    const opened = await dir.person(person).openChat();
    return opened.ok ? json({ chatId: opened.chatId }, 201) : json({ code: opened.code }, 409);
  }
  const ws = url.pathname.match(/^\/chats\/([^/]+)\/ws$/);
  if (ws && request.method === "GET") {
    const chatId = ws[1] as string;
    // Ownership first, so a chat's existence is not revealed to anyone else.
    if (!CHAT_ID.test(chatId) || !(await dir.person(person).connectChat(chatId))) return json({ code: "CHAT_NOT_FOUND" }, 404);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ code: "WEBSOCKET_REQUIRED" }, 426);
    const headers = new Headers(request.headers);
    headers.set(PERSON_HEADER, person);
    return dir.chat(chatId).fetch(new Request(request, { headers }));
  }
  const pushed = await pushRoutes(request, url, person, dir.ingress, dir.mail);
  if (pushed) return pushed;
  const authority = await authorityRoutes(request, url, person, dir.authority);
  if (authority) return authority;
  const dashboard = await dashboardRoutes(request, url, person, dir.dashboard);
  if (dashboard) return dashboard;
  const admin = await adminRoutes(request, url, person, dir.admin);
  if (admin) return admin;
  const lifecycle = await lifecycleRoutes(request, url, person, dir.lifecycle);
  if (lifecycle) return lifecycle;
  const vault = await vaultRoutes(request, url, person, dir.vault);
  if (vault) return vault;
  const delivery = await deliveryRoutes(request, url, person, dir.delivery);
  if (delivery) return delivery;
  const app = await appRoutes(request, url, person, dir.app);
  if (app) return app;
  if (url.pathname === "/ledger/calls" && request.method === "GET") {
    const runId = url.searchParams.get("run") ?? undefined;
    return json({ calls: await dir.ledger().modelCalls({ person, ...(runId ? { runId } : {}) }) });
  }
  return json({ code: "NOT_FOUND" }, 404);
}
