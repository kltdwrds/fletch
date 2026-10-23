// F5: back closes what opened, in the page harness with F4's history (rule 7 of D-0009's grammar). The shipped page
// script runs over the authority world's real routes as Sam or Pat of solo-sam. An overlay without an address pushes
// one entry at the same address and back closes exactly it; Escape, the scrim and its own control pop the entry they
// own and leave no stray one; Settings has addresses, opened over the page beneath and closed back onto it; a device
// change pops what it closes. Planted: a close that leaves its entry, and a pop that is not guarded by its marker.
import { describe, expect, it } from "vitest";
import { ROUTER_TEXT } from "../../packages/agent/src/http/app/router.ts";
import { SETTINGS_TEXT } from "../../packages/agent/src/http/app/settings.ts";
import { pageOf } from "../../packages/agent/src/http/pages.ts";
import { ada, authorityWorld, person } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const pat = person("pat-solo");
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const world = () => authorityWorld({ script: [{ text: "One." }, { text: "Two." }, { text: "Three." }], seed: [ada, pat] });
type World = ReturnType<typeof world>;
type Page = Awaited<ReturnType<typeof page>>;
type Layout = { desktop?: boolean; tablet?: boolean };

/** A person's page booted at `path` on `layout`, its requests on the world's real routes as that person. */
async function pageAt(w: World, who: string, path: string, layout: Layout, plant?: (js: string) => string, asked: string[] = []) {
  const p = await page(
    {
      onSend() {},
      fetch: async (url, init) => {
        asked.push(url);
        const r = await w.http(who, init?.method ?? "GET", url, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    { ...layout, path },
    plant,
  );
  await settle();
  return p;
}
const address = (p: Page) => p.location.pathname + p.location.search + p.location.hash;
const at = (p: Page) => [address(p), p.history.index];
const click = async (p: Page, id: string) => {
  await p.byId(id).onclick?.();
  await settle();
};
const back = async (p: Page) => {
  p.history.back();
  await settle();
};
const rowOf = (p: Page, chat: string) => p.byId("chats").children.find((r) => r.dataset.chat === chat) as El;
const socketChat = (p: Page) => /\/chats\/([^/]+)\/ws$/.exec(p.sockets.at(-1)?.url ?? "")?.[1] ?? "";

/** Two chats of Sam's (or `who`'s), the page booted at the first and moved to the second: the history is [A, B]. */
async function twoChats(layout: Layout, who = ada.email, plant?: (js: string) => string) {
  const w = world();
  const a = (await w.say(who, "First chat")).chatId;
  const b = (await w.say(who, "Second chat")).chatId;
  const p = await pageAt(w, who, `/chats/${a}`, layout, plant);
  await rowOf(p, b).children[0]?.onclick?.();
  await settle();
  expect(at(p)).toEqual([`/chats/${b}`, 1]);
  return { w, p, a, b };
}

const phone: Layout = {};
const desktop: Layout = { desktop: true };
/** Every overlay without an address: how it opens, whether it is up, and its own close control. */
const OVERLAYS: Array<{ name: string; layout: Layout; open: (p: Page) => Promise<void>; up: (p: Page) => boolean; own: (p: Page) => Promise<void> }> = [
  { name: "the chats drawer (a phone's sheet)", layout: phone, open: (p) => click(p, "open-chats"), up: (p) => !p.byId("drawer").hidden, own: (p) => click(p, "close-drawer") },
  { name: "the Search dialog", layout: desktop, open: (p) => click(p, "rail-search"), up: (p) => !p.byId("search").hidden, own: (p) => click(p, "search-cancel") },
  { name: "a menu (the rail's Settings menu)", layout: desktop, open: (p) => click(p, "to-settings"), up: (p) => !p.byId("menu").hidden, own: (p) => click(p, "menu-backdrop") },
  {
    name: "the confirm dialog",
    layout: desktop,
    open: async (p) => void p.ui.confirmDialog("Delete this chat?", "It cannot be undone.", { label: "Delete", run: () => undefined }),
    up: (p) => !p.byId("confirm").hidden,
    own: (p) => click(p, "confirm-cancel"),
  },
  { name: "the phone's panel sheet", layout: phone, open: (p) => click(p, "open-agent"), up: (p) => !p.byId("panel-dialog").hidden, own: (p) => click(p, "close-sheet") },
  { name: "the More sheet", layout: phone, open: (p) => click(p, "to-more"), up: (p) => !p.byId("more-sheet").hidden, own: (p) => click(p, "to-more") },
  { name: "the invite pop (a popover from 768)", layout: desktop, open: (p) => click(p, "head-invite"), up: (p) => !p.byId("invite-pop").hidden, own: (p) => click(p, "invite-backdrop") },
  { name: "the invite pop (a phone's sheet)", layout: phone, open: (p) => click(p, "head-invite"), up: (p) => !p.byId("invite-pop").hidden, own: (p) => click(p, "head-invite") },
];

describe("[F5] back closes an overlay without an address, and only it", () => {
  for (const o of OVERLAYS)
    it(`${o.name}: opening pushes one entry at the same address, back closes exactly it and the page beneath stays`, async () => {
      const { p, a, b } = await twoChats(o.layout);
      const sockets = p.sockets.length;
      await o.open(p);
      expect(o.up(p)).toBe(true);
      expect([at(p), p.history.entries.length, p.history.entries[2]]).toEqual([[`/chats/${b}`, 2], 3, `/chats/${b}`]);
      expect((p.history.state as { layer?: unknown } | null)?.layer).toBeTruthy();
      await back(p);
      expect([o.up(p), at(p), p.byId("app").dataset.view, socketChat(p), p.sockets.length]).toEqual([false, [`/chats/${b}`, 1], "chat", b, sockets]);
      // One back after the close leaves the page.
      await back(p);
      expect([at(p), socketChat(p)]).toEqual([[`/chats/${a}`, 0], a]);
    });

  for (const o of OVERLAYS)
    it(`${o.name}: its own close pops its entry, so the following back leaves the page`, async () => {
      const { p, a, b } = await twoChats(o.layout);
      await o.open(p);
      await o.own(p);
      expect([o.up(p), at(p)]).toEqual([false, [`/chats/${b}`, 1]]);
      await back(p);
      expect(at(p)).toEqual([`/chats/${a}`, 0]);
    });

  it("Escape and the scrim pop the entry they own, and a following back changes the page", async () => {
    for (const close of ["Escape", "scrim"] as const) {
      const { p, a, b } = await twoChats(desktop);
      await click(p, "rail-search");
      if (close === "Escape") p.key("Escape");
      else await p.byId("scrim").onclick?.();
      await settle();
      expect([close, p.byId("search").hidden, at(p)]).toEqual([close, true, [`/chats/${b}`, 1]]);
      await back(p);
      expect([close, at(p), socketChat(p)]).toEqual([close, [`/chats/${a}`, 0], a]);
    }
  });

  it("planted: a close that leaves its entry makes the following back dead, and the test sees it", async () => {
    const leave = (js: string) => {
      expect(js).toContain("if (!keep) unown(closing);");
      return js.replace("if (!keep) unown(closing);", "");
    };
    const { p, b } = await twoChats(desktop, ada.email, leave);
    await click(p, "rail-search");
    p.key("Escape");
    await settle();
    await back(p);
    // The defect this part removes: back stayed on the page, spent on the stray entry.
    expect(at(p)).toEqual([`/chats/${b}`, 1]);
  });

  it("an overlay over another: back closes the top one, then the one beneath, then leaves the page (Pat, a tablet)", async () => {
    const { p, a, b } = await twoChats({ tablet: true }, pat.email);
    await click(p, "chats-pill");
    await click(p, "rail-search");
    expect([p.byId("drawer").parent?.id, p.byId("search").hidden, p.history.entries.length]).toEqual(["scrim", false, 4]);
    await back(p);
    expect([p.byId("search").hidden, p.byId("drawer").parent?.id, at(p)]).toEqual([true, "scrim", [`/chats/${b}`, 2]]);
    await back(p);
    expect([p.byId("drawer").parent?.id === "scrim", at(p)]).toEqual([false, [`/chats/${b}`, 1]]);
    await back(p);
    expect(at(p)).toEqual([`/chats/${a}`, 0]);
  });

  it("a chat picked in the drawer closes it and pushes the chat over the page it was opened on, no stray entry between", async () => {
    const { p, a, b } = await twoChats(phone);
    await click(p, "open-chats");
    await rowOf(p, a).children[0]?.onclick?.();
    await settle();
    expect([p.byId("drawer").hidden, p.history.entries, p.history.index]).toEqual([true, [`/chats/${a}`, `/chats/${b}`, `/chats/${a}`], 2]);
    await back(p);
    expect([at(p), socketChat(p)]).toEqual([[`/chats/${b}`, 1], b]);
  });

  it("a pop is guarded by its entry's marker: closing a dialog under an open menu pops nothing (planted: an unguarded pop takes the menu's entry)", async () => {
    const guard = "if (s.layer !== top || n < 1) return;";
    for (const planted of [false, true]) {
      const { p, b } = await twoChats(desktop, ada.email, (js) => {
        expect(js).toContain(guard);
        return planted ? js.replace(guard, "if (n < 1) return;") : js;
      });
      await click(p, "rail-search");
      p.ui.openMenu(p.byId("to-settings"), [{ label: "Rename", run: () => undefined }]);
      expect(p.history.index).toBe(3);
      p.ui.closeDialog(p.byId("search"));
      await settle();
      expect([planted, p.byId("menu").hidden, at(p)]).toEqual(planted ? [true, false, [`/chats/${b}`, 2]] : [false, false, [`/chats/${b}`, 3]]);
    }
  });
});

describe("[F5] Settings has addresses", () => {
  it("every pane has an address in the grammar, and nothing else under /settings is a page", () => {
    const pages = ["/settings", "/settings/general", "/settings/general/company", "/settings/general/loops", "/settings/connectors", "/settings/connectors/host%3Aapi.example.com", "/settings/permissions", "/settings/devices", "/settings/messaging", "/settings/help"];
    expect(pages.map((x) => pageOf(x)?.row.name)).toEqual(pages.map(() => "settings"));
    for (const x of ["/settings/", "/settings/nope", "/settings/connectors/", "/settings/connectors/a/b", "/settings/company", "/settingsx"]) expect([x, pageOf(x)]).toEqual([x, null]);
  });

  it("/settings/connectors opens on that pane over the page it was opened from; its Back returns to /settings; closing returns to the page beneath", async () => {
    const { p, a, b } = await twoChats(desktop);
    p.ui.show("connectors");
    await settle();
    expect([at(p), p.history.entries.slice(2), p.byId("set-dialog").hidden, p.byId("set-pane-connectors").hidden, p.byId("app").dataset.view]).toEqual([
      ["/settings/connectors", 3],
      ["/settings", "/settings/connectors"],
      false,
      false,
      "chat",
    ]);
    expect(p.document.title).toBe(`${SETTINGS_TEXT.title} · ${ROUTER_TEXT.app}`);
    await click(p, "set-back");
    expect([at(p), p.byId("set-pane-general").hidden, p.byId("set-dialog").hidden]).toEqual([["/settings", 2], false, false]);
    await click(p, "set-close");
    expect([at(p), p.byId("set-dialog").hidden, socketChat(p)]).toEqual([[`/chats/${b}`, 1], true, b]);
    await back(p);
    expect(at(p)).toEqual([`/chats/${a}`, 0]);
  });

  it("opening Settings from the rail's menu pushes /settings over the page; a pane pushes its address; a connector's is /settings/connectors/<id>", async () => {
    const { p, b } = await twoChats(desktop);
    await click(p, "to-settings");
    await click(p, "settings-menu-open");
    expect([p.byId("menu").hidden, p.history.entries.slice(1), p.history.index]).toEqual([true, [`/chats/${b}`, "/settings"], 2]);
    await click(p, "set-nav-permissions");
    await settle();
    expect(at(p)).toEqual(["/settings/permissions", 3]);
    await p.byId("perm-connectors").children[1]?.onclick?.();
    await settle();
    expect([at(p), p.byId("set-pane-connector").hidden, p.byId("connector-name").textContent]).toEqual([["/settings/connectors/hackernews", 4], false, "Hacker News"]);
    // Back from a pane is the browser's back: the pane before it, then Settings' first address, then the page.
    await back(p);
    expect([at(p), p.byId("set-pane-permissions").hidden]).toEqual([["/settings/permissions", 3], false]);
    await back(p);
    expect([at(p), p.byId("set-pane-general").hidden]).toEqual([["/settings", 2], false]);
    await back(p);
    expect([at(p), p.byId("set-dialog").hidden, (p.document.title ?? "").endsWith(ROUTER_TEXT.app), (p.document.title ?? "").startsWith(SETTINGS_TEXT.title)]).toEqual([[`/chats/${b}`, 1], true, true, false]);
  });

  it("a reload at /settings/permissions draws that pane over home, and closing it lands on the last chat (Pat)", async () => {
    const w = world();
    await w.say(pat.email, "Pat's chat");
    const p = await pageAt(w, pat.email, "/settings/permissions", desktop);
    expect([p.byId("set-dialog").hidden, p.byId("set-pane-permissions").hidden, p.byId("app").dataset.view, p.history.entries, p.history.index]).toEqual([
      false,
      false,
      "chat",
      ["/", "/settings", "/settings/permissions"],
      2,
    ]);
    // Home beneath is the chat the list opened.
    const chat = socketChat(p);
    expect(chat).toMatch(/^[0-9a-f-]{36}$/);
    await click(p, "set-back");
    expect([at(p), p.byId("set-pane-general").hidden]).toEqual([["/settings", 1], false]);
    await click(p, "set-close");
    expect([at(p), p.byId("set-dialog").hidden, socketChat(p)]).toEqual([[`/chats/${chat}`, 0], true, chat]);
  });

  it("a reload at a connector's address reads the connector the route decodes", async () => {
    const w = world();
    const asked: string[] = [];
    const p = await pageAt(w, ada.email, "/settings/connectors/host%3Aapi.example.com", desktop, undefined, asked);
    expect([p.byId("set-pane-connector").hidden, p.history.entries]).toEqual([false, ["/", "/settings", "/settings/connectors", "/settings/connectors/host%3Aapi.example.com"]]);
    expect(asked).toContain("/app/connectors/host%3Aapi.example.com");
  });

  it("on a phone /settings is the nav; a pane pushes its address and its Back is the browser's back to the nav", async () => {
    const { p, b } = await twoChats(phone);
    await click(p, "to-more");
    await click(p, "more-settings");
    expect([p.byId("more-sheet").hidden, p.history.entries.slice(1), p.byId("set-frame").className]).toEqual([true, [`/chats/${b}`, "/settings"], "qf-set"]);
    await click(p, "set-nav-devices");
    expect([at(p), p.byId("set-frame").className, p.byId("set-pane-devices").hidden]).toEqual([["/settings/devices", 3], "qf-set is-pane", false]);
    await click(p, "set-back");
    expect([at(p), p.byId("set-frame").className]).toEqual([["/settings", 2], "qf-set"]);
    await click(p, "set-nav-general");
    await click(p, "set-company");
    expect(at(p)).toEqual(["/settings/general/company", 4]);
    await click(p, "set-back");
    expect([at(p), p.byId("set-pane-general").hidden]).toEqual([["/settings/general", 3], false]);
  });

  it("a dialog over Settings owns its own entry: back closes it and Settings stays at its pane", async () => {
    const { p } = await twoChats(desktop);
    p.ui.show("settings");
    await settle();
    await click(p, "set-nav-help");
    await click(p, "set-report");
    expect([p.byId("report").hidden, at(p), p.history.entries[4]]).toEqual([false, ["/settings/help", 4], "/settings/help"]);
    await back(p);
    expect([p.byId("report").hidden, p.byId("set-dialog").hidden, p.byId("set-pane-help").hidden, at(p)]).toEqual([true, false, false, ["/settings/help", 3]]);
    // Closing Settings with the report open pops both: Escape closes the top, the scrim the rest.
    await click(p, "set-report");
    p.ui.closeDialog(p.byId("set-dialog"));
    await settle();
    expect([p.byId("report").hidden, p.byId("set-dialog").hidden, p.history.index, p.location.pathname.startsWith("/chats/")]).toEqual([true, true, 1, true]);
  });
});

describe("[F5] a device change closes every overlay and pops its entries", () => {
  it("the phone's panel sheet closes on the change to a desktop and its entry is gone, so back changes the page", async () => {
    const { p, a, b } = await twoChats(phone);
    await click(p, "open-agent");
    expect(p.history.index).toBe(2);
    p.resize({ desktop: true });
    await settle();
    expect([p.byId("panel-dialog").hidden, at(p)]).toEqual([true, [`/chats/${b}`, 1]]);
    await back(p);
    expect(at(p)).toEqual([`/chats/${a}`, 0]);
  });

  it("Settings and a dialog over it close on the change, and the history is back at the page beneath", async () => {
    const { p, b } = await twoChats(phone);
    p.ui.show("connectors");
    await settle();
    await click(p, "set-report");
    expect(p.history.index).toBe(4);
    p.resize({ tablet: true });
    await settle();
    expect([p.byId("set-dialog").hidden, p.byId("report").hidden, at(p)]).toEqual([true, true, [`/chats/${b}`, 1]]);
  });
});
