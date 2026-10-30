// T-P14-04 under vitest (F41): Settings > Security in hermetic Chromium over the production `serve()` and the host's
// passkey routes (`harness-security.ts`), then each minefield planted on that request path and seen to trip it.
import { SESSION_COOKIE } from "@qyvr/host-cloudflare";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Seeded } from "../../support/seeded.ts";
import { runTask } from "../../support/task.ts";
import { type Plant, p14SecurityHarness } from "./harness-security.ts";
import task from "./security-pane-reads-the-routes.task.ts";
import type { P14SecurityWorld } from "./world.ts";

// Seven Chromium contexts and a reload on one run, with the redraws: past the default 5 s on a loaded run.
vi.setConfig({ testTimeout: 120_000 });
const h = p14SecurityHarness();
const planted: Array<{ close(): Promise<void> }> = [];
afterAll(async () => {
  await h.close();
  for (const p of planted) await p.close();
});

/** The task's turns on a harness with `plant` in the request path, and each grader's verdict (a minefield true when stepped on). */
async function steppedOn(plant: Plant): Promise<Record<string, boolean>> {
  const ph = p14SecurityHarness({ plant });
  planted.push(ph);
  const rng = new Seeded(task.setup.seed);
  const w = (await ph.setup(rng, task)) as P14SecurityWorld;
  for (const t of task.turns) await ph.play(w, t, rng);
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = await g.check(w);
  return out;
}

const path = (r: Request) => new URL(r.url).pathname;

describe("[F41] P14 identity: T-P14-04", () => {
  runTask(task, h);

  it("the pane as drawn: Sam's passkeys by the date each was added, Remove named by date, the refusals in the specimen's words with their codes", async () => {
    const w = h.last()!;
    const sam = w.pane.filter((p) => p.as === "sam");
    expect(sam.map((p) => p.width)).toEqual(["desktop", "phone"]);
    for (const p of sam) {
      expect(p.rows).toEqual(["Passkey Added 3 March 2026 Remove", "Passkey Added 14 September 2026 Remove"]);
      expect(p.dom).toContain('aria-label="Remove the passkey added 3 March 2026"');
      expect(p.words).toContain("A passkey is how you sign in here. Keep at least two, on different devices.");
      expect(p.words).toContain("Replaced when a passkey is added after a recovery sign-in. It is not readable here.");
      expect(p.dom).not.toMatch(/passkey-1|passkey-2/);
    }
    const recovery = w.pane.find((p) => p.as === "sam-recovery")!;
    expect(recovery.rows).toEqual([]);
    expect(recovery.words).toContain("Add a passkey first. A recovery sign-in cannot manage passkeys. PASSKEY_REQUIRED");
    expect(recovery.words).toContain("Add a passkey");
    expect(recovery.words).not.toMatch(/Sessions|Recovery code/);
    const pat = w.pane.find((p) => p.as === "pat")!;
    expect(pat.words).toContain("Only the owner manages passkeys. LOGIN_OWNER_REQUIRED");
    expect(pat.words).not.toMatch(/Add a passkey|A passkey is how/);
    // A recovery session cannot load the app itself; the host refuses it by name.
    expect(w.refusedLoad).toEqual({ status: 403, code: "PASSKEY_REQUIRED" });
    expect(w.removed.map((r) => [r.id, r.status, r.code, r.rowsAfter])).toEqual([
      ["passkey-1", 204, null, 1],
      ["passkey-2", 409, "LOGIN_LAST_PASSKEY", 1],
    ]);
    // Add a passkey is the sign-in page in its add state for the owner's session.
    expect([w.added, w.addState]).toEqual(["/login", "add"]);
  });

  it("key_drawn: a pane that draws what the route holds beyond the date is caught", async () => {
    const plant: Plant = (handle) => async (r) => {
      const res = await handle(r);
      if (path(r) === "/login/passkeys" && r.method === "GET" && res.ok) {
        const b = (await res.json()) as { passkeys: Array<{ id: string; at: number }> };
        return Response.json({ ok: true, passkeys: b.passkeys.map((p) => ({ ...p, publicKey: "pQECAyYgASFYIA", counter: 0 })) });
      }
      if (!(res.headers.get("content-type") ?? "").includes("text/html") || !r.url.includes("/settings")) return res;
      const html = (await res.text()).replace('SETTINGS.added.replace("{date}", day)', "JSON.stringify(p)");
      return new Response(html, { status: res.status, headers: res.headers });
    };
    const v = await steppedOn(plant);
    expect(v.key_drawn).toBe(true);
  });

  it("last_removed: a route that removes the last passkey is caught", async () => {
    const plant: Plant = (handle, d) => async (r) => {
      const m = /^\/login\/passkeys\/([^/]+)$/.exec(path(r));
      if (r.method === "DELETE" && m) {
        await d.company.loginCall({ op: "remove", id: decodeURIComponent(m[1]!) });
        return new Response(null, { status: 204 });
      }
      return handle(r);
    };
    const v = await steppedOn(plant);
    expect(v.last_removed).toBe(true);
  });

  it("recovery_session_manages and non_owner_manages: routes that answer any session as the owner's are caught", async () => {
    const plant: Plant = (handle, d) => async (r) => {
      if (!path(r).startsWith("/login/passkeys")) return handle(r);
      const headers = new Headers(r.headers);
      headers.set("cookie", `${SESSION_COOKIE}=${d.tokens.sam}`);
      return handle(new Request(r.url, { method: r.method, headers }));
    };
    const v = await steppedOn(plant);
    expect([v.recovery_session_manages, v.non_owner_manages]).toEqual([true, true]);
  });

  it("no_route: a grammar without /settings/security is caught", async () => {
    const plant: Plant = (handle) => async (r) => {
      const res = await handle(path(r) === "/settings/security" ? new Request(r.url.replace("/settings/security", "/settings/nope"), { headers: r.headers }) : r);
      if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
      return new Response((await res.text()).replaceAll("|security|", "|"), { status: res.status, headers: res.headers });
    };
    const v = await steppedOn(plant);
    expect(v.no_route).toBe(true);
  });
});
