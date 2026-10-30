// The router (F4, D-0009): the address is the page the person asked for, on the grammar both sides read
// (`../pages.ts`). `go(path, { replace })` pushes or replaces the history entry and draws it; `popstate` draws from
// `location`; drawing a page calls what the shell already has (`show`, `open`, `seekTo`). Every navigation the shell
// makes goes through `go`, from what the person did; nothing the page does on its own (a chat connected in the
// background under another view, a list re-read) writes the address. `/` is home: it draws the last chat and becomes
// that chat's address by `replaceState`, never by a push, so one back leaves the app. A message's position is the
// fragment, `/chats/<id>#<mid>`. A new chat is `/chats/new` (F8): the chat view as a placeholder, nothing made until
// its first send, which replaces the address with the made chat's. A path that is no page draws the not-found page, which names it as text. A Library
// file (F6) is `/library/files/<path>`, drawn as the Library with its viewer open; at boot in a fresh tab `/library` is
// rebuilt beneath it, as Settings' entries are, so the viewer's Back (\`history.back()\`) lands on the list. Settings (F5) is drawn over
// the page beneath it, which stays as it was: opening it pushes its addresses, closing it pops them (overlays.ts owns
// the entries), and a reload at one draws it over home with the addresses above it rebuilt, so its Back still works.
import { NEW_CHAT_PATH, PAGES } from "../pages.ts";

/** The router's words: the not-found page and the document's title. */
export const ROUTER_TEXT = {
  missing: "There is no page at {path}.",
  home: "Go to your chats",
  notFound: "Not found",
  app: "fletch",
};

/** The not-found page, a view of `#stage` beside the tabs' (the shell shows it by the name `nowhere`). */
export const ROUTER_MARKUP = `<main id="nowhere" hidden><div class="qf-page qf-page--768"><div class="qf-page-in">
  <p id="nowhere-path" class="t-body"></p>
  <p class="t-body"><a id="nowhere-home" href="/">${ROUTER_TEXT.home}</a></p>
</div></div></main>`;

export const ROUTER_SCRIPT = `// The grammar's rows as the server reads them, each pattern compiled once.
const PAGES = ${JSON.stringify(PAGES)}.map((p) => Object.assign(p, { re: new RegExp(p.pattern) }));
const ROUTER = ${JSON.stringify(ROUTER_TEXT)};
const VIEW_PATH = { feed: "/feed", goals: "/goals", library: "/library" };
// A collection's id, its segments decoded one by one (pages.ts' \`segmentsOf\`): an empty, \`.\` or \`..\` segment, a bad
// escape or a slash inside one is no page.
function segmentsOf(enc) {
  const out = [];
  for (const seg of enc.split("/")) {
    let s;
    try { s = decodeURIComponent(seg); } catch (e) { return null; }
    if (s === "" || s === "." || s === ".." || s.includes("/")) return null;
    out.push(s);
  }
  return out.join("/");
}
function pageAt(path) {
  for (const p of PAGES) {
    const m = p.re.exec(path);
    if (!m) continue;
    if (!p.segments) return { row: p, id: m[1] ? decodeURIComponent(m[1]) : null };
    const id = segmentsOf(m[1]);
    return id === null ? null : { row: p, id };
  }
  return null;
}
const chatPath = (id, mid) => "/chats/" + encodeURIComponent(id) + (mid ? "#" + encodeURIComponent(mid) : "");
const filePath = (path) => "/library/files/" + path.split("/").map(encodeURIComponent).join("/");
const isFile = (path) => { const p = pageAt(path.split(/[?#]/)[0]); return !!p && p.row.name === "files"; };
const isSet = (path) => { const p = pageAt(path.split(/[?#]/)[0]); return !!p && p.row.view === "settings"; };
// The page beneath any overlay, as last drawn, and the Settings address on screen: a \`popstate\` that lands on either
// draws nothing again.
let drawnAt = null, setDrawnAt = null;
// The one way the address changes: the person asked for \`path\`. The same address again is drawn, not pushed twice.
// Leaving for a page (or opening Settings) closes what is open and pops its entries first; the write waits for them.
function go(path, o) {
  const replace = o && o.replace, within = isSet(path) && isOpen($("set-dialog"));
  if (!within) { closeOverlays(); closeInvite(); }
  hist(() => {
    if (path === here()) return;
    if (isSet(path) && !within) { setChain(path).forEach((a, i) => history.pushState({ layer: "settings", set: i + 1 }, "", a)); return; }
    // A file's entry is marked, so a reload at it keeps the list beneath instead of rebuilding it.
    const st = within ? { layer: "settings", set: ((history.state && history.state.set) || 0) + (replace ? 0 : 1) } : isFile(path) ? { page: "file" } : null;
    history[replace ? "replaceState" : "pushState"](st, "", path);
  });
  drawPage(false, path);
}
// A tab, the rail, or a line that sends the person to the chat: the open chat's address (the placeholder's while a
// draft is the open chat, F8), or home before one is open.
function toView(v) { go(v === "chat" ? (drafting ? ${JSON.stringify(NEW_CHAT_PATH)} : chatId ? chatPath(chatId) : "/") : VIEW_PATH[v]); }
// Draws what the address (\`at\`, the current one unless \`go\` names it) names. At boot the chat is opened by the list's
// answer (\`chats\`), not here, so it opens once.
function drawPage(boot, at) {
  at = at || here();
  const h = at.indexOf("#"), path = (h < 0 ? at : at.slice(0, h)).split("?")[0], p = pageAt(path);
  const mid = h >= 0 && h < at.length - 1 ? decodeURIComponent(at.slice(h + 1)) : null;
  if (p && p.row.view === "settings") {
    // Settings over the page beneath; at boot that is home, and the entries above the address are rebuilt over it.
    if (drawnAt === null) {
      show("chat"); drawnAt = "/";
      // A reload keeps the entries and their states; a fresh tab rebuilds them over home.
      if (!(history.state && history.state.layer === "settings")) {
        history.replaceState(null, "", "/");
        setChain(path).forEach((a, i) => history.pushState({ layer: "settings", set: i + 1 }, "", a));
      }
    }
    setDrawnAt = path; setDraw(path); retitle(); return;
  }
  drawnAt = at; setDrawnAt = null;
  if (!p) { show("nowhere"); $("nowhere-path").textContent = ROUTER.missing.replace("{path}", path); retitle(); return; }
  if (p.row.name === "files" && boot && !(history.state && history.state.page === "file")) {
    // A fresh tab at a file: the list is rebuilt beneath it, so the viewer's Back lands on the Library, not outside.
    history.replaceState(null, "", "/library"); history.pushState({ page: "file" }, "", at);
  }
  show(p.row.view);
  if (p.row.name === "files") libShow(p.id);
  else if (p.row.name === "library") closeViewer();
  // Home is the open chat, or (reached from the placeholder, F8) the chat a fresh open draws, opened here.
  if (p.row.name === "home") {
    const id = chatId || lastId;
    if (id && id !== chatId) open(id);
    if (id) { drawnAt = chatPath(id); hist(() => history.replaceState(null, "", chatPath(id))); }
  }
  if (p.row.name === "new") openDraft();
  if (p.row.name === "chat") {
    if (mid) seekTo(p.id, mid);
    if (!boot && (p.id !== chatId || mid)) open(p.id);
  }
  retitle();
}
// The document's title names the page: Settings while it is open, the open chat's title on a chat (the action's
// name on the placeholder, F8), the open file's name in the Library, else the view's.
function retitle() {
  const c = shown === "chat" && listed.find((x) => x.id === chatId);
  const name = isOpen($("set-dialog")) ? SETTINGS.title : shown === "chat" ? (c ? (c.kind === "main" ? CHATS.main : c.title) : drafting ? SHELL.newChat : "") : shown === "library" && libOpened ? baseOf(libOpened) : TITLE[shown];
  document.title = name ? name + " · " + ROUTER.app : ROUTER.app;
}
$("nowhere-home").onclick = (e) => { if (e && e.preventDefault) e.preventDefault(); go("/"); };
// Back or forward. A pop of ours lands where the page beneath already is, so it draws nothing unless that page is not
// the one on screen (Settings reloaded over home, then closed onto the page it was opened from). The person's back or
// forward closes what sat above the entry it landed on (overlays.ts) and draws the address when it is not on screen.
// Home is drawn again so it becomes the last chat's address.
window.addEventListener("popstate", () => {
  const ours = popLanded();
  if (popWait) return;
  if (isSet(location.pathname)) { if (!ours && (location.pathname !== setDrawnAt || !isOpen($("set-dialog")))) drawPage(); return; }
  if ((here() !== drawnAt || location.pathname === "/") && !(ours && history.state && history.state.layer)) drawPage();
});
const booted = pageAt(location.pathname);
drawPage(true);
// Home becomes the chat the list opened, unless the person has gone elsewhere meanwhile (the placeholder opens none).
chats(booted && booted.row.name === "chat" ? booted.id : null).then(() => {
  if (location.pathname === "/" && chatId) { drawnAt = chatPath(chatId); hist(() => history.replaceState(history.state, "", chatPath(chatId))); }
  retitle();
});
if (pinnable()) loadPanel();`;
