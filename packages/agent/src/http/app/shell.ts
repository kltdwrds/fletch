// The page's frame (M23.1, drawn on the Fletch system at M27.2): the AppShell of the canvas's `Main`. On a phone
// (< 768 px) the five-slot TabBar (Chat, Feed, Goals, Library, More; Ideas stays out, M23) under the page, the
// chat's floating header and the chats drawer as a 75 % sheet, the agent's panel a bottom sheet; from 768 px the
// 72 px Rail (Chat, Search, Feed, Goals, Library, then Get the app and the Settings menu) and the agent's profile
// panel pinned inline at the end edge, with the chats list column between them from 1024 px and, from 768 to 1023
// px, the header's Chats pill opening the list as an overlay (design review 1, M29.2). The list column and the
// panel resize on the system's separators, and each viewer's widths stay in the browser. Which device the page is on
// is a script's question only where a script must act on it (`device()`); the layout is the system's container
// queries on `#app.qf-vp`. Settings is a dialog (settings.ts), the panel's content is panel.ts', and every
// overlay goes through the one helper in `COMMON_SCRIPT`. Layout state, which pane is open, is the page's own
// and is never stored (the columns' widths are the viewer's own and stay in the browser); everything else the frame shows comes from the objects through the other modules. The
// frame decides nothing: it shows a view, opens an overlay and asks the routes the questions it draws.

import { CHATS_FILTER_FIELD, CHATS_FILTER_LIST } from "./chats-filter.ts";
import { CHATS_MENU_MARKUP, CHATS_TEXT } from "./chats-list.ts";
import { ICON_CSS, type IconName, ic, icActive } from "./icons.ts";
import { OVERLAY_SCRIPT } from "./overlays.ts";
import { TOKENS_CSS } from "./tokens.ts";

/** The routes: the tabs of the bar and the rail, in order. Settings, Connectors and Permissions are Settings' panes. */
export const TAB_VIEWS = ["chat", "feed", "goals", "library"] as const;
/** Every view `#stage` can show (M27.2: the settings pages became the Settings dialog's panes). */
export const APP_VIEWS = [...TAB_VIEWS] as const;

/** The tabs' labels, one table so the markup and a test read the same words. */
export const TAB_TEXT: Record<(typeof TAB_VIEWS)[number], string> = { chat: "Chat", feed: "Feed", goals: "Goals", library: "Library" };

/** The shell's other words: the buttons the canvas names and what the overlays say. */
export const SHELL_TEXT = {
  agent: "Your agent",
  agentBadge: "agent",
  chats: "Chats",
  openChats: "Open chats",
  closeChats: "Close chats",
  search: "Search",
  settings: "Settings",
  more: "More",
  report: "Report an issue",
  reportLine: "I'd like to report an issue: ",
  newChat: "New side chat",
  invite: "Invite",
  openAgent: "Open your agent",
  getApp: "Get the app",
  resizeList: "Resize panel",
  resizePanel: "Resize profile panel",
  cancel: "Cancel",
};

/**
 * Invite's words (design review 1, B2): the canvas's popover from 768 and BottomSheet at 390, holding its illustration,
 * the title, a body that says what the link is, and the primary Copy. The canvas's code and referral reward are not
 * qyvr's (an admin adds a colleague in Settings; the link is where they sign in), so the body says that instead.
 */
export const INVITE_TEXT = {
  title: "Invite friends",
  body: "Send a colleague the link to your company's workspace. Once an admin has added them in Settings, they sign in there and meet their own agent.",
  copy: "Copy invite link",
  copied: "Link copied",
  field: "Invite link",
  manual: "This browser did not let the page copy. The link is selected in the field: copy it from there.",
};

/** A size token's pixels, read from the system's compiled tokens, so the columns' bounds are the system's own. */
const tokenPx = (name: string): number => {
  const m = new RegExp(`--${name}:\\s*(\\d+)px`).exec(TOKENS_CSS);
  if (!m) throw new Error(`the system has no size token ${name}`);
  return Number(m[1]);
};
/**
 * The columns' resize bounds (AppShell, design review 1): the list column 240–420 (`size-listcol-min`,
 * `size-listcol-max`), 240 by default, collapsing when dragged under 160; the panel 320–480 around `size-panel`. The
 * collapse threshold, the panel's range and the 16 px arrow step are the system's inferred values.
 */
export const COLUMNS = {
  list: { min: tokenPx("size-listcol-min"), max: tokenPx("size-listcol-max"), def: tokenPx("size-listcol-min"), dir: 1, collapseAt: 160 },
  panel: { min: 320, max: 480, def: tokenPx("size-panel"), dir: -1, collapseAt: 0 },
  step: 16,
} as const;
/** Where this browser keeps the viewer's column widths. */
export const WIDTHS_KEY = "qyvr.columns";

/** The agent's mark in its avatar disc, whichever size it is drawn at. */
export const AGENT_GLYPH = ic("sparkle", "md");
/** The tabs' and the rail's glyphs, the canvas's `Ico` names for each view (`railDefs`, `tabDefs`). */
const TAB_GLYPH: Record<(typeof TAB_VIEWS)[number], IconName> = { chat: "chat", feed: "feed", goals: "goal", library: "library" };
/**
 * The glyphs the scripts copy into the nodes they draw (the card's shield, a Recents row's chat, the panel's row
 * tiles, an artifact's kebab, the Browser's hero, a default's check, a digest row's tiles, Show n more, a menu
 * item's, a Library row's tile): every name a script passes to `icon(…)`, so a name missing here fails the M27.1 test, not the page.
 */
export const SCRIPT_GLYPHS = ["shield", "chat", "check", "grid", "monitor", "bell", "clock", "chev", "dots", "globe", "sparkle", "pencil", "archive", "trash", "pin", "copy", "download", "restore", "at", "user", "folder", "data", "plug", "chevup", "chevdown", "back", "file", "image", "smile", "reply", "plus"] as const satisfies readonly IconName[];

/** The shell's own rules: what the canvas's `.app` frame and inline styles say and the bundle does not carry. */
export const SHELL_CSS = `
body { margin: 0; background: var(--bg-primary); }
#app { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; font-size: 16px; line-height: 22px; }
#app * { box-sizing: border-box; }
#app [hidden] { display: none !important; }
#app button { font-family: inherit; }
${ICON_CSS}
/* A place the canvas draws active (\`a\`): the rail item or tab that is current shows its Fill cut (TabBar, I2). */
.ico-act, [aria-current="page"] .ico-rest { display: none; }
[aria-current="page"] .ico-act { display: block; }
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.vh:focus { position: static; width: auto; height: auto; clip: auto; }
.agent-av { position: relative; background: var(--fill-blue); color: #000; overflow: visible; }
#head { position: absolute; left: 0; right: 0; top: 0; z-index: 20; }
#head, #head-in { pointer-events: none; }
#head-in > * { pointer-events: auto; }
#head.qf-phead { position: sticky; }
.chat-head-in { position: relative; display: flex; align-items: flex-start; justify-content: flex-end; gap: 8px; height: 76px; padding: 12px 16px 0; }
.chat-head-in #open-chats { position: absolute; left: 12px; top: 16px; }
.chat-head-in #chats-pill { position: absolute; left: 16px; top: 12px; }
.chat-head-in #open-agent { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; }
.unread-dot { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--fill-blue); }
#open-chats { position: relative; }
#conn { position: absolute; left: 16px; right: 16px; top: 80px; z-index: 19; margin: 0; text-align: center; font: 400 13px/18px var(--font-sans); color: var(--text-secondary); }
.drawer-top { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.drawer-sheet { display: flex; flex-direction: column; gap: 2px; width: 75%; height: 100%; padding: 12px; background: var(--bg-primary); box-shadow: var(--elevation-3); overflow: auto; }
/* The chats drawer's layer (AppShell, Motion): the phone's veil under the sheet, or from 768 the overlay's click catcher. */
.qf-drawer-wrap { position: fixed; inset: 0; z-index: 50; display: flex; align-items: stretch; justify-content: flex-start; }
.qf-drawer-wrap > .qf-drawer-scrim { position: absolute; inset: 0; background: var(--fill-blur-ultrathin); }
.qf-drawer-wrap > .drawer-sheet { position: relative; }
/* The menu and its backdrop share one layer, so one .is-closing runs the action sheet's and its veil's exits. */
.menu-layer { display: contents; }
/* The panel's header row holds its X, and the body scrolls under that row (M29.5, I1). */
#panel { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; width: 100%; }
.panel-head { position: relative; flex: none; width: 100%; height: 56px; }
.panel-scroll { display: flex; flex-direction: column; align-items: center; gap: 12px; flex: 1 1 auto; min-height: 0; width: 100%; padding: 0 16px 44px; overflow: auto; }
#panel-pin { position: relative; padding: 0; overflow: hidden; }
#panel-dialog { padding-top: 0; }
#panel-dialog .panel-head { height: 48px; }
#panel-dialog #close-sheet { inset-inline-end: 16px; top: 8px; }
.drawer-sheet .qf-colresize, .qf-listcol--over .qf-colresize { display: none; }
#panel-dialog .panel-hero { display: none; }
#panel-dialog .panel-scroll { padding: 4px 16px 8px; }
.panel-name { font: 500 22px/28px var(--font-sans); }
.panel-meta { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 14px; line-height: 20px; }
.panel-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fill-tertiary); }
.panel-dot[data-live="true"] { background: var(--status-success); }
.seg2 { display: flex; width: 100%; height: 36px; padding: 4px; border-radius: 9999px; background: var(--fill-primary); }
.seg2 .tab { display: flex; flex: 1; align-items: center; justify-content: center; position: relative; height: 28px; border: 0; border-radius: 16px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.seg2 .tab[aria-selected="true"] { background: var(--fill-secondary-elevated); color: var(--text-primary); box-shadow: var(--elevation-1); }
/* With the system's sliding indicator (SegmentedControl, .qf-seg--ind) the picked tab drops its own fill. */
.seg2.qf-seg--ind { position: relative; }
.seg2.qf-seg--ind .tab { z-index: 1; }
.seg2.qf-seg--ind .tab[aria-selected="true"] { background: transparent; box-shadow: none; }
.seg2 .qf-seg-ind { background: var(--fill-secondary-elevated); }
#menu { position: absolute; z-index: 55; text-align: left; }
#menu .qf-menu-item { font-size: 14px; line-height: 20px; gap: 10px; width: 100%; border: 0; background: transparent; color: inherit; text-align: left; }
#menu .qf-menu-lead { margin-inline-end: 0; }
#more-sheet .qf-sheet-row { border: 0; background: transparent; color: inherit; width: 100%; text-align: left; font-family: inherit; }
.qf-sheet-row .qf-lead { display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
#invite-pop.qf-pop { position: absolute; z-index: 55; }
#invite-pop .invite-art { flex-shrink: 0; height: 150px; background: linear-gradient(135deg, var(--fill-blue), var(--fill-primary)); }
#invite-pop .invite-in { display: flex; flex-direction: column; gap: 12px; padding: 0 20px; }
#invite-pop h2 { margin: 0; font: 500 17px/22px var(--font-sans); }
#invite-pop p { margin: 0; font-size: 14px; line-height: 20px; color: var(--text-secondary); }
#invite-pop-copy { height: 48px; background: var(--fill-blue); color: #fff; font-size: 17px; }
#invite-pop.qf-dlg { gap: 12px; padding-inline: 16px; }
#invite-pop.qf-dlg .invite-art { margin-top: 8px; border-radius: 24px; }
#invite-pop.qf-dlg .invite-in { padding: 0; }
/* Under reduced motion a Menu and a popover keep the bundle's enter and exit (M29.6) without their nudge and scale, so
   each is a plain fade over the same duration. */
@media (prefers-reduced-motion: reduce) { .qf-menu, .qf-pop { --qf-nudge: 0px; --qf-scale-pop: 1; } }
`;

const tabBtn = (v: (typeof TAB_VIEWS)[number]) =>
  `<button id="to-${v}" aria-label="${TAB_TEXT[v]}">${icActive(TAB_GLYPH[v], "md")}</button>`;
const railBtn = (id: string, label: string, glyph: IconName) =>
  `<button id="${id}" class="qf-rail-item" aria-label="${label}" title="${label}"><span>${icActive(glyph, "lg")}</span></button>`;
const sheetRow = (id: string, glyph: IconName, label: string) =>
  `<button id="${id}" class="qf-sheet-row"><span class="qf-lead">${ic(glyph, "sm")}</span>${label}</button>`;
/**
 * A row of the rail's Settings menu on Menu's centre line (design review 1, G1): the 20 px leading box, the label,
 * and the trailing shortcut. A row with no object yet is a disabled stub: drawn, never actionable.
 */
const menuRow = (id: string, glyph: IconName, label: string, o: { kbd?: string; stub?: boolean } = {}) =>
  `<button id="${id}" class="qf-menu-item" role="menuitem"${o.stub ? ' disabled aria-disabled="true" data-disabled=""' : ""}><span class="qf-menu-lead">${ic(glyph, "xs")}</span><span class="qf-lbl">${label}</span>${o.kbd ? `<span class="qf-kbd">${o.kbd}</span>` : ""}</button>`;
/** The rail Settings menu's rows, in the canvas's order, with the shortcuts it writes. */
type MenuRow = { id: string; glyph?: IconName; label?: string; kbd?: string; stub?: boolean };
export const SETTINGS_MENU: readonly MenuRow[] = [
  { id: "settings-menu-keys", glyph: "keyboard", label: "Keyboard shortcuts", kbd: "⌘/", stub: true },
  { id: "settings-menu-apps", glyph: "download", label: "Download apps", stub: true },
  { id: "settings-menu-report", glyph: "flag", label: SHELL_TEXT.report },
  { id: "settings-menu-sep" },
  { id: "settings-menu-open", glyph: "gear", label: SHELL_TEXT.settings, kbd: "⌘," },
];
const agentAvatar = (size: number) => `<span class="qf-avatar agent-av" style="width:${size}px;height:${size}px">${AGENT_GLYPH}</span>`;
/** A column's resize separator (AppShell's `.qf-colresize` and `.qf-panel-resize`): a drag or an arrow key moves its edge. */
const separator = (id: string, label: string, c: { min: number; max: number; def: number }, cls = "") =>
  `<div id="${id}"${cls ? ` class="${cls}"` : ""} role="separator" aria-orientation="vertical" aria-label="${label}" aria-valuemin="${c.min}" aria-valuemax="${c.max}" aria-valuenow="${c.def}" tabindex="0"></div>`;

/**
 * The frame around the views, on the system's classes. Each element has one id at every width: the Rail and the
 * TabBar are two navs (`#rail-<view>`, `#to-<view>`), the chats list host is the list column from 1024 px, the
 * Chats pill's overlay from 768 and the drawer's sheet under it, the panel's content (`#panel`) sits in the pinned
 * column from 768 or in its dialog. One agent avatar is on the page: the header's, or the open panel's.
 * Overlays live in `#overlays` until the helper opens them over `#scrim`; the menus' static items in `#menu-home`.
 */
export function shellMarkup(p: { chat: string; views: string; panel: string; settings: string; search: string }): string {
  return `<div id="app" class="qf-vp">
<div id="shell" class="qf-shell">
<nav id="rail" class="qf-rail" aria-label="Primary">
  ${railBtn("rail-chat", TAB_TEXT.chat, "chat")}
  ${railBtn("rail-search", SHELL_TEXT.search, "search")}
  ${railBtn("rail-feed", TAB_TEXT.feed, "feed")}
  ${railBtn("rail-goals", TAB_TEXT.goals, "goal")}
  ${railBtn("rail-library", TAB_TEXT.library, "library")}
  <div class="qf-rail-rule"></div>
  <div class="qf-rail-spacer"></div>
  <button id="rail-app" class="qf-rail-item" aria-label="${SHELL_TEXT.getApp}" title="${SHELL_TEXT.getApp}" disabled><span>${ic("phone", "lg")}</span></button>
  <button id="to-settings" class="qf-rail-item" aria-label="${SHELL_TEXT.settings}" aria-haspopup="menu" aria-expanded="false"><span>${ic("equals", "lg")}</span></button>
</nav>
<aside id="drawer" class="qf-listcol qf-listcol--chat" aria-label="${SHELL_TEXT.chats}">
  <div class="drawer-top">${CHATS_FILTER_FIELD}<button id="archived-btn" class="qf-ibtn qf-ibtn--28" aria-haspopup="menu" aria-expanded="false" aria-label="${CHATS_TEXT.listOptions}">${ic("dots", "xs")}</button></div>
  <button id="close-drawer" class="vh">${SHELL_TEXT.closeChats}</button>
  <div id="chats"><div class="qf-listhead">${CHATS_TEXT.side}<button id="new-chat" class="qf-ibtn qf-ibtn--28" aria-label="${SHELL_TEXT.newChat}">${ic("plus", "xs")}</button></div></div>
  <div id="archived" hidden></div>
  ${CHATS_FILTER_LIST}
  <div class="qf-colresize">${separator("list-resize", SHELL_TEXT.resizeList, COLUMNS.list)}<span class="qf-colresize-line"></span></div>
</aside>
<aside id="lib-col" class="qf-listcol qf-listcol--lib" aria-label="${TAB_TEXT.library}" hidden><div id="lib-sections"></div></aside>
<div id="stage" class="qf-main">
<header id="head" class="chat-head"><div id="head-in" class="chat-head-in">
  <button id="open-chats" class="qf-ibtn qf-ibtn--glass qf-only-phone" aria-label="${SHELL_TEXT.openChats}">${ic("menu", "md")}<span id="unread-dot" class="unread-dot" hidden></span></button>
  <button id="chats-pill" class="qf-pillbtn qf-pillbtn--chats" aria-label="${SHELL_TEXT.openChats}">${ic("menu", "md")}${SHELL_TEXT.chats}</button>
  <button id="open-agent" class="qf-side-av" aria-label="${SHELL_TEXT.openAgent}">${agentAvatar(48)}<span class="nm">${SHELL_TEXT.agent}</span></button>
  <h1 id="view-title" hidden>${TAB_TEXT.chat}</h1>
  <div class="qf-phead-act">
    <button id="head-invite" class="qf-pillbtn qf-pillbtn--sm" aria-haspopup="dialog" aria-expanded="false" hidden>${ic("gift", "xs")}<span id="head-invite-label">${SHELL_TEXT.invite}</span></button>
  </div>
</div></header>
<p id="conn" role="status" hidden></p>
${p.chat}
${p.views}
</div>
<aside id="panel-pin" class="qf-panel qf-hide-phone" aria-label="${SHELL_TEXT.agent}">${separator("panel-resize", SHELL_TEXT.resizePanel, COLUMNS.panel, "qf-panel-resize")}${p.panel}</aside>
</div>
<nav id="tabs" class="qf-tabbar qf-tabbar--app qf-only-phone" aria-label="Main navigation">
  ${TAB_VIEWS.map(tabBtn).join("")}
  <button id="to-more" aria-label="${SHELL_TEXT.more}" aria-haspopup="dialog">${icActive("equals", "md")}</button>
</nav>
<div id="overlays" hidden>
  <div id="more-sheet" class="qf-dlg" role="dialog" aria-label="${SHELL_TEXT.more}"><span class="qf-grab qf-only-phone"></span><div class="qf-dlg-body" style="padding:8px 16px 0;gap:0">
    ${sheetRow("more-search", "search", SHELL_TEXT.search)}
    <div class="qf-sheet-rule"></div>
    ${sheetRow("more-report", "flag", SHELL_TEXT.report)}
    ${sheetRow("more-settings", "gear", SHELL_TEXT.settings)}
  </div></div>
  <div id="invite-pop" class="qf-pop" role="dialog" aria-label="${INVITE_TEXT.title}"><span class="qf-grab qf-only-phone"></span><div class="invite-art" aria-hidden="true"></div><div class="invite-in">
    <h2>${INVITE_TEXT.title}</h2><p>${INVITE_TEXT.body}</p>
    <input id="invite-pop-link" class="qf-input qf-input--fill" readonly aria-label="${INVITE_TEXT.field}" hidden><p id="invite-pop-note" role="status" hidden></p>
    <button id="invite-pop-copy" class="qf-btn qf-btn--primary">${INVITE_TEXT.copy}</button>
  </div></div>
  <div id="panel-dialog" class="qf-dlg qf-dlg--480" role="dialog" aria-label="${SHELL_TEXT.agent}"><span class="qf-grab qf-only-phone"></span></div>
  ${p.settings}
  <div id="confirm" class="qf-dlg qf-dlg--416" role="alertdialog" aria-labelledby="confirm-title">
    <div class="qf-dlg-head"><h2 id="confirm-title"></h2></div>
    <div class="qf-dlg-body"><p id="confirm-body"></p><div class="qf-dlg-act"><button id="confirm-cancel" class="qf-btn qf-btn--secondary">${SHELL_TEXT.cancel}</button><button id="confirm-ok" class="qf-btn qf-btn--destructive"></button></div></div>
  </div>
</div>
<div id="menu-home" hidden>
  ${CHATS_MENU_MARKUP}
  ${SETTINGS_MENU.map((r) => (r.glyph && r.label ? menuRow(r.id, r.glyph, r.label, r) : `<div id="${r.id}" class="qf-menu-sep"></div>`)).join("\n  ")}
</div>
<div id="invite-backdrop" class="qf-backdrop" hidden></div>
<div id="menu-layer" class="menu-layer"><div id="menu-backdrop" class="qf-backdrop" hidden></div>
<div id="menu" class="qf-menu" role="menu" hidden></div></div>
<div id="scrim" class="qf-scrim2" hidden></div>
${p.search}
<div id="glyphs" hidden>${SCRIPT_GLYPHS.map((g) => ic(g, "sm").replace("<svg ", `<svg id="glyph-${g}" `)).join("")}</div>
</div>`;
}

/**
 * The helpers every module's script uses, and the overlay helper (M27.2): `openDialog(node, {form})` puts a node on
 * the system's scrim (Dialog, r64; on a phone the form the bundle names: a bottom sheet, the 358 centred dialog,
 * full width or full page), `openMenu(anchor, items)` opens the one Menu (a popover from 768 px, an action sheet
 * under it), `confirmDialog(title, body, action)` asks on the ConfirmDialog, `closeOverlays()` closes them all.
 * Escape and the scrim close the top one. A node goes back where it came from when its overlay closes: into its
 * parent before the sibling it stood before (M29.1), never at the parent's end.
 */
export const COMMON_SCRIPT = `const $ = (id) => document.getElementById(id);
const el = (tag, text) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = String(text); return e; };
// A copy of one of the shell's glyphs (the hidden #glyphs set in the markup, each in its default weight) for a node
// the script draws, at the canvas's tier for its place.
const icon = (name, tier) => { const s = $("glyph-" + name).cloneNode(true); s.removeAttribute("id"); s.setAttribute("class", "ico ico-" + tier); return s; };
// Every route the page asks goes through api(): a 401 means the session is gone (it expired, or this browser signed
// out in another tab), so the page goes to sign-in instead of drawing an empty or failed answer.
const toLogin = () => location.assign("/login");
const api = async (path, init) => { const r = await fetch(path, init); if (r.status === 401) toLogin(); return r; };
const post = (path, body, method = "POST") => api(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
// A read that failed throws its code on \`code\`; what the person reads is said where it is caught, in words.
const getJson = async (path) => { const r = await api(path); const b = await r.json().catch(() => ({ code: "BAD_ANSWER" })); if (!r.ok || b.ok === false) throw Object.assign(new Error("not read"), { code: b.code || "HTTP_" + r.status }); return b; };
const coded = (node, text, code) => { node.textContent = text; node.dataset.code = code || ""; return node; };
const couldNot = (node, what, e) => coded(node, "Could not read " + what + " just now. Reload the page to try again.", e && e.code);
const failedTo = async (node, what, r) => coded(node, what + ": that did not go through. Try again; if it keeps happening, tell an admin.", (await r.json().catch(() => ({}))).code);
function rows(table, head, list) {
  table.replaceChildren();
  const tr = el("tr"); for (const h of head) tr.append(el("th", h)); table.append(tr);
  for (const cells of list) { const r = el("tr"); for (const c of cells) { const td = el("td"); if (c instanceof Node) td.append(c); else td.textContent = String(c ?? ""); r.append(td); } table.append(r); }
}
// The device, for a script that must act on it; the layout itself is the bundle's container queries on #app.qf-vp.
const media = (q) => typeof matchMedia === "function" ? matchMedia(q) : null;
const atTablet = media("(min-width: 768px)"), atDesktop = media("(min-width: 1024px)");
const device = () => atDesktop && atDesktop.matches ? "desktop" : atTablet && atTablet.matches ? "tablet" : "phone";
${OVERLAY_SCRIPT}`;

export const SHELL_SCRIPT = `// One view at a time in #stage: a tab and a rail item say so with aria-current, and a view loads when it is shown.
const VIEWS = ${JSON.stringify(APP_VIEWS)}, TABS = ${JSON.stringify(TAB_VIEWS)};
const TITLE = ${JSON.stringify(TAB_TEXT)};
const SHELL = ${JSON.stringify(SHELL_TEXT)};
const COLS = ${JSON.stringify(COLUMNS)}, WIDTHS_KEY = ${JSON.stringify(WIDTHS_KEY)};
const INVITE = ${JSON.stringify(INVITE_TEXT)};
const SETTINGS_ROWS = ${JSON.stringify(SETTINGS_MENU.map((r) => r.id))};
const LOAD = { feed, goals, library };
// What used to be a page and is now an overlay: Settings (on its nav on a phone, General wider) and its panes, and
// the panel's tabs.
const SETTINGS_OF = { settings: "", connectors: "connectors", connector: "connector", permissions: "permissions" };
const PANEL_OF = { approvals: "approvals", jobs: "upcoming" };
let shown = "chat", panelClosed = false, scrolled = false;
function show(view) {
  closeOverlays(); closeInvite();
  if (view in SETTINGS_OF) { openSettings(SETTINGS_OF[view]); return; }
  if (PANEL_OF[view]) { openPanel(PANEL_OF[view]); return; }
  shown = view; scrolled = false;
  $("app").dataset.view = view;
  for (const v of VIEWS) $(v).hidden = v !== view;
  paint();
  if (LOAD[view]) LOAD[view]();
}
const markCurrent = (node, on) => { if (on) node.setAttribute("aria-current", "page"); else node.removeAttribute("aria-current"); };
// The frame as the device and the view say: the selected tab and rail item, the chats list host, the Library's
// column, the pinned panel, the header's form, the columns' widths. One agent avatar: the header's hides while the
// panel is pinned open beside it.
function paint() {
  const d = device(), chat = shown === "chat", pinned = chat && d !== "phone" && !panelClosed;
  for (const v of TABS) { markCurrent($("to-" + v), v === shown && !isOpen($("more-sheet"))); markCurrent($("rail-" + v), v === shown); }
  markCurrent($("to-more"), isOpen($("more-sheet")));
  const drawer = $("drawer");
  if (!isOpen(drawer)) { drawer.className = d === "phone" ? "drawer-sheet" : "qf-listcol qf-listcol--chat"; drawer.hidden = d === "phone" || !chat; }
  $("lib-col").hidden = shown !== "library";
  $("panel-pin").hidden = !chat || panelClosed;
  drawWidths();
  // The chat's header floats over the thread; every other route heads itself with the PageHeader, collapsing on scroll.
  $("head").className = chat ? "chat-head" : "qf-phead" + (shown === "library" ? "" : " qf-phead--768") + (scrolled ? " is-scrolled" : "");
  $("head-in").className = chat ? "chat-head-in" : "qf-phead-in";
  $("view-title").textContent = TITLE[shown]; $("view-title").hidden = chat;
  for (const id of ["open-chats", "chats-pill"]) $(id).hidden = !chat;
  $("open-agent").hidden = !chat || pinned;
  $("head-invite").hidden = !chat || !canInvite;
  const body = document.body;
  if (body) body.className = "qf-" + d;
}
$("stage").onscroll = () => { const s = $("stage").scrollTop > 8; if (s !== scrolled) { scrolled = s; paint(); } };
for (const v of TABS) { $("to-" + v).onclick = () => show(v); $("rail-" + v).onclick = () => show(v); }
// The count on the panel's Approvals tab and the dot on the drawer's button come from the route, which counts
// only this person's cards; a chat with a card waiting wears the same dot in the list. A count that could not be
// read says so; it is never drawn as nothing waiting.
let waiting = new Map();
function setCount(n) {
  const known = n !== null, c = $("approvals-count");
  c.hidden = known && n === 0; c.textContent = known ? String(n) : "?";
  c.setAttribute("aria-label", known ? n + " waiting for you" : "Approvals could not be read just now");
  $("unread-dot").hidden = !(known && n > 0);
  for (const id of ["open-chats", "chats-pill"]) $(id).setAttribute("aria-label", known && n > 0 ? SHELL.openChats + ", " + n + " waiting for you" : SHELL.openChats);
}
let counting = null;
function refreshCount() {
  if (counting) return counting;
  counting = getJson("/app/approvals").then((a) => { waiting = new Map(); for (const c of a.cards) waiting.set(c.chatId, (waiting.get(c.chatId) || 0) + 1); setCount(a.cards.length); drawUnread(); }, () => setCount(null)).finally(() => { counting = null; });
  return counting;
}
// The chats list: the list column from 1024 px. On a phone the same node slides over the page as a 75 % sheet; from
// 768 to 1023 px, or once the column is collapsed, the header's Chats pill opens it as the list overlay beside the
// rail, and on a desktop the pill gives a collapsed column back at its default width.
function openDrawer() {
  const d = device();
  if (d === "desktop" && widths.collapsed) { widths.collapsed = false; widths.list = COLS.list.def; saveWidths(); paint(); return; }
  $("drawer").className = d === "phone" ? "drawer-sheet qf-drawer" : "qf-listcol qf-listcol--over";
  openDialog($("drawer"), { form: "start", onClose: paint });
}
$("open-chats").onclick = openDrawer;
$("chats-pill").onclick = openDrawer;
$("close-drawer").onclick = () => closeDialog($("drawer"));
// The columns' widths: the list column's end edge and the panel's start edge carry the system's separator. A drag
// or an arrow key (Home and End for the ends) moves the edge; the list clamps to its bounds and collapses when
// dragged under its threshold, the panel clamps to its own. They stay in this browser for the viewer; with no
// storage (a private window, blocked site data) the page draws the defaults.
let widths = { list: COLS.list.def, panel: COLS.panel.def, collapsed: false };
const clampW = (k, w) => Math.max(COLS[k].min, Math.min(COLS[k].max, Math.round(w)));
try {
  const s = JSON.parse(localStorage.getItem(WIDTHS_KEY) || "null");
  if (s && typeof s === "object") widths = { list: clampW("list", Number(s.list) || COLS.list.def), panel: clampW("panel", Number(s.panel) || COLS.panel.def), collapsed: s.collapsed === true };
} catch (e) {}
function saveWidths() { try { localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths)); } catch (e) {} }
function drawWidths() {
  $("shell").className = "qf-shell" + (widths.collapsed ? " is-list-collapsed" : "");
  const drawer = $("drawer");
  if (drawer.className.includes("qf-listcol--chat")) drawer.setAttribute("style", "width:" + widths.list + "px"); else drawer.removeAttribute("style");
  $("panel-pin").setAttribute("style", "width:" + widths.panel + "px");
  $("list-resize").setAttribute("aria-valuenow", String(widths.list)); $("panel-resize").setAttribute("aria-valuenow", String(widths.panel));
}
// A collapse is kept at once: the column (and its separator) leaves the page mid-drag.
function setWidth(k, w) {
  if (k === "list" && w < COLS.list.collapseAt) { if (!widths.collapsed) { widths.collapsed = true; saveWidths(); } }
  else { widths[k] = clampW(k, w); if (k === "list") widths.collapsed = false; }
  drawWidths();
}
function resizer(sep, k) {
  const c = COLS[k]; let drag = null;
  sep.onpointerdown = (e) => { try { sep.setPointerCapture(e.pointerId); } catch (x) {} drag = { x: e.clientX, w: widths[k] }; };
  sep.onpointermove = (e) => { if (drag) setWidth(k, drag.w + c.dir * (e.clientX - drag.x)); };
  sep.onpointerup = sep.onpointercancel = sep.onlostpointercapture = () => { if (drag) saveWidths(); drag = null; };
  sep.onkeydown = (e) => {
    const to = { ArrowLeft: widths[k] - c.dir * COLS.step, ArrowRight: widths[k] + c.dir * COLS.step, Home: c.min, End: c.max }[e.key];
    if (to === undefined) return;
    e.preventDefault(); setWidth(k, Math.max(c.min, to)); saveWidths();
  };
}
resizer($("list-resize"), "list");
resizer($("panel-resize"), "panel");
// The panel: pinned inline at the end of the chat from 768 px; on a phone its content moves into the panel's dialog,
// a bottom sheet, and back when that closes. It opens from the header's avatar and closes on its X.
const pinnable = () => shown === "chat" && device() !== "phone";
function openPanel(tab) {
  if (pinnable()) { panelClosed = false; paint(); loadPanel(tab); return; }
  borrow($("panel"), $("panel-dialog"));
  openDialog($("panel-dialog"), { form: "sheet", onClose: () => giveBack($("panel")) });
  loadPanel(tab);
}
function closePanel() { if (isOpen($("panel-dialog"))) closeDialog($("panel-dialog")); else { panelClosed = true; paint(); } }
$("open-agent").onclick = () => openPanel();
$("close-sheet").onclick = closePanel;
// The phone's More sheet (Search, Report an issue, Settings) and the rail's Settings menu (its rows above; Keyboard
// shortcuts and Download apps are disabled stubs until they have objects).
function report() { show("chat"); $("t").value = SHELL.reportLine; }
$("to-more").onclick = () => { if (isOpen($("more-sheet"))) closeDialog($("more-sheet")); else { openDialog($("more-sheet"), { form: "sheet", onClose: paint }); paint(); } };
$("more-search").onclick = () => { closeOverlays(); srchOpen(); };
$("more-report").onclick = report;
$("more-settings").onclick = () => show("settings");
$("to-settings").onclick = () => openMenu($("to-settings"), SETTINGS_ROWS.map((id) => $(id)));
$("settings-menu-report").onclick = () => { closeMenu(); report(); };
$("settings-menu-open").onclick = () => { closeMenu(); show("settings"); };
// Invite, for an admin (B2): from 768 the system's popover hung under the pill, right-aligned; on a phone the same
// node as a BottomSheet. Copy puts the company's address, where a member the admin has added signs in, on the
// clipboard; a refused clipboard shows the link in a read-only field, selected, so the person copies it themself.
// The button's words are its own again each time Invite opens; the pill always reads Invite.
let canInvite = false, inviteOpen = false;
const inviteLink = () => location.protocol + "//" + location.host + "/";
function resetInvite() { $("invite-pop-copy").textContent = INVITE.copy; $("invite-pop-link").hidden = true; $("invite-pop-note").hidden = true; }
function inviteClosed() { inviteOpen = false; $("head-invite").setAttribute("aria-expanded", "false"); resetInvite(); }
function openInvite() {
  if (inviteOpen) { closeInvite(); return; }
  closeOverlays(); resetInvite();
  const n = $("invite-pop"), pill = $("head-invite");
  settle(n);
  inviteOpen = true; pill.setAttribute("aria-expanded", "true");
  if (device() === "phone") { n.className = "qf-dlg qf-dlg--480"; n.removeAttribute("style"); openDialog(n, { form: "sheet", onClose: inviteClosed }); return; }
  n.className = "qf-pop"; borrow(n, $("app")); n.hidden = false; $("invite-backdrop").hidden = false;
  if (pill.getBoundingClientRect && $("app").getBoundingClientRect) {
    const r = pill.getBoundingClientRect(), a = $("app").getBoundingClientRect();
    n.setAttribute("style", "top:" + Math.round(r.bottom - a.top + 8) + "px;right:" + Math.round(a.right - r.right) + "px");
  }
}
function closeInvite() {
  if (!inviteOpen) return;
  const n = $("invite-pop");
  if (isOpen(n)) { closeDialog(n); return; }
  inviteOpen = false; $("head-invite").setAttribute("aria-expanded", "false");
  exit([n], [n], () => { n.hidden = true; n.removeAttribute("style"); giveBack(n); $("invite-backdrop").hidden = true; resetInvite(); });
}
$("head-invite").onclick = openInvite;
$("invite-backdrop").onclick = closeInvite;
$("invite-pop-copy").onclick = async () => {
  const link = inviteLink();
  let ok = false;
  try { await navigator.clipboard.writeText(link); ok = true; } catch (e) {}
  const f = $("invite-pop-link");
  if (ok) { $("invite-pop-copy").textContent = INVITE.copied; f.hidden = true; $("invite-pop-note").hidden = true; return; }
  f.value = link; f.hidden = false; $("invite-pop-copy").textContent = INVITE.copy;
  $("invite-pop-note").textContent = INVITE.manual; $("invite-pop-note").hidden = false;
  if (f.focus) f.focus();
  if (f.select) f.select();
};
if (document.addEventListener) document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeInvite(); });
// Invite is a company's (spec section 4 cuts members from a standalone deploy, which has one owner).
getJson("/me").then((me) => { canInvite = me.shape === "company" && (me.role === "admin" || me.role === "owner"); paint(); }, () => {});
// A device change closes what was open (a sheet does not become a dialog mid-way) and draws the frame again.
const darkScheme = media("(prefers-color-scheme: dark)");
function theme() { if (document.body) document.body.setAttribute("data-theme", modeTheme(!!(darkScheme && darkScheme.matches))); }
function relayout() { closeOverlays(); closeInvite(); paint(); if (shown === "library") libRedraw(); }
for (const q of [atTablet, atDesktop]) if (q && q.addEventListener) q.addEventListener("change", relayout);
if (darkScheme && darkScheme.addEventListener) darkScheme.addEventListener("change", theme);
theme();
show("chat");
// A link made by the Library's Share opens the Library, which opens its file.
if (new URLSearchParams(location.search).get("file")) show("library");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
chats(new URLSearchParams(location.search).get("chat"));
if (pinnable()) loadPanel();`;
