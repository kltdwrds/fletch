// The router (F4, D-0009): the address is the page the person asked for, on the grammar both sides read
// (`../pages.ts`). `go(path, { replace })` pushes or replaces the history entry and draws it; `popstate` draws from
// `location`; drawing a page calls what the shell already has (`show`, `open`, `seekTo`). Every navigation the shell
// makes goes through `go`, from what the person did; nothing the page does on its own (a chat connected in the
// background under another view, a list re-read) writes the address. `/` is home: it draws the last chat and becomes
// that chat's address by `replaceState`, never by a push, so one back leaves the app. A message's position is the
// fragment, `/chats/<id>#<mid>`. A path that is no page draws the not-found page, which names it as text; a row
// reserved for a later part (Settings, the Library's collections) says it draws nothing there yet.
import { PAGES } from "../pages.ts";

/** The router's words: the not-found page and the document's title. */
export const ROUTER_TEXT = {
  missing: "There is no page at {path}.",
  notYet: "This version of fletch has no page at {path} yet.",
  home: "Go to your chats",
  notFound: "Not found",
  app: "qyvr",
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
function pageAt(path) {
  for (const p of PAGES) { const m = p.re.exec(path); if (m) return { row: p, id: m[1] ? decodeURIComponent(m[1]) : null }; }
  return null;
}
const chatPath = (id, mid) => "/chats/" + encodeURIComponent(id) + (mid ? "#" + encodeURIComponent(mid) : "");
// A Share link (\`/?file=\`) opens the Library, which opens its file, until the file has its own address (F6).
const fileLink = () => !!new URLSearchParams(location.search).get("file");
// The one way the address changes: the person asked for \`path\`. The same address again is drawn, not pushed twice.
function go(path, o) {
  if (path !== location.pathname + location.search + location.hash) history[o && o.replace ? "replaceState" : "pushState"](null, "", path);
  drawPage();
}
// A tab, the rail, or a line that sends the person to the chat: the open chat's address, or home before one is open.
function toView(v) { go(v === "chat" ? (chatId ? chatPath(chatId) : "/") : VIEW_PATH[v]); }
// Draws what the address names. At boot the chat is opened by the list's answer (\`chats\`), not here, so it opens once.
function drawPage(boot) {
  const path = location.pathname, p = pageAt(path);
  const mid = location.hash ? decodeURIComponent(location.hash.slice(1)) : null;
  if (!p || !p.row.view) { show("nowhere"); $("nowhere-path").textContent = (p ? ROUTER.notYet : ROUTER.missing).replace("{path}", path); retitle(); return; }
  if (p.row.name === "home" && fileLink()) show("library");
  else show(p.row.view);
  if (p.row.name === "home" && !fileLink() && chatId) history.replaceState(null, "", chatPath(chatId));
  if (p.row.name === "chat") {
    if (mid) seekTo(p.id, mid);
    if (!boot && (p.id !== chatId || mid)) open(p.id);
  }
  retitle();
}
// The document's title names the page: the open chat's title on a chat, else the view's.
function retitle() {
  const c = shown === "chat" && listed.find((x) => x.id === chatId);
  const name = shown === "chat" ? (c ? (c.kind === "main" ? CHATS.main : c.title) : "") : TITLE[shown];
  document.title = name ? name + " · " + ROUTER.app : ROUTER.app;
}
$("nowhere-home").onclick = (e) => { if (e && e.preventDefault) e.preventDefault(); go("/"); };
window.addEventListener("popstate", () => drawPage());
const booted = pageAt(location.pathname);
drawPage(true);
// Home becomes the chat the list opened, unless the person has gone elsewhere meanwhile.
chats(booted && booted.row.name === "chat" ? booted.id : null).then(() => {
  if (location.pathname === "/" && !fileLink() && chatId) history.replaceState(null, "", chatPath(chatId));
  retitle();
});
if (pinnable()) loadPanel();`;
