// The chats list (M23.1's list column and drawer, drawn on the system's ListRow at M27.3): its words, its rules,
// the row menu's static items with inline rename, and the script that draws the list from the Person's answer.
// The script runs inside the chat's (CHAT_SCRIPT interpolates it where it stood), so it shares the chat's scope.
import { NEW_CHAT_PATH } from "../pages.ts";
import { ic } from "./icons.ts";

/**
 * The chats list's words (M27.3, the canvas's list column): the main chat, the side chats' heading, a row's
 * options, the archived view and inline rename. Pin and Delete are the canvas's and not drawn (DESIGN-ONLY).
 */
export const CHATS_TEXT = {
  main: "Main chat",
  side: "Side chats",
  options: "Chat options",
  listOptions: "Side chat options",
  showArchived: "Show archived chats",
  archivedTitle: "Archived chats",
  noArchived: "No archived chats.",
  back: "Back to chat list",
  restore: "Restore from archive",
  rename: "Rename",
  renameLabel: "Chat name",
  cancelRename: "Cancel renaming this chat",
  saveRename: "Save this chat's new name",
  archive: "Archive",
  notOpened: "The new chat did not open. Try again.",
  today: "Today",
  yesterday: "Yesterday",
  justNow: "Just now",
  minutes: "{n} min",
  hours: "{n} h",
};

/** How many characters of its first prompt name a chat (F8), before the cut and its ellipsis. */
export const TITLE_FROM_PROMPT = 60;

/**
 * A chat's name from its first prompt (F8): the prompt's own words on one line, trimmed, and past the cap cut at the
 * last word that fits (or at the cap when none does) with an ellipsis. The page script carries a copy (`CHATS_SCRIPT`),
 * which `test/workers/f8-new-chat.test.ts` holds to this one.
 */
export function promptTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= TITLE_FROM_PROMPT) return t;
  const cut = t.slice(0, TITLE_FROM_PROMPT);
  const at = cut.lastIndexOf(" ");
  return `${(at > TITLE_FROM_PROMPT / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/**
 * The list's rules: the rows, their options and the archived view. New side chat stays in the head at every width,
 * and shows the system's icon-button hover treatment on hover and on keyboard focus (F8: the glyph at the primary
 * colour on the hover fill; the bundle's `.qf-ibtn:hover` and `.is-hover` carry the fill alone), with its tooltip the
 * button's `title`. A row is the system's ListRow (`.qf-rowwrap`): its time and kebab show on hover, on focus and
 * while its menu is open (the kebab's `aria-expanded`, the system's `.is-open`). On a phone, where nothing hovers,
 * the kebab still takes a tap at the row's end and opens the row's actions as a sheet.
 */
export const CHATS_CSS = `
#chats, #archived { display: flex; flex-direction: column; gap: 1px; }
#chats .qf-listhead { padding: 0 4px 0 10px; margin-top: 6px; }
#new-chat:hover, #new-chat:focus-visible, #new-chat.is-hover { background: var(--fill-secondary-elevated-hover); color: var(--text-primary); }
.qf-rowwrap:has(> .qf-row-end [aria-expanded="true"]) > .qf-row-end { opacity: 1; pointer-events: auto; }
.qf-rowwrap:has(> .qf-row-end [aria-expanded="true"]) > .qf-listrow { padding-inline-end: 96px; background: var(--fill-highlight); }
.drawer-sheet .qf-row-end .qf-ibtn { pointer-events: auto; }
.chatrow .qf-listrow { gap: 6px; }
.chatrow .kind { flex-shrink: 0; font-size: 12px; line-height: 16px; color: var(--text-secondary); }
.chatrow .unread { flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--fill-blue); }
.chatrow .qf-listrow--unread .qf-lbl { font-weight: 600; }
#rename-form { gap: 4px; padding: 0 4px 0 6px; cursor: default; }
#rename-form .qf-ibtn { width: 24px; height: 24px; }
#archived h2 { margin: 8px 0 0; padding: 0 8px 8px; font: 400 12px/16px var(--font-sans); color: var(--text-secondary); }
#archived p { margin: 0; padding: 0 8px; }
.drawer-sheet { position: relative; }
`;

/** A row's menu items (Rename, Archive) and the inline rename row on TextField, kept in `#menu-home` until used. */
export const CHATS_MENU_MARKUP = `<button id="rename" class="qf-menu-item" role="menuitem">${ic("pencil", "xs")}${CHATS_TEXT.rename}</button>
  <button id="archive" class="qf-menu-item" role="menuitem">${ic("archive", "xs")}${CHATS_TEXT.archive}</button>
  <form id="rename-form" class="qf-listrow" hidden><input id="rename-title" aria-label="${CHATS_TEXT.renameLabel}" maxlength="80"><button type="button" id="rename-cancel" class="qf-ibtn" aria-label="${CHATS_TEXT.cancelRename}">${ic("x", "xs")}</button><button class="qf-ibtn" aria-label="${CHATS_TEXT.saveRename}">${ic("check", "xs")}</button></form>`;

export const CHATS_SCRIPT = `// The chats list on ListRow (the canvas's list column, and the phone's drawer): Main chat first, the Side chats
// heading with New side chat, then the others in the order opened. A row says its kind when it is a colleague's
// request or a mail chat, and wears the accent dot while one of its cards waits for a decision (BUILD-ONLY meta).
// A side chat's options are its Rename and Archive; the main chat has none (the Person refuses archiving it). Each
// row's end holds its last-message time, which its Chat answered, and the side chats' kebab: from 768 a Menu under
// it, on a phone the action sheet.
// Archived chats are their own view behind the list's options, each with Restore. Opening one closes a drawer
// that slides over the page.
// New side chat and the rename row are held by reference: a draw clears the list that holds the one, and a rename
// that ends takes the other out of the page before it goes home, and the document finds neither while it is out.
const NEW_CHAT = $("new-chat"), RENAME_FORM = $("rename-form");
// The list as the Person last answered it, so the document's title can name the open chat (F4), and the chat a fresh
// open draws (\`last\`), which home opens when no chat is open (F8: home reached from the placeholder).
let menuChat = null, renaming = null, listed = [], lastId = null;
// A chat's name from its first prompt (F8; chats-list.ts' \`promptTitle\`, the one the test holds this to): its words on
// one line, trimmed, and past the cap cut at the last word that fits with an ellipsis.
const TITLE_FROM_PROMPT = ${TITLE_FROM_PROMPT};
function promptTitle(text) {
  const t = text.replace(/\\s+/g, " ").trim();
  if (t.length <= TITLE_FROM_PROMPT) return t;
  const cut = t.slice(0, TITLE_FROM_PROMPT), at = cut.lastIndexOf(" ");
  return (at > TITLE_FROM_PROMPT / 2 ? cut.slice(0, at) : cut).trimEnd() + "…";
}
// Opening a chat from the list is SideChat's view transition where the browser has View Transitions: the 80 ms cross-fade
// from 768, and on a phone the push into a side chat or the pop back to the main chat. Without them the chat swaps at once.
// The chat's address is pushed (F4), at its message when the row is a found one (\`mid\`).
function switchTo(c) {
  const to = () => go(chatPath(c.id, c.mid));
  if (typeof document.startViewTransition !== "function") return to();
  const type = device() === "phone" ? (c.kind === "main" ? "qf-pop" : "qf-push") : null;
  try { document.startViewTransition(type ? { update: to, types: [type] } : to); } catch (e) { document.startViewTransition(to); }
}
function drawChat(c, into, archived) {
  const r = el("div"); r.className = "chatrow qf-rowwrap"; r.dataset.chat = c.id;
  const b = el("button"); b.className = "qf-listrow";
  const t = el("span", c.kind === "main" ? CHATS.main : c.title); t.className = "qf-lbl"; b.append(t);
  if (KIND[c.kind]) { const k = el("span", KIND[c.kind]); k.className = "kind"; b.append(k); }
  const u = el("span"); u.className = "unread"; u.hidden = true; b.append(u);
  b.onclick = () => switchTo(c);
  r.append(b);
  const end = el("div"); end.className = "qf-row-end";
  const t2 = el("span", lastLabel(c.lastAt)); t2.className = "qf-row-time"; if (c.lastCode) t2.dataset.code = c.lastCode; end.append(t2);
  if (c.kind === "main") end.setAttribute("style", "padding-inline-end:8px");
  else {
    const m = el("button"); m.className = "qf-ibtn qf-ibtn--28"; m.setAttribute("aria-label", CHATS.options); m.setAttribute("aria-haspopup", "menu"); m.setAttribute("aria-expanded", "false"); m.append(icon("dots", "xs"));
    m.onclick = () => { menuChat = c; if (archived) openMenu(m, [{ label: CHATS.restore, glyph: "restore", run: () => restore(c) }]); else openMenu(m, [$("rename"), $("archive")]); };
    end.append(m);
  }
  r.append(end);
  into.append(r);
  return r;
}
// A row's time (ListRow, inferred formats): the time today, Yesterday, the weekday within the week, else the date.
// A chat with nothing in it yet, or whose time could not be read (its code on the node), shows none.
function lastLabel(at) {
  if (typeof at !== "number") return "";
  const d = new Date(at), now = new Date(), y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === y.toDateString()) return CHATS.yesterday;
  if (now.getTime() - at < 6 * 86400000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function drawUnread() {
  // An unread row is the list's: the title at 600 and the accent dot at the row's end.
  for (const r of $("chats").querySelectorAll("[data-chat]")) { const b = r.children[0], on = waiting.get(r.dataset.chat) > 0, u = b.children[b.children.length - 1]; if (u) u.hidden = !on; b.className = "qf-listrow" + (on ? " qf-listrow--unread" : ""); }
}
// A search row's time (F3), one helper for the dialog and the drawer's filter: minutes, then hours, within the last
// day; after that the list's own labels. A row with no readable time shows none.
function foundWhen(at) {
  if (typeof at !== "number") return "";
  const ms = Date.now() - at;
  if (ms < 60000) return CHATS.justNow;
  if (ms < 3600000) return CHATS.minutes.replace("{n}", String(Math.floor(ms / 60000)));
  if (ms < 86400000) return CHATS.hours.replace("{n}", String(Math.floor(ms / 3600000)));
  return lastLabel(at);
}
// Reads the list and draws it, then opens \`select\` (or the open chat, or the one a fresh open draws). On the
// placeholder (F8) nothing is opened, so the draft stays; \`quiet\` keeps the open chat as it is (the first send
// connected it itself), marking its row current.
async function chats(select, quiet) {
  let v;
  try { v = await getJson("/app/chats"); } catch (e) { lineError("Could not read your chats just now. Reload the page to try again.", e && e.code); return; }
  mainId = v.main; lastId = v.last; renaming = null; listed = v.chats;
  $("conn").hidden = true;
  const bar = $("chats"); bar.replaceChildren();
  const live = v.chats.filter((c) => !c.archived);
  for (const c of live.filter((c) => c.kind === "main")) drawChat(c, bar, false);
  const head = el("div", CHATS.side); head.className = "qf-listhead"; head.append(NEW_CHAT); bar.append(head);
  for (const c of live.filter((c) => c.kind !== "main")) drawChat(c, bar, false);
  drawArchived(v.chats.filter((c) => c.archived));
  drawUnread();
  // A fresh open draws the chat the person last had open, which their Person recorded; never a default
  // that differs from what a reload draws (QYVR-151).
  if (drafting || quiet) currentRow(chatId); else open(select || chatId || v.last || mainId);
  retitle();
  refreshCount();
}
// The archived view: Back to the list, its heading, then each archived chat with Restore in its options.
function drawArchived(list) {
  const box = $("archived"); box.replaceChildren();
  const back = el("button"); back.className = "qf-ibtn qf-ibtn--filled"; back.setAttribute("aria-label", CHATS.back); back.append(icon("back", "sm"));
  back.onclick = () => showArchived(false);
  const h = el("h2", CHATS.archivedTitle); box.append(back, h);
  if (!list.length) { const p = el("p", CHATS.noArchived); p.className = "t-sub t-2"; box.append(p); }
  for (const c of list) drawChat(c, box, true);
}
function showArchived(on) { $("archived").hidden = !on; $("chats").hidden = on; }
async function restore(c) {
  const r = await post("/app/chats/" + c.id + "/archive", { archived: false });
  if (r.ok) { showArchived(false); chats(chatId); } else await failedTo(lineError("", ""), "Restore", r);
}
$("archived-btn").onclick = () => openMenu($("archived-btn"), [{ label: CHATS.showArchived, glyph: "archive", run: () => showArchived(true) }]);
// New side chat is the placeholder's address (F8): pushed like any chat's, creating nothing until the first send.
NEW_CHAT.onclick = () => go(${JSON.stringify(NEW_CHAT_PATH)});
// Inline rename (the canvas's row on TextField): the row's button gives its place to the form until it is saved
// or cancelled; the name goes to the Person, which decides.
$("rename").onclick = () => {
  const c = menuChat; closeMenu();
  const row = c && [...$("chats").querySelectorAll("[data-chat]")].find((r) => r.dataset.chat === c.id);
  if (!row) return;
  endRename();
  renaming = { row, button: row.children[0] };
  $("rename-title").value = c.title || ""; RENAME_FORM.hidden = false;
  renaming.button.replaceWith(RENAME_FORM);
  if ($("rename-title").focus) $("rename-title").focus();
};
function endRename() {
  if (!renaming) return;
  RENAME_FORM.replaceWith(renaming.button); RENAME_FORM.hidden = true; $("menu-home").append(RENAME_FORM);
  renaming = null;
}
$("rename-cancel").onclick = endRename;
RENAME_FORM.onsubmit = async (e) => {
  e.preventDefault();
  if (!renaming) return;
  const id = renaming.row.dataset.chat;
  const r = await post("/app/chats/" + id + "/rename", { title: $("rename-title").value });
  if (r.ok) { endRename(); chats(chatId); } else await failedTo(lineError("", ""), "Rename", r);
};
$("archive").onclick = async () => {
  const c = menuChat; closeMenu();
  if (!c || c.id === mainId) return;
  const r = await post("/app/chats/" + c.id + "/archive", { archived: true });
  // The open chat archived, the page draws the main chat in its place, at the main chat's address.
  if (!r.ok) return void await failedTo(lineError("", ""), "Archive", r);
  if (c.id !== chatId) return void chats(chatId);
  await chats(mainId);
  go(chatPath(mainId), { replace: true });
};
`;
