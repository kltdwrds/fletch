// The overlay helper (M27.2, split from shell.ts at M29.6), part of every page's COMMON_SCRIPT: a borrowed node's way
// home, the system's exit motion (design review 1, I3), the dialogs on their scrims, the one menu and the ConfirmDialog,
// and the history entries the overlays own (F5, rule 7 of the grammar in `../pages.ts`): an overlay without an address
// pushes one entry at the same address when it opens, so back closes it and the page beneath stays; Settings owns the
// entries of its addresses. A close by Escape, the scrim or its own control pops exactly the entries it owns, and only
// when the entry on top carries its marker; a back the person pressed closes what sits above the entry it lands on.
/** The forms a dialog takes on a phone (MobileDialog, BottomSheet), and `start`, the chats drawer's side sheet. */
export const DIALOG_FORMS = ["center", "sheet", "full", "page", "start"] as const;

export const OVERLAY_SCRIPT = `// A node an overlay borrows keeps its place: its parent and the node after it, so it goes back exactly there.
// Nodes go back last-borrowed first, so a sibling borrowed with it is home again before it is asked for.
const homes = new Map();
function borrow(node, into) { if (!homes.has(node)) homes.set(node, { parent: node.parentNode, next: node.nextSibling }); into.append(node); }
function giveBack(node) {
  const h = homes.get(node);
  if (!h || !h.parent) return false;
  homes.delete(node);
  if (h.next && h.next.parentNode === h.parent) h.parent.insertBefore(node, h.next); else h.parent.append(node);
  return true;
}
// A class on an element the script draws (the page's own nodes; className, so it reads the same everywhere).
const hasCls = (n, c) => (" " + (n.className || "") + " ").includes(" " + c + " ");
const cls = (n, c, on) => { const k = String(n.className || "").split(" ").filter((x) => x && x !== c); if (on) k.push(c); n.className = k.join(" "); };
// An overlay's exit (the system's .is-closing pattern, design review 1 I3): the class goes on \`marks\`, the bundle runs
// the exit, and \`done\` hides the node or gives it back only when the exit's animations under \`roots\` have ended. With
// none (reduced motion, a node not on screen, a page without the Web Animations API) \`done\` runs at once. A node
// opened again mid-exit settles it first (\`settle\`), so it is home before it is borrowed again.
const exits = new Map();
const finite = (a) => a.effect && a.effect.getComputedTiming().endTime !== Infinity;
function exit(roots, marks, done, keys = roots) {
  let anims = [];
  if (typeof roots[0].getAnimations === "function") { for (const m of marks) cls(m, "is-closing", true); anims = roots.flatMap((r) => r.getAnimations({ subtree: true })).filter(finite); }
  let ran = false;
  const finish = () => { if (ran) return; ran = true; for (const k of keys) exits.delete(k); done(); for (const m of marks) cls(m, "is-closing", false); };
  if (!anims.length) return finish();
  for (const k of keys) exits.set(k, finish);
  Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(finish);
}
const settle = (node) => { const f = exits.get(node); if (f) f(); };
// The overlays open, top last: each is a scrim (the first is #scrim) holding one node. A dialog's scrim is the system's
// .qf-scrim2; the chats drawer (\`start\`) sits in a .qf-drawer-wrap over the phone's veil (.qf-drawer-scrim) or, from
// 768, the overlay's click catcher (.qf-listscrim), so it moves as the drawer and the overlay do.
const FORMS = ${JSON.stringify(DIALOG_FORMS)};
// The history the overlays own. Every write goes through \`hist\`: while a pop of ours is on its way (a browser's
// \`history.go\` lands later, with a \`popstate\`), a write waits for it, so a close then an open, or a close then a
// navigation, never writes on the entry being left. An entry's state carries its owner's \`layer\` mark (Settings'
// is "settings") and Settings' depth, \`set\`, which every entry over Settings repeats.
const here = () => location.pathname + location.search + location.hash;
let marks = 0, popWait = null;
function hist(f) { if (popWait) popWait.push(f); else f(); }
function own() {
  const m = ++marks;
  hist(() => history.pushState({ layer: m, set: (history.state && history.state.set) || 0 }, "", here()));
  return m;
}
// Pops the entries of \`owned\` (bottom first, all closing at once): one each, Settings its depth. Guarded by the
// marker: when the entry on top is not the topmost owner's, nothing is popped (it is not ours to pop).
function unown(owned) {
  if (!owned.length) return;
  hist(() => {
    const s = history.state || {}, top = owned[owned.length - 1].mark;
    const n = owned.reduce((k, o) => k + (o.mark === "settings" ? s.set || 0 : 1), 0);
    if (s.layer !== top || n < 1) return;
    popWait = []; history.go(-n);
  });
}
// The \`popstate\` of a pop of ours: the writes that waited run, and it is answered (true). Any other \`popstate\` is
// the person's back or forward: what sits above the entry it landed on closes, without popping, and it is not (false).
function popLanded() {
  if (popWait) { const q = popWait; popWait = null; for (const f of q) hist(f); return true; }
  const s = history.state, open = layers.map((l) => ({ mark: l.mark, shut: () => closeDialog(l.node, true) })).concat(loose);
  const i = open.findIndex((o) => s && o.mark === s.layer);
  for (const o of open.slice(i + 1).reverse()) o.shut(true);
  return false;
}
// An overlay not on a scrim (the menu, the invite and message popovers) owns its entry here; \`shut(keep)\` closes it.
let loose = [];
function ownLoose(shut) { loose.push({ mark: own(), shut }); }
function dropLoose(shut, keep) {
  const i = loose.findIndex((o) => o.shut === shut);
  if (i < 0) return;
  const gone = loose.splice(i, 1);
  if (!keep) unown(gone);
}
let layers = [];
// \`o.mark\` names the entries the overlay already has (Settings' addresses); without one it pushes its own.
function openDialog(node, o = {}) {
  const form = FORMS.includes(o.form) ? o.form : "center";
  closeMenu();
  settle(node);
  let scrim = $("scrim");
  if (layers.length) { scrim = el("div"); scrim.setAttribute("style", "z-index:" + (50 + layers.length * 3)); $("app").append(scrim); } else settle(scrim);
  scrim.className = form === "start" ? "qf-drawer-wrap" : "qf-scrim2 qf-scrim2--" + form; scrim.dataset.form = form;
  scrim.replaceChildren();
  let veil = null;
  if (form === "start") { veil = el("div"); veil.className = device() === "phone" ? "qf-drawer-scrim" : "qf-listscrim"; scrim.append(veil); }
  borrow(node, scrim);
  node.hidden = false; scrim.hidden = false;
  scrim.onclick = (e) => { if (!e || e.target === scrim || (veil && e.target === veil)) closeDialog(node); };
  layers.push({ scrim, node, onClose: o.onClose, mark: o.mark || own() });
  return node;
}
// Closes the overlay holding \`node\` and every one opened over it, and pops their entries unless \`keep\` (the history
// has already moved). Their exits run together; then, top first, each node goes home and its scrim is hidden, so the
// borrow order of M29.1 holds.
function closeDialog(node, keep) {
  const i = layers.findIndex((l) => l.node === node);
  if (i < 0) return;
  // Off the stack before the pop, so a \`popstate\` that lands at once (and closes what is open) finds them gone.
  const closing = layers.splice(i);
  if (!keep) unown(closing);
  closing.reverse();
  const scrims = closing.map((l) => l.scrim);
  const marks = closing.flatMap((l) => (l.scrim.dataset.form === "start" ? [l.scrim, l.node] : [l.scrim]));
  exit(scrims, marks, () => {
    for (const l of closing) {
      l.node.hidden = true; giveBack(l.node);
      l.scrim.hidden = true; if (l.scrim !== $("scrim")) l.scrim.remove();
      if (l.onClose) l.onClose();
    }
  }, [...scrims, ...closing.map((l) => l.node)]);
}
const isOpen = (node) => layers.some((l) => l.node === node);
// Closes every overlay on a scrim and the menu, popping all their entries at once (\`keep\`: none).
function closeOverlays(keep) {
  const owned = layers.concat(loose.filter((o) => o.shut === menuShut));
  closeMenu(true, true); if (layers.length) closeDialog(layers[0].node, true);
  if (!keep) unown(owned);
}
// The one menu: \`items\` are the static nodes a module keeps (its ids stay bound) or { label, glyph, danger, run }.
let menuFor = null, menuItems = [];
function openMenu(anchor, items) {
  const again = menuFor === anchor;
  closeMenu();
  if (again) return;
  settle($("menu-layer"));
  const m = $("menu"), sheet = device() === "phone";
  menuFor = anchor; anchor.setAttribute("aria-expanded", "true"); ownLoose(menuShut);
  for (const it of items) {
    let n = it;
    if (!(it instanceof Node)) {
      n = el("button"); n.className = "qf-menu-item" + (it.danger ? " is-danger" : ""); n.setAttribute("role", "menuitem");
      if (it.glyph) n.append(icon(it.glyph, "xs"));
      n.append(el("span", it.label)); n.onclick = () => { closeMenu(); it.run(); };
      m.append(n);
    } else borrow(n, m);
    menuItems.push(n);
  }
  m.className = "qf-menu" + (sheet ? " qf-menu--sheet" : ""); m.dataset.form = sheet ? "sheet" : "popover";
  m.removeAttribute("style");
  // A popover hangs under its anchor, or over it in the frame's lower half, and beside the rail when the rail holds it.
  if (!sheet && anchor.getBoundingClientRect && $("app").getBoundingClientRect) {
    const r = anchor.getBoundingClientRect(), a = $("app").getBoundingClientRect();
    const left = r.right - a.left < 80 ? r.right - a.left + 4 : Math.max(8, Math.min(r.left - a.left, a.width - 232));
    const v = r.top - a.top > a.height / 2 ? "bottom:" + Math.round(a.bottom - r.bottom) + "px" : "top:" + Math.round(r.bottom - a.top + 6) + "px";
    m.setAttribute("style", "left:" + Math.round(left) + "px;" + v);
  }
  $("menu-backdrop").className = "qf-backdrop" + (sheet ? " is-sheet" : ""); $("menu-backdrop").hidden = false;
  m.hidden = false;
}
// A menu leaves with its exit (Menu, ActionSheet), its items going home after it; Escape closes it at once, as Muse's does.
function closeMenu(now, keep) {
  dropLoose(menuShut, keep);
  if (menuFor) menuFor.setAttribute("aria-expanded", "false");
  const items = menuItems.reverse();
  menuItems = []; menuFor = null;
  const gone = () => { for (const n of items) if (!giveBack(n)) n.remove(); $("menu").hidden = true; $("menu-backdrop").hidden = true; };
  if (exits.has($("menu-layer"))) { if (now) settle($("menu-layer")); return; }
  if (now || $("menu").hidden) return gone();
  exit([$("menu-layer")], [$("menu-layer"), $("menu")], gone);
}
function menuShut(keep) { closeMenu(true, keep); }
// The backdrop closes with the exit: the click event is not \`now\`.
$("menu-backdrop").onclick = () => closeMenu();
// A question before something that cannot be undone (ConfirmDialog): Cancel, then the action, red unless it says not.
function confirmDialog(title, body, action) {
  $("confirm-title").textContent = title; $("confirm-body").textContent = body;
  const ok = $("confirm-ok"); ok.textContent = action.label; ok.className = "qf-btn " + (action.danger === false ? "qf-btn--primary" : "qf-btn--destructive");
  ok.onclick = async () => { closeDialog($("confirm")); await action.run(); };
  $("confirm-cancel").onclick = () => closeDialog($("confirm"));
  return openDialog($("confirm"), { form: "center" });
}
if (document.addEventListener) document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (menuFor) closeMenu(true); else if (layers.length) closeDialog(layers[layers.length - 1].node); });`;
