// M27.6: the Settings panes on the Fletch system (General, Connectors and a connector, Permissions, Devices,
// Messaging channels, Help & support, Company and Background work, Log out). The page is the shipped script under the
// page harness; its requests go to the agent script's real routes as Ada (an admin) or Bo (a member) of solo-sam:
// the authority world's (members, connectors, grants, usage), the delivery world's real `PersonDelivery` for
// `/delivery` and `/push/*`, the real capture route over a real `VaultCore` for `/vault/capture`, and each member's
// real `LoopSettings` (through `PersonLoops`, which checks the owner) for `/app/loops`. What a pane shows for one
// person is the owning store's answer for that person. The pixels are `pnpm screens` against the boards.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECTORS_TEXT, PERMISSIONS_TEXT } from "../../packages/agent/src/http/app/permission-words.ts";
import { COMPANY_PANE, DEVICES_PANE, GENERAL_PANE, HELP_PANE, LOOPS_PANE, MESSAGING_PANE, REPORT_DIALOG } from "../../packages/agent/src/http/app/settings-panes.ts";
import { MODE_KEY, NESTED_PANES, SETTINGS_PANES, SETTINGS_TEXT } from "../../packages/agent/src/http/app/settings.ts";
import { dashboardRoutes } from "../../packages/agent/src/http/dashboard-routes.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { type VaultDirectory, vaultRoutes } from "../../packages/agent/src/http/vault-routes.ts";
import type { PersonDashboardDeps } from "../../packages/agent/src/obs/dashboard.ts";
import { VaultCore } from "../../packages/agent/src/vault/core.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld, TENANT } from "./support/authority-world.ts";
import { deliveryWorld } from "./support/delivery-world.ts";
import { personLoopWorld } from "./support/loop-world.ts";
import { type El, page } from "./support/page-harness.ts";
import { keysFor, testMasterKey } from "./support/vault-harness.ts";

const settle = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
type Layout = Parameters<typeof page>[1];
let n = 0;

/** One company's stores: the authority world, delivery, a real Vault and the members' loop settings. */
function stores(script: FakeStep[] = []) {
  const vaultH = new ObjectHarness(`vault-m27-6-${++n}`, (ctx) => new VaultCore(ctx as never, { tenant: TENANT, keys: keysFor(TENANT, testMasterKey()), fetch: async () => { throw new Error("HERMETIC: no network"); }, now: () => Date.UTC(2026, 9, 19, 12) }), {});
  const vault = () => vaultH.instance;
  const vdir = { capture: (i, w) => vault().capture(i, w), list: async (p) => vault().list(p), grants: async (p) => vault().grants(p) } as VaultDirectory;
  const w = authorityWorld({ script, credentials: async (p) => vault().list(p) });
  const d = deliveryWorld();
  const lw = personLoopWorld();
  return { w, d, lw, vault, vdir };
}
type Stores = ReturnType<typeof stores>;
const ORIGIN = `https://${TENANT}.example`;

/**
 * A person's page whose requests go to the stores' real routes as that person; every request is recorded. With
 * \`grantsAs\`, the grants routes see another session's person: the store, not the page, decides whose grant it is.
 */
async function pageOf(s: Stores, person: string, layout: Layout = {}, grantsAs?: string) {
  const sent: Array<{ path: string; method: string; body: unknown }> = [];
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const method = init?.method ?? "GET";
        const raw = init?.body as unknown;
        sent.push({ path, method, body: raw instanceof URLSearchParams ? Object.fromEntries(raw) : raw ? JSON.parse(String(raw)) : undefined });
        if (path === "/vault/capture") {
          const req = new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN }, body: raw as URLSearchParams });
          return vaultRoutes(req, new URL(req.url), person, s.vdir);
        }
        const body = raw && !(raw instanceof URLSearchParams) ? JSON.parse(String(raw)) : undefined;
        if (/^\/(delivery|push)(\/|$)/.test(path)) return s.d.http(person, method, path, body);
        if (path.startsWith("/app/usage.json")) {
          const req = new Request(`${ORIGIN}${path}`);
          return dashboardRoutes(req, new URL(req.url), person, { person: () => ({ ledger: s.w.ledger() }) as unknown as PersonDashboardDeps, now: () => s.w.clock.now, admin: {} as never });
        }
        if (path === "/app/loops") {
          const loops = s.lw.of(person).loops;
          const r = method === "POST" ? loops.setLoop(person, body.loop, { enabled: body.enabled, budget: body.budget }) : loops.settings(person);
          return new Response(JSON.stringify(r), { status: r.ok ? 200 : 400 });
        }
        const r = await s.w.http(grantsAs && path.startsWith("/api/grants/") ? grantsAs : person, method, path, body);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    layout,
  );
  await settle();
  return Object.assign(p, { sent });
}
type Page = Awaited<ReturnType<typeof pageOf>>;

const click = async (p: Page, id: string) => {
  await p.byId(id).onclick?.();
  await settle();
};
/** Settings open on a pane, on a desktop. */
async function openPane(p: Page, pane: string) {
  await click(p, "to-settings");
  await click(p, "settings-menu-open");
  await click(p, `set-nav-${pane}`);
}
/** A pane's groups as [label, [row text…]]: what the person reads, group by group. */
const groups = (host: El) => host.children.map((g) => [g.children[0]?.text() ?? "", (g.children[1]?.children ?? []).map((r) => r.text())]);
/** The first button inside a node, depth first, whose text is `label`. */
const buttonIn = (node: El, label: string): El | undefined => {
  for (const c of node.children) {
    if (c.tag === "button" && c.text() === label) return c;
    const hit = buttonIn(c, label);
    if (hit) return hit;
  }
  return undefined;
};
const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dialogMarkup = () => APP_PAGE.slice(APP_PAGE.indexOf('<div id="set-dialog"'), APP_PAGE.indexOf('<div id="confirm"'));

afterEach(() => vi.unstubAllGlobals());

describe("[M27.6] the panes' ids", () => {
  it("keeps the rows, form and push ids, drops the old Back circles and the Notifications row, and adds the new ones", () => {
    const dlg = dialogMarkup();
    for (const id of ["set-connectors", "set-permissions", "set-devices", "set-help", "set-report", "set-home", "conn-list", "conn-available", "conn-connected", "conn-count", "conn-search", "connector-groups", "connector-name", "perm-defaults", "perm-grants", "perm-to-connectors", "push-on", "push-test", "push-result", "device-state", "device-others", "delivery-form", "stopped-table", "stopped-note", "loop-table", "loop-result", "invite", "invite-email", "invite-role", "invite-result", "members", "logout"]) expect(ids(dlg), id).toContain(id);
    for (const id of ["set-messaging", "set-company", "set-loops", "set-appearance", "report-form", "conn-connect-form", "mode-light", "mode-dark", "mode-system", "conn-connect", "report"]) expect(ids(dlg), id).toContain(id);
    expect(APP_PAGE).not.toMatch(/id="(set-notifications|connectors-back|connector-back|permissions-back|set-members|perm-to-other)"/);
    // The DESIGN-ONLY controls are not drawn: no Wallet, Secure store, Data controls, Legal, Language, Upgrade, Redeem,
    // Accounts Center, swatches, WhatsApp, a mode Select or Submit feedback.
    expect(dlg).not.toMatch(/Wallet|Secure store|Data controls|Legal|Language|Upgrade|Redeem|Accounts Center|qf-swatches|WhatsApp|Submit feedback|qf-select"[^>]*>(Allow|Ask|Deny)/);
    // Every pane is the system's grouped cards.
    expect(dlg).toContain('class="qf-grpcard"');
  });
});

describe("[M27.6] General", () => {

  it("each row opens its pane, and Company and Background work are nested under General with Back to it", async () => {
    const p = await pageOf(stores(), ada.email, { desktop: true });
    await click(p, "to-settings");
    await click(p, "settings-menu-open");
    const shown = () => [...SETTINGS_PANES, ...Object.keys(NESTED_PANES)].filter((k) => !p.byId(`set-pane-${k}`).hidden);
    for (const [row, pane] of [["set-connectors", "connectors"], ["set-permissions", "permissions"], ["set-devices", "devices"], ["set-messaging", "messaging"]] as const) {
      await click(p, "set-nav-general");
      await click(p, row);
      expect(shown(), row).toEqual([pane]);
    }
    for (const [row, pane, title] of [["set-company", "company", "Company"], ["set-loops", "loops", "Background work"]] as const) {
      await click(p, "set-nav-general");
      await click(p, row);
      expect([shown(), p.byId("set-title").textContent, p.byId("set-nav-general").attrs["aria-current"], p.byId("set-top").className]).toEqual([[pane], title, "page", "qf-set-top has-back"]);
      await click(p, "set-back");
      expect(shown()).toEqual(["general"]);
    }
  });

  it("the mode row: Light, Dark or System is kept in this browser and applied to the body; System follows the scheme", async () => {
    const kept = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) });
    const s = stores();
    const p = await pageOf(s, ada.email, { desktop: true, dark: true });
    expect(p.byId("body").attrs["data-theme"]).toBe("dark");
    await click(p, "to-settings");
    await click(p, "settings-menu-open");
    const checked = () => ["light", "dark", "system"].filter((k) => p.byId(`mode-${k}`).attrs["aria-checked"] === "true");
    expect(checked()).toEqual(["system"]);
    await click(p, "mode-light");
    expect([checked(), p.byId("body").attrs["data-theme"], kept.get(MODE_KEY)]).toEqual([["light"], "light", "light"]);
    // A reload keeps it, though the scheme is dark.
    const again = await pageOf(s, ada.email, { desktop: true, dark: true });
    expect(again.byId("body").attrs["data-theme"]).toBe("light");
    await click(again, "to-settings");
    await click(again, "settings-menu-open");
    await click(again, "mode-system");
    expect([again.byId("body").attrs["data-theme"], kept.get(MODE_KEY)]).toEqual(["dark", "system"]);
  });

  it("a browser that will not store the mode still applies the pick on this page", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); } });
    const p = await pageOf(stores(), ada.email, { desktop: true });
    expect(p.byId("body").attrs["data-theme"]).toBe("light");
    await click(p, "to-settings");
    await click(p, "settings-menu-open");
    await click(p, "mode-dark");
    expect([p.byId("body").attrs["data-theme"], p.byId("mode-dark").attrs["aria-checked"]]).toEqual(["dark", "true"]);
  });
});

describe("[M27.6] Connectors", () => {
  it("Available lists the capture kinds with Connect; Connected · n the member's own, grouped; a search with no match says so", async () => {
    const p = await pageOf(stores(), ada.email, { desktop: true });
    await openPane(p, "connectors");
    expect([p.byId("conn-available").attrs["aria-pressed"], p.byId("conn-connected").attrs["aria-pressed"], p.byId("conn-count").textContent]).toEqual(["true", "false", " · 2"]);
    expect(groups(p.byId("conn-list"))).toEqual([[CONNECTORS_TEXT.available, ["K API key or token Let your agent call a service you have a key for. Connect", "L Login password Let your agent sign in to a site for you. Connect"]]]);
    await click(p, "conn-connected");
    expect(groups(p.byId("conn-list"))).toEqual([[CONNECTORS_TEXT.builtIn, ["Browser Built in View", "H Hacker News Built in View"]]]);
    p.byId("conn-search").value = "zzz";
    await p.byId("conn-search").oninput?.();
    expect([p.byId("conn-list").children.length, p.byId("conn-note").textContent]).toEqual([0, CONNECTORS_TEXT.noMatch]);
  });

  it("a capture the vault refuses is said in words with its code, nothing is saved and the value is cleared", async () => {
    const s = stores();
    const p = await pageOf(s, ada.email, { desktop: true });
    await openPane(p, "connectors");
    await (buttonIn(p.byId("conn-list"), CONNECTORS_TEXT.connect) as El).onclick?.();
    p.byId("conn-connect-ref").value = "not a reference";
    p.byId("conn-connect-host").value = "api.github.com";
    p.byId("conn-connect-value").value = "sk-bo-0002";
    await p.byId("conn-connect-form").onsubmit?.({ preventDefault() {} });
    await settle();
    expect([p.byId("conn-connect").hidden, p.byId("conn-connect-result").textContent, p.byId("conn-connect-value").value]).toEqual([false, CONNECTORS_TEXT.notSaved, ""]);
    expect(p.byId("conn-connect-result").dataset.code).toMatch(/^VAULT_/);
    expect(await s.vault().list(ada.email)).toEqual([]);
  });
});

describe("[M27.6] Permissions", () => {
  it("the defaults are option rows with the check on the rule in force; the connectors list opens each connector's pane", async () => {
    const p = await pageOf(stores(), ada.email, { desktop: true });
    await openPane(p, "permissions");
    const defaults = p.byId("perm-defaults").children;
    expect(defaults.map((g) => g.children[0]?.text())).toEqual(["Connector defaults", "Web access defaults"]);
    for (const g of defaults) {
      const rows = g.children[1]?.children ?? [];
      expect(rows.map((r) => [r.dataset.option, r.attrs["aria-checked"], r.disabled, r.children.some((c) => c.className.includes("perm-check"))])).toEqual([["ask-some", "true", true, true], ["always-ask", "false", true, false]]);
      expect(rows[1]?.text()).toContain(`· ${PERMISSIONS_TEXT.coming}`);
    }
    expect([p.byId("perm-connectors").children.map((r) => r.attrs["aria-label"]), p.byId("perm-connectors-count").textContent]).toEqual([["Browser", "Hacker News"], "2"]);
    await p.byId("perm-connectors").children[1]?.onclick?.();
    await settle();
    expect([p.byId("set-pane-connector").hidden, p.byId("connector-name").textContent, p.byId("set-nav-connectors").attrs["aria-current"]]).toEqual([false, "Hacker News", "page"]);
  });
});

describe("[M27.6] Devices", () => {

  it("a browser that will not subscribe is said in words with the way out, and the Switch stays off", async () => {
    const p = await pageOf(stores(), ada.email, { desktop: true, pushEndpoint: null });
    await openPane(p, "devices");
    expect([p.byId("device-state").textContent, p.byId("push-on").checked]).toEqual([SETTINGS_TEXT.pushOff, false]);
    expect(p.byId("device-others").children.map((r) => r.text())).toEqual([`${SETTINGS_TEXT.workspace} ${SETTINGS_TEXT.workspaceSub}`, SETTINGS_TEXT.noOthers]);
    p.byId("push-on").checked = true;
    await (p.byId("push-on") as El & { onchange: () => unknown }).onchange();
    await settle();
    expect([p.byId("push-result").dataset.code, p.byId("push-on").checked]).toEqual(["PUSH_REFUSED", false]);
    expect(p.byId("push-result").textContent).toContain("Until then your agent's updates still reach you by mail.");
  });
});

describe("[M27.6] Help & support", () => {
  it("Report an issue opens a dialog over Settings whose submit opens the chat with the text prefilled; Help and Add to home screen say how", async () => {
    const p = await pageOf(stores(), ada.email, { desktop: true });
    await openPane(p, "help");
    expect(p.byId("set-help-pane").children.map((c) => c.id)).toEqual(["set-help", "set-report", "set-home", "set-note"]);
    await click(p, "set-help");
    expect(p.byId("set-note").textContent).toBe(SETTINGS_TEXT.helpHow);
    await click(p, "set-home");
    expect(p.byId("set-note").textContent).toBe(SETTINGS_TEXT.homeHow);
    await click(p, "set-report");
    expect([p.byId("report").hidden, p.byId("report").parent?.id === "scrim", p.byId("set-dialog").parent?.id]).toEqual([false, false, "scrim"]);
    p.byId("report-text").value = "  The Library will not open the Q3 deck.  ";
    await p.byId("report-form").onsubmit?.({ preventDefault() {} });
    await settle();
    expect([p.byId("scrim").hidden, p.byId("report").hidden, p.byId("chat").hidden, p.byId("t").value]).toEqual([true, true, false, `${SETTINGS_TEXT.reportLine}The Library will not open the Q3 deck.`]);
    // Nothing was sent: the person sends it from the chat.
    expect(p.sockets.flatMap((x) => x.sent)).toEqual([]);
  });
});

describe("[M27.6] the panes' module", () => {
  it("every pane settings-panes.ts exports is drawn once in the page, under its own root id", () => {
    const panes = { GENERAL_PANE, COMPANY_PANE, LOOPS_PANE, DEVICES_PANE, MESSAGING_PANE, HELP_PANE, REPORT_DIALOG };
    for (const [name, markup] of Object.entries(panes)) {
      const id = /^<div id="([\w-]+)"/.exec(markup)?.[1];
      expect(id, name).toBeDefined();
      expect(APP_PAGE.match(new RegExp(`id="${id}"`, "g")), name).toHaveLength(1);
    }
  });
});
