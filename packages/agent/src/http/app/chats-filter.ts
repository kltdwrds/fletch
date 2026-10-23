// The drawer's search (F3): a field in the chats list's head that filters the list in place from `/app/search`, the
// dialog's route and answer. Typing gives the section headings' place to the matching chats, each with its matched
// line under the title; clearing the field, or Escape in it, gives the full list back. The drawer stays open
// throughout: Escape in a field with a query clears it and goes no further. The rail's Search, the phone's More sheet
// and the Library still open the dialog. The script shares the page's scope (the list's `switchTo` and `foundWhen`, the
// dialog's `matchLine`, the thread's `seekTo`).
import { ic } from "./icons.ts";

/** The filter's words: the field, its Clear, the no-match line (`{q}` as typed) and a chat not searched. */
export const CHATS_FILTER_TEXT = {
  placeholder: "Search",
  label: "Search chats",
  clear: "Clear chat search",
  none: "No chats match “{q}”.",
  unsearched: "“{title}” could not be searched just now.",
  notRead: "Could not search just now. Try again.",
};

export const CHATS_FILTER_CSS = `
.drawer-top .qf-search { flex: 1; padding-inline-end: 4px; }
#chats-found { display: flex; flex-direction: column; gap: 1px; }
#chats-found .qf-listrow { flex-direction: column; align-items: stretch; justify-content: center; gap: 0; height: auto; min-height: 44px; padding-block: 6px; }
#chats-found p { margin: 8px; }
`;

/** The field in the drawer's head, then (after the list and the archived view) the filtered list's host. */
export const CHATS_FILTER_FIELD = `<label id="chats-find" class="qf-search">${ic("search", "sm")}<input id="chats-q" type="text" enterkeyhint="search" placeholder="${CHATS_FILTER_TEXT.placeholder}" aria-label="${CHATS_FILTER_TEXT.label}" autocomplete="off"><button id="chats-clear" type="button" class="qf-ibtn qf-ibtn--28" aria-label="${CHATS_FILTER_TEXT.clear}" hidden>${ic("x", "xs")}</button></label>`;
export const CHATS_FILTER_LIST = `<div id="chats-found" role="list" hidden></div>`;

export const CHATS_FILTER_SCRIPT = `const FIND = ${JSON.stringify(CHATS_FILTER_TEXT)};
// As the dialog's: only the latest query's answer is drawn, and none once the field is cleared.
let findSeq = 0;
function findRow(c) {
  const r = el("div"); r.className = "chatrow qf-rowwrap"; r.dataset.chat = c.chatId; r.setAttribute("role", "listitem");
  const b = el("button"); b.className = "qf-listrow";
  const t = el("span", c.main ? CHATS.main : c.title); t.className = "qf-lbl";
  b.append(t, snipOf(c, c.main ? CHATS.main : SRCH_DLG.side));
  b.onclick = () => { seekTo(c.chatId, c.mid); switchTo({ id: c.chatId, kind: c.main ? "main" : "side" }); };
  r.append(b);
  return r;
}
// The full list again: its headings, the list (not the archived view) and an empty field.
function findReset() {
  findSeq++;
  $("chats-q").value = ""; $("chats-clear").hidden = true;
  $("chats-found").hidden = true; $("chats-found").replaceChildren();
  showArchived(false);
}
async function findRun(q) {
  if (!q) return findReset();
  const mine = ++findSeq, box = $("chats-found");
  $("chats-clear").hidden = false;
  let r;
  try { r = await getJson("/app/search?q=" + encodeURIComponent(q)); } catch (e) { if (mine === findSeq) { box.replaceChildren(); box.append(coded(el("p"), FIND.notRead, e.code)); findShow(); } return; }
  if (mine !== findSeq) return;
  box.replaceChildren();
  for (const c of r.results || []) box.append(findRow(c));
  if (!(r.results || []).length) { const p = el("p", FIND.none.replace("{q}", q)); p.className = "t-sub t-2"; box.append(p); }
  for (const u of r.unsearched || []) { const p = coded(el("p"), FIND.unsearched.replace("{title}", u.title), u.code); p.className = "t-sub t-2"; box.append(p); }
  findShow();
}
function findShow() { $("chats").hidden = true; $("archived").hidden = true; $("chats-found").hidden = false; }
$("chats-q").oninput = () => findRun($("chats-q").value.trim());
$("chats-clear").onclick = () => { findReset(); if ($("chats-q").focus) $("chats-q").focus(); };
// Escape in a field holding a query clears it and stops there, so the drawer it sits in stays open.
$("chats-q").onkeydown = (e) => { if (e.key !== "Escape" || !$("chats-q").value) return; e.stopPropagation(); findReset(); };
`;
