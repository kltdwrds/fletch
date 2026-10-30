// The Connectors, connector and Permissions panes of the Settings dialog (M23.5's pages, redrawn in M27.6 on the
// Fletch system's grouped cards: `.qf-grp` labels over `.qf-grpcard` cards of `.qf-srow` rows). Connectors is the
// search field and the SegmentedControl, Available (what the capture dialog can take, Connect as the row's
// TextLink) and Connected · n (the built-ins, the person's own credentials by host and the company's connectors,
// View as the TextLink). A connector's pane is its hero, Revoke as the destructive row where a grant backs one of
// its rows, and its groups with the words in force in the trailing slot. Permissions is the gates' defaults as
// option rows with the check on the rule in force, the connectors list opening each connector's pane, and the
// person's standing grants with Revoke. Every read is a route that answers for the session's person alone, and the
// page draws what it says in words: never a credential, a reference or a code. Nothing here sets a mode. From F36 (P9
// deltas 5 to 7) a "Yours" row draws its status word as a pill and its last use, a connection's page its audit rows
// and Disconnect with what it leaves, and Permissions every grant once under Grants, its count the rows'.
import { CONNECTION_TEXT } from "./connection-words.ts";
import { CONNECTORS_TEXT, PERMISSIONS_TEXT } from "./permission-words.ts";
import { ic } from "./icons.ts";

/** The panes' own placing: what the bundle's grouped cards do not say (the hero, the notes, the dialog's fields). */
export const CONNECTORS_CSS = `
.conn-note { margin: 0; font: 400 14px/20px var(--font-sans); color: var(--text-secondary); }
.conn-note:empty, .conn-hide:empty { display: none; }
.conn-hero { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.conn-hero .logo { width: 40px; height: 40px; border-radius: 12px; }
.conn-hero h3 { margin: 0; font: 600 20px/25px var(--font-sans); }
.conn-hero p { margin: 0; font: 400 14px/20px var(--font-sans); color: var(--text-secondary); }
.qf-srow .val.is-warn { color: var(--text-warning); }
#conn-connect .qf-dlg-body { padding: 0 40px 8px; gap: 20px; }
.conn-connect-head { display: flex; flex-direction: column; gap: 6px; }
.conn-connect-head .logo { width: 40px; height: 40px; border-radius: 12px; background: #fff; color: #111; display: flex; align-items: center; justify-content: center; font-weight: 700; }
.conn-connect-head b { font: 600 20px/25px var(--font-sans); }
.conn-connect-foot { padding: 8px 24px 24px; display: flex; flex-direction: column; gap: 8px; }
.conn-connect-foot .qf-btn { width: 100%; }
`;

/** The Connectors pane: the search, Available and Connected · n, and the groups the script draws. */
export const CONNECTORS_PANE = `<div id="connectors">
  <label id="conn-search-field" class="qf-search">${ic("search", "sm")}<input id="conn-search" type="text" enterkeyhint="search" placeholder="${CONNECTORS_TEXT.search}" aria-label="${CONNECTORS_TEXT.search}"></label>
  <div id="conn-seg" class="qf-seg" role="group" aria-label="${CONNECTORS_TEXT.title}">
    <button id="conn-available" aria-pressed="true">${CONNECTORS_TEXT.available}</button>
    <button id="conn-connected" aria-pressed="false">${CONNECTORS_TEXT.connected}<span id="conn-count"></span></button>
  </div>
  <p id="conn-note" class="conn-note"></p>
  <div id="conn-list"></div>
</div>`;

/** A connector's pane: its hero, Revoke where a grant backs a row, and its permission groups. */
export const CONNECTOR_PANE = `<div id="connector">
  <div id="connector-head" class="conn-hero"><span id="connector-mono" class="logo"></span><h3 id="connector-name"></h3><p id="connector-blurb"></p></div>
  <p id="connector-note" class="conn-note"></p>
  <div id="connector-revoke" class="qf-grpcard conn-hide"></div>
  <div id="connector-groups"></div>
  <div id="connector-disconnect"></div>
</div>`;

/** The Permissions pane: the connectors list first, as the canvas has it, then the defaults and what others can ask. */
export const PERMISSIONS_PANE = `<div id="permissions">
  <p class="qf-set-intro">${PERMISSIONS_TEXT.intro}</p>
  <div class="qf-grp"><h3>${PERMISSIONS_TEXT.connectors}</h3>
    <div class="qf-grpcard"><div id="perm-connectors"></div>
      <button id="perm-to-connectors" class="qf-srow"><span class="tx">${PERMISSIONS_TEXT.allConnectors}</span><span class="trail"><span id="perm-connectors-count" class="val"></span>${ic("chev", "xs")}</span></button>
    </div></div>
  <div id="perm-defaults"></div>
  <p class="conn-note">${PERMISSIONS_TEXT.defaultsNote}</p>
  <div class="qf-grp"><h3>${CONNECTION_TEXT.grants}<span id="perm-grants-count" class="qf-chip qf-chip--count"></span></h3><div id="perm-grants" class="qf-grpcard"></div></div>
  <p id="perm-note" class="conn-note"></p>
</div>`;

/** The connect dialog (Dialog 512, over Settings): the kind's tile and title, the capture fields, Connect. */
export const CONNECT_DIALOG = `<div id="conn-connect" class="qf-dlg qf-dlg--512" role="dialog" aria-labelledby="conn-connect-title" hidden>
  <div class="qf-dlg-head" style="justify-content:flex-end;padding-left:16px"><button id="conn-connect-close" class="qf-ibtn qf-ibtn--glass qf-ibtn--28" aria-label="${CONNECTORS_TEXT.close}">${ic("x", "xs")}</button></div>
  <form id="conn-connect-form" autocomplete="off">
    <div class="qf-dlg-body">
      <div class="conn-connect-head"><span id="conn-connect-mono" class="logo"></span><b id="conn-connect-title"></b><span id="conn-connect-sub" class="conn-note"></span></div>
      <input id="conn-connect-kind" name="kind" type="hidden" value="secret">
      <div class="qf-cardin">
        <input id="conn-connect-ref" name="ref" class="qf-input" required value="cred://" aria-label="${CONNECTORS_TEXT.fieldName}" placeholder="${CONNECTORS_TEXT.fieldName}">
        <input id="conn-connect-host" name="host" class="qf-input" required aria-label="${CONNECTORS_TEXT.fieldHost}" placeholder="${CONNECTORS_TEXT.fieldHost}">
        <input id="conn-connect-value" name="value" class="qf-input" type="password" required autocomplete="off" spellcheck="false" aria-label="${CONNECTORS_TEXT.fieldValue}" placeholder="${CONNECTORS_TEXT.fieldValue}">
      </div>
      <p class="conn-note">${CONNECTORS_TEXT.neverShown}</p>
      <p id="conn-connect-result" class="conn-note" role="status"></p>
    </div>
    <div class="conn-connect-foot"><button id="conn-connect-go" class="qf-btn qf-btn--primary">${CONNECTORS_TEXT.connect}</button></div>
  </form>
</div>`;

export const CONNECTORS_SCRIPT = `const CONN = ${JSON.stringify(CONNECTORS_TEXT)}, PERM = ${JSON.stringify(PERMISSIONS_TEXT)}, LINKS = ${JSON.stringify(CONNECTION_TEXT)};
// The built-ins the canvas draws with a glyph rather than a letter.
const CONN_GLYPH = { browser: "globe" };
let connTab = "available", connData = null, connectorId = null;
const connWhen = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const connAt = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
// A status pill (the bundle's StatusPill): its tone and its word.
function connPill(tone, word) { const p = el("span"); p.className = "qf-status qf-status--" + (tone || "done"); p.append(el("i"), word); return p; }
// A group (SettingsDialog): its label over a card of rows.
function setGroup(label, card) { const g = el("div"); g.className = "qf-grp"; const h = el("h3", label); card.className = "qf-grpcard"; g.append(h, card); return g; }
// A connector's logo tile: its glyph, else its own one or two letters, else the name's first.
function connLogo(item) {
  const tile = el("span"); tile.className = "logo";
  const glyph = CONN_GLYPH[item.id];
  if (glyph) tile.append(icon(glyph, "xs")); else tile.textContent = (item.mono || item.name || "?").slice(0, item.mono ? 2 : 1).toUpperCase();
  return tile;
}
function connText(title, sub) { const t = el("span", title); t.className = "tx"; if (sub) { const s = el("span", sub); s.className = "sub"; t.append(s); } return t; }
// A connector row (ListRow in a group card): the logo, the name over its line, the TextLink action.
// A "Yours" row adds its last use to the line and its status word as a pill (F36).
function connRow(item, label, run) {
  const row = el("div"); row.className = "qf-srow is-static"; row.dataset.id = item.id || "";
  const b = el("button", label); b.className = "qf-tlink"; b.setAttribute("aria-label", label + " " + item.name); b.onclick = run;
  const used = item.statusWord ? " · " + (item.lastUse ? LINKS.lastUsed + " " + connAt(Date.parse(item.lastUse)) + (item.outcome && item.outcome !== "sent" ? ", " + item.outcome : "") : LINKS.notUsed) : "";
  row.append(connLogo(item), connText(item.name, (item.sub || "") + used));
  if (item.statusWord) { const trail = el("span"); trail.className = "trail"; trail.append(connPill(item.tone, item.statusWord), b); row.append(trail); } else row.append(b);
  return row;
}
function connDraw() {
  const list = $("conn-list"); list.replaceChildren(); coded($("conn-note"), "", "");
  for (const [id, on] of [["conn-available", connTab === "available"], ["conn-connected", connTab === "connected"]]) $(id).setAttribute("aria-pressed", String(on));
  if (!connData) return;
  const q = $("conn-search").value.trim().toLowerCase();
  const hit = (i) => !q || i.name.toLowerCase().includes(q);
  // Connected · n: how many are connected, from the owning store's answer; a part that could not be read leaves it unsaid, never short.
  let total = 0, known = true;
  for (const key of ["builtin", "yours", "company"]) { if (Array.isArray(connData[key])) total += connData[key].length; else known = false; }
  $("conn-count").textContent = known ? " · " + total : "";
  if (connTab === "available") {
    const items = connData.available.filter(hit);
    if (items.length) { const card = el("div"); for (const a of items) card.append(connRow(a, CONN.connect, () => openConnect(a))); list.append(setGroup(CONN.available, card)); }
    else $("conn-note").textContent = q ? CONN.noMatch : CONN.emptyAvailable;
    return;
  }
  let shown = 0;
  for (const [key, label] of [["builtin", CONN.builtIn], ["yours", CONN.yours], ["company", CONN.company]]) {
    const part = connData[key];
    if (!Array.isArray(part)) { coded($("conn-note"), CONN.notRead, part && part.code); continue; }
    const items = part.filter(hit);
    if (!items.length) continue;
    const card = el("div");
    for (const item of items) card.append(connRow(item, CONN.view, () => showConnector(item.id)));
    list.append(setGroup(label, card)); shown += items.length;
  }
  if (!shown && !$("conn-note").textContent) $("conn-note").textContent = q ? CONN.noMatch : CONN.emptyConnected;
}
async function connectors() {
  coded($("conn-note"), CONN.reading, ""); $("conn-count").textContent = "";
  try { connData = await getJson("/app/connectors"); } catch (e) { connData = null; $("conn-list").replaceChildren(); couldNot($("conn-note"), "your connectors", e); return; }
  connDraw();
}
// Connect opens the capture dialog for the kind; the value goes from the form to the person's vault and never back.
function openConnect(a) {
  const f = $("conn-connect-form");
  $("conn-connect-kind").value = a.id; $("conn-connect-mono").textContent = a.mono || a.name.slice(0, 1);
  $("conn-connect-title").textContent = CONN.connect + " " + a.name.toLowerCase(); $("conn-connect-sub").textContent = a.sub;
  $("conn-connect-ref").value = "cred://"; $("conn-connect-host").value = ""; $("conn-connect-value").value = "";
  coded($("conn-connect-result"), "", "");
  openDialog($("conn-connect"), { form: "center" });
  return f;
}
$("conn-connect-close").onclick = () => closeDialog($("conn-connect"));
// The capture route answers with its page: 201 is saved; anything else carries its code in the page's alert.
$("conn-connect-form").onsubmit = async (e) => {
  e.preventDefault();
  const kind = $("conn-connect-kind").value === "login" ? "login" : "secret";
  const form = new URLSearchParams({ kind, ref: $("conn-connect-ref").value.trim(), host: $("conn-connect-host").value.trim(), value: $("conn-connect-value").value, permission: "standing" });
  if (kind === "login") form.set("fills", "on");
  $("conn-connect-value").value = "";
  let r = null, page = "";
  try { r = await postForm("/vault/capture", form); page = await r.text(); } catch (err) { r = null; }
  if (r && r.status === 201) { closeDialog($("conn-connect")); connTab = "connected"; await connectors(); $("conn-note").textContent = CONN.saved; return; }
  const code = r ? ((/<strong>([A-Z0-9_]+)<\\/strong>/.exec(page) || [])[1] || "HTTP_" + r.status) : "NETWORK";
  coded($("conn-connect-result"), CONN.notSaved, code);
};
function showConnector(id) { setGo("connector", id); }
async function connectorPage() {
  $("connector-groups").replaceChildren(); $("connector-revoke").replaceChildren(); $("connector-disconnect").replaceChildren(); $("connector-mono").replaceChildren(); $("connector-name").textContent = ""; $("connector-blurb").textContent = "";
  coded($("connector-note"), CONN.reading, "");
  try {
    const c = await getJson("/app/connectors/" + encodeURIComponent(connectorId));
    const glyph = CONN_GLYPH[c.connector.id];
    if (glyph) $("connector-mono").append(icon(glyph, "sm")); else $("connector-mono").textContent = c.connector.name.slice(0, 1).toUpperCase();
    $("connector-name").textContent = c.connector.name; $("connector-blurb").textContent = c.connector.blurb; $("connector-note").textContent = "";
    $("set-title").textContent = c.connector.name;
    for (const g of c.groups) {
      const card = el("div");
      // A permission row: the label, then what is in force in words in the trailing slot, warn where the agent will
      // stop and wait on the person. A grant behind a row is revoked from the destructive row above the groups.
      for (const r of g.rows) {
        const row = el("div"); row.className = "qf-srow is-static"; row.dataset.row = r.id;
        const trail = el("span"); trail.className = "trail";
        if (r.tone) trail.append(connPill(r.tone, r.words)); else { const w = el("span", r.words); w.className = "val" + (r.asks ? " is-warn" : ""); trail.append(w); }
        const sub = [r.sub, r.at ? connAt(r.at) : ""].filter(Boolean).join(" · ");
        row.append(connText(r.label, sub), trail); card.append(row);
        if (r.grantId) { const b = el("button", CONN.revoke + ": " + r.label); b.className = "qf-srow is-danger"; b.dataset.grant = r.grantId; b.onclick = () => revokeGrantRow(r.grantId, $("connector-note"), CONN, connectorPage); $("connector-revoke").append(b); }
      }
      $("connector-groups").append(setGroup(g.label, card));
    }
    if (c.disconnect) $("connector-disconnect").append(disconnectGroup(c.connector.name, c.disconnect));
  } catch (e) { couldNot($("connector-note"), "this connector", e); }
}
// Disconnect (F36, P9 delta 6): what it does and what stays, then the press revokes every credential of the person's
// bound to this host through the Vault's own route, which also ends the grants that name it; the row leaves the
// Connected list only when the Vault said it did.
function disconnectGroup(host, d) {
  const card = el("div"); const row = el("div"); row.className = "qf-srow is-static";
  const b = el("button", d.label); b.className = "qf-btn qf-btn--destructive"; b.id = "connector-disconnect-go";
  const trail = el("span"); trail.className = "trail"; trail.append(b);
  row.append(connText(d.words, d.stays), trail); card.append(row);
  b.onclick = async () => {
    b.disabled = true;
    try {
      const v = await getJson("/vault");
      const refs = v.credentials.filter((x) => !x.company && x.status !== "revoked" && x.hosts.some((h) => h.host === host)).map((x) => x.ref);
      for (const ref of refs) { const r = await post("/vault/revoke", { ref }); if (!r.ok) { b.disabled = false; await failedTo($("connector-note"), LINKS.notDisconnected, r); return; } }
      connTab = "connected"; setGo("connectors"); await connectors(); $("conn-note").textContent = LINKS.disconnected;
    } catch (e) { b.disabled = false; couldNot($("connector-note"), "this connection", e); }
  };
  return setGroup(d.label, card);
}
// Revoke goes through the engine's own route, which the person's object decides; the row leaves only when it did.
async function revokeGrantRow(id, note, words, reload) {
  const r = await post("/api/grants/" + id + "/revoke", {});
  if (!r.ok) { await failedTo(note, words.revoke, r); return; }
  await reload();
  note.textContent = words.revoked;
}
async function permissions() {
  coded($("perm-note"), CONN.reading, "");
  let p;
  try { p = await getJson("/app/permissions"); } catch (e) { $("perm-grants").replaceChildren(); $("perm-defaults").replaceChildren(); couldNot($("perm-note"), "your permissions", e); return; }
  $("perm-note").textContent = "";
  $("perm-connectors-count").textContent = String(p.connectors);
  const defaults = $("perm-defaults"); defaults.replaceChildren();
  // The defaults as option rows: the check on the rule in force; the other is shown, not offered yet.
  for (const d of p.defaults) {
    const card = el("div"); card.setAttribute("role", "radiogroup"); card.setAttribute("aria-label", d.label);
    for (const o of d.options) {
      const on = o.id === d.on;
      const b = el("button"); b.className = "qf-srow"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(on)); b.dataset.option = o.id; b.disabled = true;
      b.append(connText(o.t, on ? o.s : o.s + " · " + PERM.coming));
      if (on) { const t = el("span"); t.className = "trail perm-check"; t.append(icon("check", "sm")); b.append(t); }
      card.append(b);
    }
    defaults.append(setGroup(d.label, card));
  }
  permConnectors();
  const list = $("perm-grants"); list.replaceChildren(); $("perm-grants-count").textContent = "";
  if (!p.grants.ok) { coded($("perm-note"), PERM.notRead, p.grants.code); return; }
  // Every grant once (F36, P9 delta 7): the count is the rows drawn; a credential grant and an authority grant alike
  // say what they cover, one use or until you revoke it, when made and when they end; Revoke where it is still live.
  $("perm-grants-count").textContent = String(p.grants.rows.length);
  if (!p.grants.rows.length) { const none = el("div"); none.className = "qf-srow is-static"; none.append(connText(LINKS.grantsEmpty)); list.append(none); }
  for (const g of p.grants.rows) {
    const row = el("div"); row.className = "qf-srow is-static"; row.dataset.grant = g.id; row.dataset.kind = g.kind;
    const sub = [g.kind === "credential" ? LINKS.credential : LINKS.action, g.lifetime, LINKS.made + " " + connWhen(Date.parse(g.made)), g.ends && !g.spent ? LINKS.ends + " " + connAt(g.ends) : ""].filter(Boolean).join(" · ");
    row.append(connText(g.covers, sub));
    if (g.spent) { const t = el("span"); t.className = "trail"; t.append(connPill("wait", LINKS.status.spent)); row.append(t); }
    else {
      const b = el("button", PERM.revoke); b.className = "qf-tlink"; b.setAttribute("style", "color:var(--text-destructive)"); b.setAttribute("aria-label", PERM.revoke + ": " + g.covers);
      b.onclick = () => (g.kind === "credential" ? revokeCredentialGrant(g.id) : revokeGrantRow(g.id, $("perm-note"), PERM, permissions));
      row.append(b);
    }
    list.append(row);
  }
}
// A credential grant is the Vault's: its own route ends it, and the row leaves only when it did.
async function revokeCredentialGrant(nonce) {
  const r = await post("/vault/grants/revoke", { nonce });
  if (!r.ok) { await failedTo($("perm-note"), PERM.revoke, r); return; }
  await permissions();
  $("perm-note").textContent = PERM.revoked;
}
// The connectors list on Permissions: each opens its connector's pane, where its permissions are.
async function permConnectors() {
  const list = $("perm-connectors"); list.replaceChildren();
  let c;
  try { c = await getJson("/app/connectors"); } catch (e) { couldNot($("perm-note"), "your connectors", e); return; }
  for (const key of ["builtin", "yours", "company"]) {
    if (!Array.isArray(c[key])) { coded($("perm-note"), CONN.notRead, c[key] && c[key].code); continue; }
    for (const item of c[key]) {
      const b = el("button"); b.className = "qf-srow"; b.dataset.id = item.id; b.setAttribute("aria-label", item.name);
      const trail = el("span"); trail.className = "trail"; trail.append(icon("chev", "xs"));
      b.append(connLogo(item), connText(item.name), trail); b.onclick = () => showConnector(item.id); list.append(b);
    }
  }
}
$("conn-available").onclick = () => { connTab = "available"; connDraw(); };
$("conn-connected").onclick = () => { connTab = "connected"; connDraw(); };
$("conn-search").oninput = connDraw;
$("perm-to-connectors").onclick = () => setGo("connectors");`;
