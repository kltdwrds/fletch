
import { describe, expect, it } from "vitest";
import { PANEL_BODY, PANEL_TABS } from "../../packages/agent/src/http/app/panel.ts";
import { PANE_TITLE, SETTINGS_PANES } from "../../packages/agent/src/http/app/settings.ts";
import { DIALOG_FORMS } from "../../packages/agent/src/http/app/overlays.ts";
import { APP_VIEWS, INVITE_TEXT, SETTINGS_MENU, SHELL_TEXT, TAB_VIEWS } from "../../packages/agent/src/http/app/shell.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
type Layout = Parameters<typeof page>[1];
type World = ReturnType<typeof authorityWorld>;

/** A person's page whose requests go to the world's real routes as that person. */
async function pageOf(w: World, person: string, layout: Layout = {}) {
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const r = await w.http(person, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    layout,
  );
  await settle();
  return p;
}
const world = (script: FakeStep[] = []) => authorityWorld({ script });
/** The markup of one element by id, up to its first close tag of the same name (good enough for the shell's flat parts). */
const block = (id: string, tag: string) => {
  const at = APP_PAGE.indexOf(`<${tag} id="${id}"`);
  return APP_PAGE.slice(at, APP_PAGE.indexOf(`</${tag}>`, at));
};
const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
/** A click on the scrim whose target is \`target\` (the page tells a click on the scrim from one inside its dialog). */
const clickScrim = (p: { byId(id: string): El }, target: El) => (p.byId("scrim").onclick as unknown as ((e: { target: El }) => unknown) | null)?.({ target });
/** The page's scroll handler on #stage, which the harness's element type does not declare. */
const scroll = async (p: { byId(id: string): El }, top: number) => {
  const stage = Object.assign(p.byId("stage"), { scrollTop: top }) as El & { onscroll?: () => unknown };
  await stage.onscroll?.();
};

describe("[M27.2] the device buckets", () => {
  it("a phone is under 768 px, a tablet to 1023, a desktop from 1024; the body says which, and a change is redrawn", async () => {
    const w = world();
    const p = await pageOf(w, ada.email);
    expect([p.ui.device(), p.byId("body").className]).toEqual(["phone", "qf-phone"]);
    p.resize({ tablet: true });
    expect([p.ui.device(), p.byId("body").className]).toEqual(["tablet", "qf-tablet"]);
    p.resize({ desktop: true });
    expect([p.ui.device(), p.byId("body").className]).toEqual(["desktop", "qf-desktop"]);
    // The script asks the system's own widths; the old 640 px bucket and the SKIN table are gone.
    expect(APP_PAGE).toContain('matchMedia(q) : null;\nconst atTablet = media("(min-width: 768px)"), atDesktop = media("(min-width: 1024px)")');
    expect(APP_PAGE).not.toMatch(/SKIN|640px/);
    expect(APP_PAGE).toContain('<div id="app" class="qf-vp">');
  });

  it("a device change closes what was open, so a sheet never becomes a dialog half-way", async () => {
    const p = await pageOf(world(), ada.email);
    await p.byId("to-more").onclick?.();
    expect(p.byId("scrim").hidden).toBe(false);
    p.resize({ tablet: true });
    expect([p.byId("scrim").hidden, p.byId("more-sheet").parent?.id]).toEqual([true, "overlays"]);
  });
});

describe("[M27.2] the tab bar and the rail", () => {
  it("the phone's TabBar has five slots, Chat, Feed, Goals, Library and More, and no Ideas", () => {
    const bar = block("tabs", "nav");
    expect(bar).toContain('class="qf-tabbar qf-tabbar--app qf-only-phone" aria-label="Main navigation"');
    expect(ids(bar)).toEqual(["tabs", "to-chat", "to-feed", "to-goals", "to-library", "to-more"]);
    expect(bar).not.toMatch(/Ideas|M9 18h6/);
    expect(TAB_VIEWS).toEqual(["chat", "feed", "goals", "library"]);
    expect(APP_VIEWS).toEqual(TAB_VIEWS);
    for (const v of APP_VIEWS) expect(APP_PAGE).toContain(`<main id="${v}"`);
  });

  // M29.2: the rail's agent avatar left the page; its bottom is Get the app and Settings, as the system writes.
  it("the Rail is Chat, Search, Feed, Goals, Library, Get the app and the Settings menu", () => {
    const rail = block("rail", "nav");
    expect(rail).toContain('class="qf-rail" aria-label="Primary"');
    expect(ids(rail)).toEqual(["rail", "rail-chat", "rail-search", "rail-feed", "rail-goals", "rail-library", "rail-app", "to-settings"]);
    expect(rail.match(/class="qf-rail-item"/g)).toHaveLength(7);
  });

  it("the shown view is current on the bar and the rail alike, and only it; More is current while its sheet is open", async () => {
    const p = await pageOf(world(), ada.email);
    const cur = () => TAB_VIEWS.filter((v) => p.byId(`to-${v}`).attrs["aria-current"] === "page");
    const rail = () => TAB_VIEWS.filter((v) => p.byId(`rail-${v}`).attrs["aria-current"] === "page");
    expect([cur(), rail()]).toEqual([["chat"], ["chat"]]);
    await p.byId("rail-feed").onclick?.();
    expect([cur(), rail(), p.byId("feed").hidden, p.byId("chat").hidden]).toEqual([["feed"], ["feed"], false, true]);
    await p.byId("to-more").onclick?.();
    expect([cur(), p.byId("to-more").attrs["aria-current"]]).toEqual([[], "page"]);
    await p.byId("to-more").onclick?.();
    expect([cur(), p.byId("to-more").attrs["aria-current"]]).toEqual([["feed"], undefined]);
  });

  it("the rail's Settings opens its menu with its rows (M29.3: Keyboard shortcuts, Download apps, Report an issue, Settings), and Settings opens the dialog", async () => {
    const p = await pageOf(world(), ada.email, { desktop: true });
    await p.byId("to-settings").onclick?.();
    expect(p.byId("menu").children.map((c) => c.id)).toEqual(SETTINGS_MENU.map((r) => r.id));
    expect(p.byId("to-settings").attrs["aria-expanded"]).toBe("true");
    await p.byId("settings-menu-open").onclick?.();
    expect([p.byId("menu").hidden, p.byId("set-dialog").parent?.id, p.byId("settings-menu-open").parent?.id]).toEqual([true, "scrim", "menu-home"]);
  });
});

describe("[M27.2] the list column and the drawer", () => {
  it("at 1440 the chats list is the list column on Chat and the Library's column on Library, neither on Feed or Goals", async () => {
    const p = await pageOf(world(), ada.email, { desktop: true });
    const cols = () => [p.byId("drawer").className, p.byId("drawer").hidden, p.byId("lib-col").hidden];
    expect(cols()).toEqual(["qf-listcol qf-listcol--chat", false, true]);
    await p.byId("rail-library").onclick?.();
    expect(cols()).toEqual(["qf-listcol qf-listcol--chat", true, false]);
    for (const v of ["feed", "goals"]) {
      await p.byId(`rail-${v}`).onclick?.();
      expect(cols()).toEqual(["qf-listcol qf-listcol--chat", true, true]);
    }
    expect(block("lib-col", "aside")).toContain('class="qf-listcol qf-listcol--lib"');
    // The column holds the search field (F3), the list's options (M27.3), the list host with New side chat, the archived view
    // and the filtered list.
    expect(ids(block("drawer", "aside"))).toEqual(["drawer", "chats-find", "chats-q", "chats-clear", "archived-btn", "close-drawer", "chats", "new-chat", "archived", "chats-found", "list-resize"]);
  });

  it("on a phone the same node is the 75 % drawer on the scrim, closed by the scrim or Escape and sent home", async () => {
    const p = await pageOf(world(), ada.email);
    const drawer = p.byId("drawer");
    expect([drawer.className, drawer.hidden]).toEqual(["drawer-sheet", true]);
    await p.byId("open-chats").onclick?.();
    // The drawer's layer (M29.6): the system's .qf-drawer over its veil, so it moves as AppShell's drawer does.
    expect([drawer.parent?.id, p.byId("scrim").className, drawer.className, drawer.hidden]).toEqual(["scrim", "qf-drawer-wrap", "drawer-sheet qf-drawer", false]);
    expect(p.byId("scrim").children[0]?.className).toBe("qf-drawer-scrim");
    // A click inside the drawer is not a click on the scrim.
    clickScrim(p, p.byId("chats"));
    expect(drawer.parent?.id).toBe("scrim");
    p.key("Escape");
    expect([drawer.parent?.id, p.byId("scrim").hidden, drawer.hidden]).toEqual(["shell", true, true]);
    await p.byId("open-chats").onclick?.();
    clickScrim(p, p.byId("scrim"));
    expect(p.byId("scrim").hidden).toBe(true);
  });
});

describe("[M27.2] the More sheet", () => {
  it("holds Search, Report an issue and Settings, and the drawer's Settings and Search are gone", async () => {
    const sheet = APP_PAGE.slice(APP_PAGE.indexOf('<div id="more-sheet"'), APP_PAGE.indexOf('<div id="panel-dialog"'));
    expect(ids(sheet).filter((i) => i.startsWith("more-"))).toEqual(["more-sheet", "more-search", "more-report", "more-settings"]);
    // Recents is DESIGN-ONLY (no recents object): the sheet does not draw it.
    expect(sheet).not.toContain("Recents");
    expect(APP_PAGE).not.toMatch(/id="drawer-settings"|id="drawer-search"/);
  });

  it("opens as a bottom sheet; Search opens search, Report an issue the chat with the line, Settings the dialog on its nav", async () => {
    const p = await pageOf(world(), ada.email);
    await p.byId("to-more").onclick?.();
    expect([p.byId("more-sheet").parent?.id, p.byId("scrim").className]).toEqual(["scrim", "qf-scrim2 qf-scrim2--sheet"]);
    await p.byId("more-search").onclick?.();
    // Search is the SearchDialog on the helper's scrim (M27.3), the sheet closed under it.
    expect([p.byId("search").hidden, p.byId("search").parent?.id, p.byId("more-sheet").hidden]).toEqual([false, "scrim", true]);
    p.key("Escape");
    expect([p.byId("search").hidden, p.byId("scrim").hidden]).toEqual([true, true]);
    await p.byId("rail-goals").onclick?.();
    await p.byId("to-more").onclick?.();
    await p.byId("more-report").onclick?.();
    expect([p.byId("chat").hidden, p.byId("t").value, p.byId("scrim").hidden]).toEqual([false, SHELL_TEXT.reportLine, true]);
    await p.byId("to-more").onclick?.();
    await p.byId("more-settings").onclick?.();
    expect([p.byId("set-dialog").parent?.id, p.byId("set-frame").className]).toEqual(["scrim", "qf-set"]);
  });
});

describe("[M27.2] the overlay helper", () => {
  it("a dialog takes the form it names on the scrim, Center by default; a dialog over a dialog gets its own scrim above", async () => {
    const p = await pageOf(world(), ada.email);
    const node = p.byId("confirm");
    for (const form of DIALOG_FORMS) {
      p.ui.openDialog(node, { form });
      expect([p.byId("scrim").className, p.byId("scrim").dataset.form, node.parent?.id]).toEqual([form === "start" ? "qf-drawer-wrap" : `qf-scrim2 qf-scrim2--${form}`, form, "scrim"]);
      p.ui.closeDialog(node);
      expect([p.byId("scrim").hidden, node.parent?.id, node.hidden]).toEqual([true, "overlays", true]);
    }
    p.ui.openDialog(node, { form: "nonsense" });
    expect(p.byId("scrim").className).toBe("qf-scrim2 qf-scrim2--center");
    p.ui.closeOverlays();
    // Settings, then a confirm over it: two scrims; closing Settings closes what was opened over it too.
    await p.byId("rail-chat").onclick?.();
    p.ui.openDialog(p.byId("set-dialog"), { form: "sheet" });
    p.ui.confirmDialog("Remove this?", "It cannot be undone.", { label: "Remove", run: () => {} });
    const upper = p.byId("confirm").parent as El;
    expect([upper.id, upper.className, upper.attrs.style, p.byId("set-dialog").parent?.id]).toEqual(["", "qf-scrim2 qf-scrim2--center", "z-index:53", "scrim"]);
    p.key("Escape");
    expect([p.byId("confirm").parent?.id, p.byId("set-dialog").parent?.id]).toEqual(["overlays", "scrim"]);
    p.ui.confirmDialog("Remove this?", "It cannot be undone.", { label: "Remove", run: () => {} });
    p.ui.closeDialog(p.byId("set-dialog"));
    expect([p.byId("confirm").parent?.id, p.byId("set-dialog").parent?.id, p.byId("scrim").hidden]).toEqual(["overlays", "overlays", true]);
  });

  it("the confirm says the action in red, runs it once on the action and never on Cancel", async () => {
    const p = await pageOf(world(), ada.email, { desktop: true });
    const ran: string[] = [];
    p.ui.confirmDialog("Delete side chat?", "Deleting this side chat permanently removes it.", { label: "Delete", run: () => void ran.push("delete") });
    expect([p.byId("confirm-title").textContent, p.byId("confirm-ok").textContent, p.byId("confirm-ok").className]).toEqual(["Delete side chat?", "Delete", "qf-btn qf-btn--destructive"]);
    await p.byId("confirm-cancel").onclick?.();
    expect([ran, p.byId("scrim").hidden]).toEqual([[], true]);
    p.ui.confirmDialog("Turn off?", "", { label: "Turn off", danger: false, run: () => void ran.push("off") });
    expect(p.byId("confirm-ok").className).toBe("qf-btn qf-btn--primary");
    await p.byId("confirm-ok").onclick?.();
    expect([ran, p.byId("scrim").hidden]).toEqual([["off"], true]);
  });

  it("a menu is an action sheet under 768 px and a popover from 768; a second press, the backdrop or Escape closes it", async () => {
    const p = await pageOf(world(), ada.email);
    const items = () => p.byId("menu").children.map((c) => c.id || c.text());
    await p.byId("to-settings").onclick?.();
    expect([p.byId("menu").className, p.byId("menu").dataset.form, p.byId("menu-backdrop").className, p.byId("menu").hidden]).toEqual(["qf-menu qf-menu--sheet", "sheet", "qf-backdrop is-sheet", false]);
    expect(items()).toEqual(SETTINGS_MENU.map((r) => r.id));
    await p.byId("to-settings").onclick?.();
    expect([p.byId("menu").hidden, p.byId("settings-menu-open").parent?.id, p.byId("to-settings").attrs["aria-expanded"]]).toEqual([true, "menu-home", "false"]);
    p.resize({ tablet: true });
    const ran: string[] = [];
    p.ui.openMenu(p.byId("to-settings"), [{ label: "Rename", glyph: "pencil", run: () => void ran.push("rename") }, { label: "Delete", glyph: "trash", danger: true, run: () => void ran.push("delete") }]);
    expect([p.byId("menu").className, p.byId("menu").dataset.form, p.byId("menu-backdrop").className]).toEqual(["qf-menu", "popover", "qf-backdrop"]);
    expect(p.byId("menu").children.map((c) => [c.className, c.text()])).toEqual([["qf-menu-item", "Rename"], ["qf-menu-item is-danger", "Delete"]]);
    await p.byId("menu").children[1]?.onclick?.();
    expect([ran, p.byId("menu").hidden, p.byId("menu").children]).toEqual([["delete"], true, []]);
    await p.byId("to-settings").onclick?.();
    await p.byId("menu-backdrop").onclick?.();
    expect(p.byId("menu").hidden).toBe(true);
    await p.byId("to-settings").onclick?.();
    p.key("Escape");
    expect(p.byId("menu").hidden).toBe(true);
  });

  // M27.3 moved Rename and Archive from the chat's More menu to each side chat's row (the canvas's ListRow menu).
  it("the chat's menu renames and archives through the helper; the main chat cannot be archived and says so", async () => {
    const w = world();
    await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" });
    const p = await pageOf(w, ada.email);
    const row = p.byId("chats").children.find((r) => r.dataset.chat && r.children[0]?.children[0]?.textContent === "Trip planning") as El;
    const kebab = (row.children[1] as El).children.find((c) => c.tag === "button") as El;
    await kebab.onclick?.();
    expect(p.byId("menu").children.map((c) => c.id)).toEqual(["rename", "archive"]);
    await p.byId("rename").onclick?.();
    expect([p.byId("menu").hidden, p.byId("rename-form").hidden]).toEqual([true, false]);
    // The main row offers no menu, and the Person refuses its archive with the code that says why.
    const main = p.byId("chats").children.find((r) => r.dataset.chat) as El;
    expect(main.children[1]?.children.map((c) => c.className)).toEqual(["qf-row-time"]);
    const { body } = await w.http(ada.email, "GET", "/app/chats");
    expect(await w.http(ada.email, "POST", `/app/chats/${(body as { main: string }).main}/archive`, { archived: true })).toMatchObject({ status: 409, body: { code: "CHAT_MAIN_REFUSED" } });
  });
});

describe("[M27.2] the Settings frame", () => {
  it("is the SettingsDialog: the nav General to Help & support with Log out at its foot, the pane with Back, its title and Close", () => {
    const dlg = APP_PAGE.slice(APP_PAGE.indexOf('<div id="set-dialog"'), APP_PAGE.indexOf('<div id="confirm"'));
    expect(dlg).toContain('class="qf-dlg qf-dlg--800" role="dialog" aria-label="Settings"');
    expect(ids(dlg).filter((i) => /^set-(nav|back|title|close|frame|dialog)/.test(i))).toEqual(["set-dialog", "set-frame", "set-nav", ...SETTINGS_PANES.map((k) => `set-nav-${k}`), "set-back", "set-title", "set-close"]);
    expect(SETTINGS_PANES.map((k) => PANE_TITLE[k])).toEqual(["General", "Connectors", "Permissions", "Devices", "Messaging channels", "Help & support"]);
    expect(dlg.indexOf('id="logout"')).toBeGreaterThan(dlg.indexOf('id="set-nav-help"'));
    // The settings pages' Back circles are gone; their rows and the pages' own ids stay, inside the panes.
    expect(APP_PAGE).not.toMatch(/id="(settings|connectors|connector|permissions)-back"/);
    for (const id of ["set-connectors", "set-permissions", "set-devices", "set-home", "set-report", "set-help", "conn-list", "connector-groups", "perm-defaults", "push-on", "push-test", "delivery-form", "loop-table"]) expect(dlg, id).toContain(`id="${id}"`);
  });

  it("on a desktop it opens on General, a nav item shows its pane, and a connector's pane walks back to Connectors", async () => {
    const w = world();
    const p = await pageOf(w, ada.email, { desktop: true });
    const shownPane = () => [...SETTINGS_PANES, "connector"].filter((k) => !p.byId(`set-pane-${k}`).hidden);
    const navOn = () => SETTINGS_PANES.filter((k) => p.byId(`set-nav-${k}`).attrs["aria-current"] === "page");
    await p.byId("to-settings").onclick?.();
    await p.byId("settings-menu-open").onclick?.();
    await settle();
    expect([shownPane(), navOn(), p.byId("set-title").textContent, p.byId("set-frame").className, p.byId("scrim").className]).toEqual([["general"], ["general"], "General", "qf-set is-pane", "qf-scrim2 qf-scrim2--sheet"]);
    await p.byId("set-nav-devices").onclick?.();
    expect([shownPane(), navOn(), p.byId("set-title").textContent]).toEqual([["devices"], ["devices"], "Devices"]);
    await p.byId("set-nav-general").onclick?.();
    await p.byId("set-connectors").onclick?.();
    expect([shownPane(), p.byId("set-title").textContent, p.byId("set-back").className]).toEqual([["connectors"], "Connectors", "qf-ibtn qf-ibtn--glass qf-ibtn--28 qf-set-back qf-only-phone"]);
    p.ui.closeOverlays();
    // A connector is nested under Connectors: Back shows on every device and goes there.
    await p.byId("to-settings").onclick?.();
    await p.byId("settings-menu-open").onclick?.();
    await p.byId("set-nav-connectors").onclick?.();
    await settle();
    // Since M27.6 Connected is a tab of grouped cards (a group: its label, then the card of rows); View opens one.
    await p.byId("conn-connected").onclick?.();
    const row = p.byId("conn-list").children[0]?.children[1]?.children[0];
    await row?.children.find((x) => x.tag === "button")?.onclick?.();
    expect([shownPane(), navOn(), p.byId("set-top").className, p.byId("set-back").className]).toEqual([["connector"], ["connectors"], "qf-set-top has-back", "qf-ibtn qf-ibtn--glass qf-ibtn--28 qf-set-back"]);
    await p.byId("set-back").onclick?.();
    expect(shownPane()).toEqual(["connectors"]);
    await p.byId("set-close").onclick?.();
    expect([p.byId("scrim").hidden, p.byId("set-dialog").parent?.id]).toEqual([true, "overlays"]);
  });

  it("on a phone it is a bottom sheet whose nav is the first page; a pane pushes and Back returns to the nav", async () => {
    const p = await pageOf(world(), ada.email);
    await p.byId("to-more").onclick?.();
    await p.byId("more-settings").onclick?.();
    expect([p.byId("set-frame").className, p.byId("scrim").className]).toEqual(["qf-set", "qf-scrim2 qf-scrim2--sheet"]);
    await p.byId("set-nav-permissions").onclick?.();
    expect([p.byId("set-frame").className, p.byId("set-pane-permissions").hidden, p.byId("set-title").textContent]).toEqual(["qf-set is-pane", false, "Permissions"]);
    await p.byId("set-back").onclick?.();
    expect([p.byId("set-frame").className, p.byId("set-dialog").parent?.id]).toEqual(["qf-set", "scrim"]);
  });

  it("the old pages' names open the dialog on their pane: Settings on General, Connectors and Permissions on theirs", async () => {
    const p = await pageOf(world(), ada.email, { tablet: true });
    for (const [row, k] of [["set-connectors", "connectors"], ["set-permissions", "permissions"], ["set-devices", "devices"]] as const) {
      await p.byId("to-settings").onclick?.();
      await p.byId("settings-menu-open").onclick?.();
      await p.byId(row).onclick?.();
      expect([p.byId(`set-pane-${k}`).hidden, p.byId("set-title").textContent]).toEqual([false, PANE_TITLE[k]]);
      p.ui.closeOverlays();
    }
    // The route names themselves, as a link calls them: each opens the one dialog on its pane, General for Settings.
    for (const [view, k] of [["settings", "general"], ["connectors", "connectors"], ["permissions", "permissions"]] as const) {
      p.ui.show(view);
      expect([p.byId("set-dialog").parent?.id, p.byId(`set-pane-${k}`).hidden, p.byId("set-title").textContent, p.byId("chat").hidden]).toEqual(["scrim", false, PANE_TITLE[k], false]);
      p.ui.closeOverlays();
    }
  });
});

describe("[M27.2] the panel host", () => {
  it("is the avatar, the name, the handle, Connected and four icon tabs, Activity first; Devices is not a tab", () => {
    const host = APP_PAGE.slice(APP_PAGE.indexOf('<div id="panel">'), APP_PAGE.indexOf('class="panel-body"'));
    expect(ids(host)).toEqual(["panel", "close-sheet", "handle", "sheet-sock", "sheet-live", "panel-seg-ind", ...PANEL_TABS.flatMap((k) => (k === "approvals" ? [`panel-tab-${k}`, "approvals-count"] : [`panel-tab-${k}`])), "panel-panes"]);
    expect(PANEL_TABS).toEqual(["activity", "approvals", "upcoming", "identity"]);
    expect(host).toContain('class="seg2 qf-seg--ind" role="tablist"');
    expect(APP_PAGE).not.toMatch(/sheet-tab-|panel-tab-devices|id="sheet-devices"/);
    expect(block("panel-pin", "aside")).toContain('class="qf-panel qf-hide-phone"');
  });

  it("a tab shows its body alone and reads it; Upcoming is the jobs and Identity the profile", async () => {
    const w = world();
    const p = await pageOf(w, ada.email, { desktop: true });
    await p.byId("open-agent").onclick?.();
    for (const k of PANEL_TABS) {
      await p.byId(`panel-tab-${k}`).onclick?.();
      await settle();
      expect(PANEL_TABS.filter((t) => p.byId(`panel-tab-${t}`).attrs["aria-selected"] === "true")).toEqual([k]);
      expect(Object.values(PANEL_BODY).filter((b) => !p.byId(b).hidden)).toEqual([PANEL_BODY[k]]);
    }
    expect(p.byId("handle").textContent).toBe(`${ada.email}/agent`);
  });

  // M29.2: the panel pins from 768 (it was 1280), closes on its X and opens again from the header's avatar.
  it("from 768 px it is pinned beside the chat, closes on its X and opens from the header's avatar; on a phone it is the sheet", async () => {
    const w = world();
    for (const layout of [{ tablet: true }, { desktop: true }]) {
      const wide = await pageOf(w, ada.email, layout);
      expect([wide.byId("panel").parent?.id, wide.byId("panel-pin").hidden, wide.byId("open-agent").hidden]).toEqual(["panel-pin", false, true]);
      await wide.byId("close-sheet").onclick?.();
      expect([wide.byId("panel-pin").hidden, wide.byId("open-agent").hidden]).toEqual([true, false]);
      await wide.byId("open-agent").onclick?.();
      expect([wide.byId("panel-pin").hidden, wide.byId("scrim").hidden, wide.byId("open-agent").hidden]).toEqual([false, true, true]);
    }
    // Off the chat the panel is not pinned: the approvals route opens it as the dialog.
    const wide = await pageOf(w, ada.email, { desktop: true });
    await wide.byId("rail-feed").onclick?.();
    expect(wide.byId("panel-pin").hidden).toBe(true);
    wide.ui.show("approvals");
    expect([wide.byId("panel").parent?.id, wide.byId("panel-dialog").parent?.id]).toEqual(["panel-dialog", "scrim"]);
    const phone = await pageOf(w, ada.email);
    await phone.byId("open-agent").onclick?.();
    expect([phone.byId("panel").parent?.id, phone.byId("scrim").className]).toEqual(["panel-dialog", "qf-scrim2 qf-scrim2--sheet"]);
    await phone.byId("close-sheet").onclick?.();
    expect([phone.byId("panel").parent?.id, phone.byId("scrim").hidden]).toEqual(["panel-pin", true]);
  });

  it("the chat's link to scheduled jobs and the approvals route open the panel on Upcoming and Approvals", async () => {
    // On a phone the panel is the sheet; from 768 (M29.2) it opens pinned on the tab, with no dialog.
    for (const [layout, host] of [[{}, "panel-dialog"], [{ tablet: true }, "panel-pin"]] as const) {
      const p = await pageOf(world(), ada.email, layout);
      const selected = () => PANEL_TABS.filter((k) => p.byId(`panel-tab-${k}`).attrs["aria-selected"] === "true");
      for (const [view, tab] of [["jobs", "upcoming"], ["approvals", "approvals"]] as const) {
        p.ui.show(view);
        expect([p.byId("panel").parent?.id, selected(), p.byId("chat").hidden, p.byId("scrim").hidden]).toEqual([host, [tab], false, host === "panel-pin"]);
        p.ui.closeOverlays();
        expect(p.byId("panel").parent?.id).toBe("panel-pin");
      }
    }
  });
});

describe("[M27.2] the headers", () => {

  it("every other route heads itself with the PageHeader and its title, which collapses once the page scrolls", async () => {
    const p = await pageOf(world(), ada.email, { desktop: true });
    await p.byId("rail-goals").onclick?.();
    expect([p.byId("head").className, p.byId("head-in").className, p.byId("view-title").hidden, p.byId("view-title").textContent, p.byId("open-agent").hidden]).toEqual(["qf-phead qf-phead--768", "qf-phead-in", false, "Goals", true]);
    await p.byId("rail-library").onclick?.();
    expect([p.byId("head").className, p.byId("view-title").textContent]).toEqual(["qf-phead", "Library"]);
    await scroll(p, 40);
    expect(p.byId("head").className).toBe("qf-phead is-scrolled");
    await scroll(p, 0);
    expect(p.byId("head").className).toBe("qf-phead");
  });

  it("Invite copies the company's address from its popover (M29.3: the clipboard's refusal is the field, not a label)", async () => {
    const copied: string[] = [];
    const p = await pageOf(world(), ada.email, { clipboard: copied, desktop: true });
    await p.byId("head-invite").onclick?.();
    await p.byId("invite-pop-copy").onclick?.();
    expect([copied, p.byId("invite-pop-copy").textContent, p.byId("head-invite").attrs["aria-expanded"]]).toEqual([["https://solo-sam.example/"], INVITE_TEXT.copied, "true"]);
  });
});
