// The cost dashboard's routes (M15.3): `/app/dashboard` for the signed-in person's own numbers, their
// delivery items and their chats' compactions; `/admin/dashboard` for a company admin's view of the
// tenant. Each answers HTML, and JSON under `.json`. The person comes from the verified session; the
// stores behind `obs/dashboard.ts` decide who may read what.
import { adminDashboard, personDashboard, rangeOf, renderDashboard, type AdminDashboardDeps, type PersonDashboardDeps } from "../obs/dashboard.ts";

export interface DashboardDirectory {
  admin: AdminDashboardDeps;
  person(person: string): PersonDashboardDeps;
  now(): number;
}

const headers = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function dashboardRoutes(request: Request, url: URL, person: string, dir: DashboardDirectory | undefined): Promise<Response | null> {
  // The usage card's numbers (M23.3): the same Ledger rollup as the dashboard, for the session's person
  // only, without the compaction reads that make the dashboard slow in a person with many chats.
  if (url.pathname === "/app/usage.json" && request.method === "GET") {
    if (!dir) return json({ code: "NOT_FOUND" }, 404);
    const range = rangeOf(url.searchParams.get("days"), dir.now());
    if ("ok" in range) return json(range, 400);
    const rollup = await dir.person(person).ledger.dashboard({ ...range, person }, []);
    return json({ ok: true, view: "usage", person, days: range.days, totals: rollup.totals, runs: rollup.signals.runs });
  }
  const m = /^\/(app|admin)\/dashboard(\.json)?$/.exec(url.pathname);
  if (!m || request.method !== "GET") return null;
  if (!dir) return json({ code: "NOT_FOUND" }, 404);
  const range = rangeOf(url.searchParams.get("days"), dir.now());
  if ("ok" in range) return json(range, 400);
  const view = m[1] === "admin" ? await adminDashboard(dir.admin, person, range) : await personDashboard(dir.person(person), person, range);
  if (!view.ok) return json(view, /NOT_AN_ADMIN|NOT_OWNER/.test(view.code) ? 403 : 400);
  if (m[2]) return json(view);
  return new Response(renderDashboard(view), { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}
