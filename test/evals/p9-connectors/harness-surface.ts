// The tier-1 harness of the P9 tasks that grade F36's surfaces (T-P9-02, 08, 09, 10): `P9Tier1World` with the reads
// `P9SurfaceWorld` adds, each taken from what the person sees. The capture item is read from the shipped page script
// drawing the chat's history, its state fetched from the Vault's own route; the Connected rows and the Permissions rows
// from the app routes the panes draw; Dismiss and Disconnect are presses in the drawn page, whose requests reach the
// real routes as Sam. Turns, beside P9's:
//   - `dismiss` (payload `ref`): Sam presses Dismiss on the capture item for `ref` in `c1`;
//   - `disconnect` (payload `host`): Sam opens Settings > Connectors, the row for `host`, and presses Disconnect.
import { credentialsNamed } from "../../../packages/agent/src/grants/authority.ts";
import { inForce } from "../../../packages/agent/src/grants/engine.ts";
import type { Snapshot } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { type El, page } from "../../workers/support/page-harness.ts";
import { type P9HarnessOptions, P9Tier1World, sam } from "./harness.ts";
import type { ChatLabel, P9SurfaceWorld, P9World } from "./world.ts";
import { CODE } from "./world.ts";

const settle = async () => {
  for (let i = 0; i < 80; i++) await new Promise((r) => setImmediate(r));
};
/** Every node under `n`, depth first. */
const under = (n: El): El[] => n.children.flatMap((c) => [c, ...under(c)]);
const pressed = async (b: El | undefined, what: string) => {
  if (!b?.onclick) throw new Error(`P9_NOT_DRAWN: ${what}`);
  await b.onclick();
  await settle();
};

export class P9SurfaceTier1World extends P9Tier1World implements P9SurfaceWorld {
  /** The page's requests: the Vault's routes and the app's, as Sam from the page's own origin. */
  private readonly pageFetch = async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === "/vault" || path.startsWith("/vault/") || path.startsWith("/vault?")) {
      const r = await this.vaultHttp(method, path, body !== undefined ? { json: body } : undefined);
      return new Response(r.text, { status: r.status, headers: { "content-type": r.text.startsWith("{") ? "application/json" : "text/html" } });
    }
    const r = await this.w.http(sam.email, method, path, body);
    return new Response(JSON.stringify(r.body), { status: r.status });
  };

  /** A tab open on a chat, drawn from its history as a reload draws it. */
  private async chatPage(chat: ChatLabel) {
    const pg = await page({ onSend() {}, fetch: this.pageFetch }, { desktop: true }, this.plantPage);
    const s = pg.sockets[0] as NonNullable<(typeof pg.sockets)[0]>;
    pg.open(s);
    pg.deliver(s, { type: "history", ...this.engine(chat).history() });
    await settle();
    return pg;
  }

  private async drawnItem(chat: ChatLabel, ref?: string) {
    const pg = await this.chatPage(chat);
    return under(pg.log).filter((n) => /\bcapture-item\b/.test(n.className) && (ref === undefined || n.dataset.ref === ref)).at(-1) ?? null;
  }

  async play(turn: Turn): Promise<void> {
    if (turn.kind !== "event" || (turn.name !== "dismiss" && turn.name !== "disconnect")) return super.play(turn);
    this.marks[turn.name] = this.network.sent.length;
    const p = (turn.payload ?? {}) as Record<string, string>;
    if (turn.name === "disconnect") return this.disconnect(p.host as string);
    const item = await this.drawnItem("c1", p.ref);
    await pressed(item ? under(item).find((n) => n.tag === "button" && n.text() === "Dismiss") : undefined, `Dismiss on ${p.ref}`);
    if (item?.dataset.state !== "dismissed") throw new Error(`P9_DISMISS_REFUSED: ${item?.dataset.state}`);
  }

  /**
   * The Vault as these tasks change it: its credentials' lifecycle events (`<kind>:<event>`, `none` where no secret row
   * exists) and the audit rows, both append-only, so a disconnect or a dismiss is an added row, never a row gone. A
   * provider's `rejected` answer belongs to the use its audit row already counts, so it is not counted again; the rest
   * as P9's.
   */
  async snapshot(): Promise<Snapshot> {
    const base = await super.snapshot();
    const events = this.vaultH.rows("SELECT e.event, s.kind FROM vault_events e LEFT JOIN secrets s ON s.owner = e.owner AND s.ref = e.ref WHERE e.event != 'rejected' ORDER BY e.id").map((r) => `${r.kind ?? "none"}:${String(r.event)}`);
    return { ...base, vault: [...events, ...this.auditRows().map((a) => `audit:${a.host}:${a.outcome}`)] };
  }

  async captureItem(chat: ChatLabel = "c1") {
    const item = await this.drawnItem(chat);
    if (!item) return null;
    const line = item.children.find((n) => n.tag === "p");
    return { host: item.dataset.host ?? "", kind: item.dataset.kind ?? "", state: line?.text() ?? "", dismiss: under(item).some((n) => n.tag === "button" && n.text() === "Dismiss") };
  }

  async captureLink(ref: string) {
    const host = this.results("c1").map((r) => /\/vault\/capture\?\S+/.exec(r.text)?.[0]).filter((l): l is string => !!l && l.includes(encodeURIComponent(ref))).at(-1);
    const r = await this.vaultHttp("GET", host ?? `/vault/capture?ref=${encodeURIComponent(ref)}`);
    return { status: r.status, code: r.status >= 400 ? (CODE.exec(r.text)?.[0] ?? null) : null };
  }

  async connectedRows() {
    const r = await this.w.http(sam.email, "GET", "/app/connectors");
    const yours = (r.body.yours as Array<{ name: string; status: string; lastUse: string | null; outcome: string | null }> | undefined) ?? [];
    return yours.map((y) => ({ host: y.name, status: y.status, lastUse: y.lastUse, outcome: y.outcome }));
  }

  /** Settings > Connectors, the host's row, then Disconnect on its page: the presses Sam makes. */
  async disconnect(host: string): Promise<void> {
    const pg = await page({ onSend() {}, fetch: this.pageFetch }, { desktop: true }, this.plantPage);
    await settle();
    for (const id of ["to-settings", "settings-menu-open", "set-nav-connectors", "conn-connected"]) await pressed(pg.byId(id), id);
    const row = under(pg.byId("conn-list")).find((n) => n.dataset.id === `host:${host}`);
    await pressed(row ? under(row).find((n) => n.tag === "button") : undefined, `the Connected row for ${host}`);
    await pressed(under(pg.byId("connector-disconnect")).find((n) => n.id === "connector-disconnect-go"), `Disconnect on ${host}`);
  }

  authorityGrants() {
    const now = this.w.clock.now;
    return this.w.host(sam.email).authority.all()
      .filter((g) => credentialsNamed(g).length > 0)
      .map((g) => ({ id: g.id, names: credentialsNamed(g).join(" "), state: g.revoked_at !== undefined ? "revoked" : g.one_shot && g.used_at !== undefined ? "spent" : inForce(g, now) ? "active" : "expired" }));
  }

  async permissions() {
    const r = await this.w.http(sam.email, "GET", "/app/permissions");
    const g = r.body.grants as { ok: boolean; rows: Array<{ kind: string; covers: string; lifetime: string; made: string }>; counts: Record<string, number> };
    if (!g?.ok) throw new Error(`P9_PERMISSIONS_UNREAD: ${JSON.stringify(r.body.grants)}`);
    return { rows: g.rows.map((x) => ({ kind: x.kind, covers: x.covers, lifetime: x.lifetime, made: x.made })), counts: g.counts };
  }
}

export function p9SurfaceHarness(o: P9HarnessOptions): TaskHarness<P9SurfaceWorld> {
  return {
    setup: async () => {
      const w = new P9SurfaceTier1World(o);
      await w.open();
      await o.seed?.(w);
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P9SurfaceTier1World).play(turn),
  };
}

/** The task's turns played through `p9SurfaceHarness(o)`, and the world after them. */
export async function playedSurface(task: DefinedTask<P9SurfaceWorld>, o: P9HarnessOptions): Promise<P9SurfaceTier1World> {
  const h = p9SurfaceHarness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task as unknown as DefinedTask<P9World>)) as P9SurfaceTier1World;
  for (const t of task.turns) await h.play(world, t, rng);
  return world;
}
