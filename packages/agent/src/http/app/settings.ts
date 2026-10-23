// Settings (M23.1's view, the Settings dialog at M27.2, its panes on the Fletch system at M27.6): the system's
// SettingsDialog, an 800 by 600 dialog with the nav column (General, Connectors, Permissions, Devices, Messaging
// channels, Help & support, Log out at the foot) and the pane, narrower on a tablet, and on a phone a bottom sheet
// whose nav is the first page and whose panes push with Back. Each pane is the system's grouped cards (`.qf-grp`
// labels over `.qf-grpcard` cards of `.qf-srow` rows). General is the account, Usage as two progress rows, the
// rows into the other panes, Appearance's mode row, and for an admin the Company row; Company (the members as a
// FilesTable, the invite form, the admin and apps links) and Background work (the loops and their budgets) are
// panes nested under General, as a connector's is under Connectors (connectors.ts draws those three). Devices is
// this device's push Switch and Test, and the other devices; Messaging channels the delivery rows; Help & support
// Help, Report an issue (a Dialog whose submit opens the chat with the text) and Add to home screen. A pane holds no
// state the objects do not and decides nothing: every action is a request the agent script and its objects answer
// with a code, and the page says the answer in words. The panes' markup is settings-panes.ts.
import { type IconName, ic } from "./icons.ts";
import { COMPANY_PANE, DEVICES_PANE, GENERAL_PANE, HELP_PANE, LOOPS_PANE, MESSAGING_PANE, MODE_KEY, MODES, REPORT_DIALOG, SETTINGS_TEXT } from "./settings-panes.ts";

export { MODE_KEY, MODES, SETTINGS_TEXT };
import { CONNECT_DIALOG } from "./connectors.ts";

/** The panes in the nav's order, with their titles and the canvas's glyphs (`navDefs`). */
export const SETTINGS_PANES = ["general", "connectors", "permissions", "devices", "messaging", "help"] as const;
export const PANE_TITLE: Record<(typeof SETTINGS_PANES)[number], string> = { general: "General", connectors: "Connectors", permissions: "Permissions", devices: "Devices", messaging: "Messaging channels", help: "Help & support" };
/** The panes nested under a nav pane, with that pane: Back goes there, and its nav item stays current. */
export const NESTED_PANES = { connector: "connectors", company: "general", loops: "general" } as const;
export const NESTED_TITLE: Record<keyof typeof NESTED_PANES, string> = { connector: PANE_TITLE.connectors, company: SETTINGS_TEXT.companyRow, loops: SETTINGS_TEXT.loops };
const PANE_GLYPH: Record<(typeof SETTINGS_PANES)[number], IconName> = { general: "gear", connectors: "plug", permissions: "shield", devices: "monitor", messaging: "chat", help: "help" };
/** Shown when the browser will not subscribe (Brave without Google push messaging, or notifications blocked). */
export const PUSH_REFUSED_TEXT =
  "Your browser's push service is off or blocked, so this device cannot get notifications. In Brave, open Settings > Privacy and turn on \"Use Google services for push messaging\", then reload this page. In other browsers, allow notifications for this site. Until then your agent's updates still reach you by mail.";

/**
 * The Settings dialog (SettingsDialog): the nav column with its title and Log out at the foot, and the pane with
 * Go back (a phone's nav, or the nav pane a nested pane sits under), its title and Close. A pane's body is one of
 * settings-panes.ts' or connectors.ts' three, shown one at a time; the connect and report dialogs open over it.
 */
export function settingsMarkup(p: { connectors: string; connector: string; permissions: string }): string {
  const panes: Record<string, string> = { general: GENERAL_PANE, connectors: p.connectors, connector: p.connector, permissions: p.permissions, devices: DEVICES_PANE, messaging: MESSAGING_PANE, help: HELP_PANE, company: COMPANY_PANE, loops: LOOPS_PANE };
  const navBtn = (k: (typeof SETTINGS_PANES)[number]) => `<button id="set-nav-${k}">${ic(PANE_GLYPH[k], "xs")}${PANE_TITLE[k]}<span class="qf-only-phone set-chev">${ic("chev", "xs")}</span></button>`;
  return `<div id="set-dialog" class="qf-dlg qf-dlg--800" role="dialog" aria-label="${SETTINGS_TEXT.title}">
  <span class="qf-grab qf-only-phone"></span>
  <div id="set-frame" class="qf-set">
    <div class="qf-set-nav"><h2>${SETTINGS_TEXT.title}</h2>
      <nav id="set-nav" aria-label="${SETTINGS_TEXT.title}">${SETTINGS_PANES.map(navBtn).join("")}</nav>
      <div class="bot"><button id="logout" class="set-logout" type="button">${ic("logout", "xs")}${SETTINGS_TEXT.logout}</button><p id="logout-result" class="set-logout-note" role="status"></p></div>
    </div>
    <div class="qf-set-pane">
      <button id="set-back" class="qf-ibtn qf-ibtn--glass qf-ibtn--28 qf-set-back qf-only-phone" aria-label="${SETTINGS_TEXT.back}">${ic("back", "xs")}</button>
      <div id="set-top" class="qf-set-top"><h2 id="set-title">${PANE_TITLE.general}</h2></div>
      <button id="set-close" class="qf-ibtn qf-ibtn--glass qf-ibtn--28 qf-set-x" aria-label="${SETTINGS_TEXT.close}">${ic("x", "xs")}</button>
      <div class="qf-set-body">
${Object.entries(panes).map(([k, html]) => `<section id="set-pane-${k}"${k === "general" ? "" : " hidden"}>${html}</section>`).join("\n")}
      </div>
    </div>
  </div>
  ${CONNECT_DIALOG}
  ${REPORT_DIALOG}
</div>`;
}

/** The dialog's own rules: Log out as the nav's buttons are drawn, the phone's chevrons, what the cards do not say. */
export const SETTINGS_CSS = `
.qf-set-nav button[aria-current] { background: var(--fill-secondary-elevated); font-weight: 500; }
.set-chev { margin-left: auto; display: flex; color: var(--text-tertiary); }
.set-logout { display: flex; align-items: center; gap: 10px; height: 32px; padding: 6px 8px; border-radius: var(--radius-12); color: var(--text-primary); font: 400 14px/20px var(--font-sans); text-decoration: none; width: 100%; }
.set-logout-note { margin: 4px 8px 0; color: var(--text-secondary); font: 400 12px/16px var(--font-sans); }
.set-logout-note:empty { display: none; }
.qf-set-body > section, .qf-set-body > section > div:not(.qf-grp) { display: flex; flex-direction: column; gap: 16px; }
.qf-srow .set-ico { width: 28px; display: flex; justify-content: center; color: var(--text-secondary); }
.qf-srow .tx > .sub { display: block; }
.qf-srow .trail { display: flex; align-items: center; gap: 8px; margin-left: auto; color: var(--text-quaternary); }
.qf-srow .trail .val { color: var(--text-secondary); }
.perm-check { color: var(--fill-blue); }
.set-usage { align-items: flex-start; padding: 12px; }
.set-usage .qf-bar { margin-top: 10px; }
/* The value wraps in its own column, as the canvas's "51% used", so the row's words keep their width. */
.set-usage .trail { flex-shrink: 1; max-width: 45%; text-align: right; white-space: normal; }
.set-note { margin: 0; font: 400 14px/20px var(--font-sans); color: var(--text-secondary); }
.set-note:empty, #stopped-table:empty { display: none; }
.set-mode { width: 94px; background: var(--bg-primary); }
.set-mode .tab[aria-checked="true"] { background: var(--fill-secondary-elevated); color: var(--text-primary); box-shadow: var(--elevation-1); }
.set-field { width: 168px; text-align: right; }
.set-budget { width: 96px; text-align: right; }
.set-box { padding: 12px; gap: 8px; display: flex; flex-direction: column; }
.set-act { display: flex; justify-content: flex-end; }
#report .qf-ta { min-height: 230px; }
#report-go { width: 100%; }
/* The canvas's phone Settings (Main.dc.html's container rules): Back in the title row, the nav's divider above Log out. */
@container qf (max-width: 767px) {
  .qf-set-back { top: 0; left: 16px; }
  .qf-set-top { min-height: 28px; padding: 0 16px 12px 52px; }
  .qf-set-nav .bot { border-top: 1px solid var(--fill-divider); margin: 8px 16px 0; padding: 8px 0 0; }
  .set-field { width: 128px; }
  /* The canvas's phone Settings sheet stands at its full 85% whatever the pane holds. */
  .qf-scrim2--sheet > .qf-dlg--800 { height: 85% !important; }
}
:where(#app) button { background: transparent; border: 0; color: inherit; font: inherit; padding: 0; cursor: pointer; }
`;

export const SETTINGS_SCRIPT = `const SETTINGS = ${JSON.stringify(SETTINGS_TEXT)};
const SET_PANES = ${JSON.stringify(SETTINGS_PANES)}, SET_NESTED = ${JSON.stringify(NESTED_PANES)};
const SET_TITLE = Object.assign(${JSON.stringify(PANE_TITLE)}, ${JSON.stringify(NESTED_TITLE)});
const setPlural = (n, w) => n + " " + (n === 1 ? w[0] : w[1]);
const setGrouped = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
// A form post (the capture route reads a form, not JSON); the browser sends the page's own Origin with it.
const postForm = (path, form) => api(path, { method: "POST", body: form });
const setDollars = (micros) => micros === 0 ? SETTINGS.free : micros < 10000 ? SETTINGS.cheap : "$" + (micros / 1000000).toFixed(2);
// The dialog: which pane is shown, and on a phone whether the nav (the first page) or a pane is. A nested pane's
// Back goes to the pane it sits under; elsewhere Back is the phone's way back to the nav.
let setNow = "general";
const SET_LOAD = { general: () => settings(), connectors: () => connectors(), connector: () => connectorPage(), permissions: () => permissions(), devices: () => settingsDevices(), messaging: () => delivery(), company: () => company(), loops: () => loops() };
function setPane(k) {
  setNow = k;
  const nested = k in SET_NESTED, top = nested ? SET_NESTED[k] : k;
  for (const p of SET_PANES) { const b = $("set-nav-" + p); if (p === top) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
  for (const p of SET_PANES.concat(Object.keys(SET_NESTED))) $("set-pane-" + p).hidden = p !== k;
  $("set-title").textContent = SET_TITLE[k];
  $("set-top").className = "qf-set-top" + (nested ? " has-back" : "");
  $("set-back").className = "qf-ibtn qf-ibtn--glass qf-ibtn--28 qf-set-back" + (nested ? "" : " qf-only-phone");
  $("set-frame").className = "qf-set is-pane";
  if (SET_LOAD[k]) SET_LOAD[k]();
}
// Settings' addresses (F5, the grammar's settings row): \`/settings\` is the nav on a phone and General wider, a pane is
// \`/settings/<pane>\`, a pane nested under one is under its address (\`/settings/general/company\`), and a connector's is
// \`/settings/connectors/<id>\`. The router draws them (\`setDraw\`); a pane the person picks is a \`go\` to its address.
function setAt(path) {
  const seg = path.split("/").slice(2);
  if (seg[0] === "connectors" && seg[1]) return { pane: "connector", id: decodeURIComponent(seg[1]) };
  return { pane: seg[seg.length - 1] || "", id: null };
}
function setPath(k, id) {
  if (k === "connector") return "/settings/connectors/" + encodeURIComponent(id);
  return SET_NESTED[k] ? "/settings/" + SET_NESTED[k] + "/" + k : "/settings/" + k;
}
// The entries Settings opens with, so each pane's Back is \`history.back()\`: every address above the one asked for.
// Wider than a phone \`/settings\` already draws General, so \`/settings/general\` is one step with it, never two.
function setChain(path) {
  const seg = path.split("/").slice(2), all = ["/settings"];
  for (let i = 1; i <= seg.length; i++) all.push("/settings/" + seg.slice(0, i).join("/"));
  if (device() === "phone") return all;
  return all.filter((a, i) => !(a === "/settings/general" && i < all.length - 1) && !(a === "/settings" && all[i + 1] === "/settings/general" && i + 1 === all.length - 1));
}
// Draws the address: opens the dialog (its entries are the addresses the router pushed) and the pane it names; a
// phone at \`/settings\` shows the nav, a wider screen General.
function setDraw(path) {
  if (!isOpen($("set-dialog"))) openDialog($("set-dialog"), { form: "sheet", mark: "settings", onClose: retitle });
  const a = setAt(path);
  if (a.pane === "connector") connectorId = a.id;
  if (a.pane || device() !== "phone") setPane(a.pane || "general");
  else $("set-frame").className = "qf-set";
}
// A pane the person picks: its address, unless it is the one on screen.
function setGo(k, id) { if (k !== setNow || id !== undefined || $("set-frame").className !== "qf-set is-pane") go(setPath(k, id)); }
for (const k of SET_PANES) $("set-nav-" + k).onclick = () => setGo(k);
$("set-back").onclick = () => history.back();
$("set-close").onclick = () => closeDialog($("set-dialog"));
// Log out: the host's own /logout (a same-origin POST, so the browser sends this page's Origin) ends the session and
// clears its cookie; then the page goes to sign-in. A logout that did not go through says so and stays.
$("logout").onclick = async () => {
  let r = null;
  try { r = await fetch("/logout", { method: "POST" }); } catch (e) {}
  if (r && r.ok) { location.assign("/login"); return; }
  const b = r ? await r.json().catch(() => ({})) : {};
  coded($("logout-result"), SETTINGS.logoutFailed, b.code || (r ? "HTTP_" + r.status : "OFFLINE"));
};
// Appearance: the mode this browser keeps (Light, Dark or System), applied to the body's data-theme by the shell's
// theme(). A browser that will not store it keeps the pick for this page and says nothing is wrong: it is a view choice.
const MODES = ${JSON.stringify(MODES)};
let modePick = null;
function modeNow() {
  if (modePick) return modePick;
  try { const m = localStorage.getItem(${JSON.stringify(MODE_KEY)}); return MODES.includes(m) ? m : "system"; } catch (e) { return "system"; }
}
function modeTheme(dark) { const m = modeNow(); return m === "system" ? (dark ? "dark" : "light") : m; }
function modeDraw() { const m = modeNow(); for (const k of MODES) $("mode-" + k).setAttribute("aria-checked", String(k === m)); }
for (const k of MODES) $("mode-" + k).onclick = () => { modePick = k; try { localStorage.setItem(${JSON.stringify(MODE_KEY)}, k); } catch (e) {} modeDraw(); theme(); };
// A run's phase as the person reads it (the panel's job runs use it); its code stays on the outcome cell.
const RUN_PHASE = { executing: "running", awaiting_approval: "waiting for you", retry_wait: "will try again", done: "done" };
async function settings() {
  // Each part reads on its own, so one that could not be read does not blank the others.
  modeDraw(); usage(); loopsRow(); devicesRow(); connectorsRow();
  const res = await api("/me");
  const me = await res.json();
  if (!res.ok) { couldNot($("me"), "your settings", me); return; }
  $("me").textContent = SETTINGS.signedIn.replace("{person}", me.person).replace("{role}", me.role).replace("{tenant}", me.tenant);
  // The Company group (members, invites) is a company's: a standalone deploy has one owner and no members (spec section 4).
  const admin = me.shape === "company" && (me.role === "admin" || me.role === "owner");
  $("admin").hidden = !admin;
  if (admin) members();
}
// The usage card: this month's tokens and cost, and today's use against the loops' daily budgets, from the person's
// own rollup (the same Ledger the dashboard reads) and their own loop settings. A month's bar is its tokens against
// the daily cap for each day so far; with no cap there is no bar, and the rows say the tokens.
function meter(id, used, cap) {
  const m = $(id + "-meter");
  if (!cap) { m.hidden = true; return; }
  const pct = Math.min(100, Math.round((used / cap) * 100));
  m.hidden = false; m.setAttribute("aria-valuenow", String(pct)); $(id + "-fill").setAttribute("style", "width:" + pct + "%");
}
async function usage() {
  $("usage-month").textContent = SETTINGS.reading; $("usage-day").textContent = SETTINGS.reading;
  const days = Math.max(1, new Date().getDate());
  try {
    const [m, d, l] = await Promise.all([getJson("/app/usage.json?days=" + days), getJson("/app/usage.json?days=1"), getJson("/app/loops")]);
    $("usage-month").textContent = setDollars(m.totals.costMicros) + " · " + setPlural(m.runs.total, SETTINGS.run);
    const cap = l.loops.filter((x) => x.enabled).reduce((n, x) => n + x.budget, 0);
    const used = d.totals.tokens;
    meter("month", m.totals.tokens, cap * days); meter("cap", used, cap);
    $("usage-day").textContent = cap ? setGrouped(used) + " of " + setGrouped(cap) + " tokens today" : setPlural(used, SETTINGS.token) + " today";
  } catch (e) { couldNot($("usage-month"), "your usage", e); $("usage-day").textContent = ""; $("month-meter").hidden = true; $("cap-meter").hidden = true; }
}
async function connectorsRow() {
  try {
    const c = await getJson("/app/connectors");
    $("set-connectors-count").textContent = String(c.builtin.length + (Array.isArray(c.yours) ? c.yours.length : 0) + (Array.isArray(c.company) ? c.company.length : 0));
  } catch (e) { couldNot($("set-connectors-count"), "your connectors", e); }
}
// This device's push subscription, if the browser holds one; null when it has none or cannot say.
async function thisEndpoint() {
  try { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); return s ? s.endpoint : null; } catch (e) { return null; }
}
// What the Devices pane and the General rows say about push and delivery: one read, shared.
let pushNow = { known: false, on: false, others: [], total: 0 };
async function readDevices() {
  const d = await getJson("/delivery");
  const mine = await thisEndpoint();
  const on = !!mine && d.subscriptions.some((s) => s.endpoint === mine);
  pushNow = { known: true, on, mine, others: d.subscriptions.filter((s) => s.endpoint !== mine), total: d.subscriptions.length, mail: d.mail };
  return d;
}
// A device row (ListRow, two lines): the title over its line.
function setRow2(title, sub) { const r = el("div"); r.className = "qf-srow is-static"; const t = el("span", title); t.className = "tx"; const s = el("span", sub); s.className = "sub"; t.append(s); r.append(t); return r; }
async function settingsDevices() {
  $("device-state").textContent = SETTINGS.reading;
  try {
    await readDevices();
    $("device-state").textContent = pushNow.on ? SETTINGS.pushOn : SETTINGS.pushOff;
    $("push-on").checked = pushNow.on; $("push-on").setAttribute("aria-checked", String(pushNow.on));
    const list = $("device-others"); list.replaceChildren(); list.append(setRow2(SETTINGS.workspace, SETTINGS.workspaceSub));
    for (const s of pushNow.others) list.append(setRow2(SETTINGS.pushHosts[s.host] || SETTINGS.otherDevice, SETTINGS.since.replace("{date}", new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }))));
    if (!pushNow.others.length) list.append(setRow2(SETTINGS.noOthers, ""));
  } catch (e) { couldNot($("device-state"), "your devices", e); }
}
async function devicesRow() {
  try {
    await readDevices();
    $("set-devices-count").textContent = String(pushNow.total);
    $("set-messaging-state").textContent = pushNow.mail ? SETTINGS.mailOn : SETTINGS.mailOff;
  } catch (e) { couldNot($("set-messaging-state"), "your devices", e); }
}
$("set-connectors").onclick = () => setGo("connectors");
$("set-permissions").onclick = () => setGo("permissions");
$("set-devices").onclick = () => setGo("devices");
$("set-messaging").onclick = () => setGo("messaging");
$("set-company").onclick = () => setGo("company");
$("set-loops").onclick = () => setGo("loops");
$("set-home").onclick = () => { $("set-note").textContent = SETTINGS.homeHow; };
$("set-help").onclick = () => { $("set-note").textContent = SETTINGS.helpHow; };
// Report an issue: the dialog over Settings; its submit is a line to the agent, which holds the person's context.
// Nothing leaves the page until the person sends it from the chat.
$("set-report").onclick = () => { $("report-text").value = ""; openDialog($("report"), { form: "center" }); };
$("report-close").onclick = () => closeDialog($("report"));
$("report-form").onsubmit = (e) => { e.preventDefault(); const text = $("report-text").value.trim(); toView("chat"); $("t").value = SETTINGS.reportLine + text; };
async function delivery() {
  try {
    const d = await getJson("/delivery");
    $("delivery-zone").value = d.zone; $("delivery-mail").checked = d.mail;
    $("delivery-now").textContent = d.subscriptions.length + " device(s) get notifications; times are in " + d.zone + ".";
    const list = $("stopped-table"); list.replaceChildren();
    for (const c of d.stopped) {
      const row = el("div"); row.className = "qf-srow is-static"; row.dataset.stopped = c;
      const t = el("span", c.startsWith("job:") ? "Job " + c.slice(4) : c); t.className = "tx";
      const b = el("button", SETTINGS.allowAgain); b.className = "qf-tlink"; b.onclick = () => prefs({ allow: c });
      row.append(t, b); list.append(row);
    }
    $("stopped-note").textContent = d.stopped.length ? "" : SETTINGS.nothingStopped;
  } catch (e) { couldNot($("delivery-now"), "your delivery settings", e); }
}
async function prefs(body) {
  const r = await post("/delivery/preferences", body);
  if (r.ok) coded($("delivery-result"), "Saved.", ""); else await failedTo($("delivery-result"), "Not saved", r);
  delivery();
}
$("delivery-form").onsubmit = (e) => { e.preventDefault(); prefs({ zone: $("delivery-zone").value, mail: $("delivery-mail").checked }); };
// Background work: one row per loop, its daily budget and its Switch; the General row says how many are on.
async function loopsRow() {
  try { const l = await getJson("/app/loops"); $("loops-count").textContent = setPlural(l.loops.filter((x) => x.enabled).length, SETTINGS.loopsOn); }
  catch (e) { couldNot($("loops-count"), "your background work", e); }
}
async function loops() {
  const list = $("loop-table");
  try {
    const l = await getJson("/app/loops");
    list.replaceChildren();
    for (const x of l.loops) {
      const row = el("div"); row.className = "qf-srow is-static"; row.dataset.loop = x.loop;
      const t = el("span", x.loop.slice(0, 1).toUpperCase() + x.loop.slice(1)); t.className = "tx"; const s = el("span", setGrouped(x.budget) + " " + SETTINGS.tokensADay); s.className = "sub"; t.append(s);
      const budget = el("input"); budget.type = "number"; budget.min = "0"; budget.value = x.budget; budget.className = "qf-select set-budget"; budget.setAttribute("aria-label", x.loop + " " + SETTINGS.tokensADay);
      budget.onchange = () => setLoop({ loop: x.loop, budget: Number(budget.value) });
      const on = el("input"); on.type = "checkbox"; on.className = "qf-switch"; on.setAttribute("role", "switch"); on.setAttribute("aria-label", x.loop); on.checked = x.enabled;
      on.onchange = () => setLoop({ loop: x.loop, enabled: on.checked });
      row.append(t, budget, on); list.append(row);
    }
  } catch (e) { list.replaceChildren(); couldNot($("loop-result"), "your background work", e); }
}
async function setLoop(body) {
  const r = await post("/app/loops", body);
  if (r.ok) coded($("loop-result"), "Saved.", ""); else await failedTo($("loop-result"), "Not saved", r);
  loops(); loopsRow();
}
// Company, for an admin: the members (FilesTable), the invite form, and how many were invited.
async function members() {
  const list = await api("/admin/members");
  const body = await list.json().catch(() => ({ code: "BAD_ANSWER" }));
  const rowsOf = $("members"); rowsOf.replaceChildren();
  if (!list.ok) { couldNot($("invite-result"), "the members", body); return; }
  for (const m of body.members) {
    const row = el("div"); row.className = "qf-file"; row.dataset.member = m.email;
    const nm = el("span"); nm.className = "nm"; const tile = el("span", m.email.slice(0, 1).toUpperCase()); tile.className = "tile"; nm.append(tile, el("span", m.email));
    const from = el("span", SETTINGS.source[m.source] || m.source); from.className = "m"; const role = el("span", m.role); role.className = "m";
    row.append(nm, from, role, el("span")); rowsOf.append(row);
  }
  // No sign-in signal is held, so "open" invites cannot be told from accepted ones: the row says how many were invited.
  $("members-count").textContent = String(body.members.length);
  $("invites-count").textContent = String(body.members.filter((m) => m.source === "invite").length) + " " + SETTINGS.invited;
}
function company() { coded($("invite-result"), "", ""); members(); }
$("invite").onsubmit = async (e) => {
  e.preventDefault();
  const res = await post("/admin/invites", { email: $("invite-email").value, role: $("invite-role").value });
  const body = await res.json().catch(() => ({ code: "BAD_ANSWER" }));
  if (res.ok) $("invite-result").textContent = "Invited " + body.member.email + "; they can sign in once access is synced."; else coded($("invite-result"), "Not invited: that did not go through. Check the address and try again.", body.code);
  if (res.ok) members();
};
// The browser's push service refused the subscription: said in plain words, with the way out.
const PUSH_REFUSED = ${JSON.stringify(PUSH_REFUSED_TEXT)};
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
// The Switch: on turns this device's subscription off, off subscribes it. It never touches another device's, and it
// shows what the store holds after, not what was tapped.
$("push-on").onchange = async () => {
  if (pushNow.on && pushNow.mine) {
    const r = await post("/push/unsubscribe", { endpoint: pushNow.mine });
    try { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch (e) {}
    if (r.ok) coded($("push-result"), "Notifications are off for this device.", ""); else await failedTo($("push-result"), "Not turned off", r);
    settingsDevices(); devicesRow();
    return;
  }
  try {
    const key = await api("/push/key").then((r) => r.json());
    if (!key.key) throw Object.assign(new Error("no key"), { code: key.code });
    const reg = await navigator.serviceWorker.ready;
    let sub;
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key.key) }); }
    catch (e) { coded($("push-result"), PUSH_REFUSED, "PUSH_REFUSED"); settingsDevices(); return; }
    const r = await post("/push/subscribe", { subscription: sub.toJSON() });
    if (r.ok) coded($("push-result"), "Notifications are on for this device.", ""); else await failedTo($("push-result"), "Not turned on", r);
  } catch (e) { coded($("push-result"), "Not turned on: that did not go through. Reload the page and try again.", e && e.code); }
  settingsDevices(); devicesRow();
};
$("push-test").onclick = async () => {
  const r = await post("/push/test", {});
  const b = await r.json().catch(() => ({ code: "BAD_ANSWER" }));
  if (r.ok) coded($("push-result"), "Sent. It should appear on your devices in a moment.", ""); else coded($("push-result"), "Not sent: the test notification did not go out. Turn notifications on here first, then try again.", b.code);
};`;
