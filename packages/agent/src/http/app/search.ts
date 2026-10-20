// The Search dialog (M23.5, on the system's SearchDialog at M27.3): Recents are the person's chats, newest first, and
// a query lists the chats whose titles match plus the chats memory search finds lines in, each opening its chat.
// The route answers for the session's person alone and a memory line opens a chat only when it is theirs. A
// search that could not run says so; the memory half failing is said beside the title matches, never as none.

import { ic } from "./icons.ts";
import { SEARCH_TEXT } from "./permission-words.ts";

/** The dialog's own words: Clear and the canvas's no-results line, `{q}` the query as typed. */
export const SEARCH_DIALOG_TEXT = { clear: "Clear search", noResults: "No results for “{q}”.", side: "Side chat" };

/**
 * The dialog's frame (SearchDialog): the canvas opens it on the scrim at the top, 96 px down, 538 px wide on a
 * tablet and a desktop and inset 16 px on a phone, over whatever was open (the phone's drawer stays under it).
 */
export const SEARCH_CSS = `
.qf-scrim2:has(> #search) { align-items: flex-start; padding-top: 96px; }
#search { width: 100%; max-width: 538px; }
#search .qf-dialog { max-width: none; }
#search-bar { margin: 0; }
#search-bar .lead { display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; color: var(--text-secondary); }
#search-rule { height: 1px; margin: 0 13px; background: var(--fill-divider); }
#search-list { display: flex; flex-direction: column; }
#search-list .qf-result { width: 100%; height: 50px; border: 0; background: transparent; color: inherit; text-align: left; font-family: inherit; }
#search-list .qf-result .tile { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%; background: var(--fill-primary); color: var(--text-secondary); }
#search-list .qf-result .body { min-width: 0; }
#search-list .qf-result .t-foot { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#search-list .qf-result .qf-snip { font-size: 11px; line-height: 13px; }
#search-note { margin: 16px 8px; }
#search-note:empty { display: none; }
`;

export const SEARCH_MARKUP = `<div id="search" role="dialog" aria-label="${SEARCH_TEXT.title}" hidden>
  <div id="search-card" class="qf-dialog">
    <form id="search-bar" class="qf-dialog-input" style="height:auto;padding:24px 18px 18px;gap:4px"><span class="lead">${ic("search", "sm")}</span><input id="search-q" type="search" placeholder="${SEARCH_TEXT.placeholder}" aria-label="${SEARCH_TEXT.label}" autocomplete="off"><button id="search-clear" type="button" class="qf-ibtn qf-ibtn--28" aria-label="${SEARCH_DIALOG_TEXT.clear}" hidden>${ic("x", "xs")}</button><button id="search-cancel" type="button" class="vh">${SEARCH_TEXT.cancel}</button></form>
    <div id="search-rule"></div>
    <div class="qf-dialog-list" style="padding:12px">
      <span id="search-heading" class="qf-dialog-label">${SEARCH_TEXT.recents}</span>
      <div id="search-list" role="listbox"></div>
      <p id="search-note" class="t-sub t-2"></p>
    </div>
  </div>
</div>`;

export const SEARCH_SCRIPT = `const SRCH = ${JSON.stringify(SEARCH_TEXT)}, SRCH_DLG = ${JSON.stringify(SEARCH_DIALOG_TEXT)};
// Answers arrive in any order; only the latest query's is drawn, and none once the dialog is closed.
let srchSeq = 0;
function srchOpen() {
  if (!isOpen($("search"))) openDialog($("search"), { form: "center", onClose: () => { srchSeq++; } });
  srchSet("");
  if ($("search-q").focus) $("search-q").focus();
}
function srchClose() { closeDialog($("search")); }
// The query as typed: Clear shows once there is one, and the list answers it.
function srchSet(q) { $("search-q").value = q; srchRun(""); $("search-clear").hidden = true; }
function srchRow(c) {
  // A SearchDialog result: the chat's round tile, its title, then the line memory found (or the chat's kind) and when.
  const b = el("button"); b.className = "qf-result"; b.setAttribute("role", "option"); b.dataset.chat = c.chatId;
  const tile = el("span"); tile.className = "tile"; tile.append(icon("chat", "xs"));
  const body = el("div"); body.className = "body";
  const t = el("div", c.main ? SRCH.main : c.title); t.className = "t-foot";
  const s = el("div", [c.line || (c.main ? SRCH.main : SRCH_DLG.side), connWhen(c.at)].join(" · ")); s.className = "qf-snip";
  body.append(t, s); b.append(tile, body);
  b.onclick = () => { srchClose(); show("chat"); chats(c.chatId); };
  return b;
}
async function srchRun(q) {
  const mine = ++srchSeq;
  $("search-heading").textContent = q ? SRCH.results : SRCH.recents;
  let r;
  try { r = await getJson("/app/search?q=" + encodeURIComponent(q)); } catch (e) { if (mine === srchSeq) { $("search-list").replaceChildren(); coded($("search-note"), SRCH.notRead, e.code); } return; }
  if (mine !== srchSeq) return;
  const rows = q ? r.results : r.recents;
  $("search-list").replaceChildren();
  for (const row of rows) $("search-list").append(srchRow(row));
  $("search-note").dataset.code = "";
  const notes = [];
  if (!rows.length) notes.push(q ? SRCH_DLG.noResults.replace("{q}", q) : SRCH.emptyRecents);
  if (q && r.memory && !r.memory.ok) notes.push(SRCH.memoryDown);
  if (q && r.memory && r.memory.ok && r.memory.unplaced) notes.push(SRCH.unplaced[r.memory.unplaced === 1 ? 0 : 1].replace("{n}", String(r.memory.unplaced)));
  $("search-note").textContent = notes.join(" ");
}
$("search-q").oninput = () => { const q = $("search-q").value.trim(); $("search-clear").hidden = !q; srchRun(q); };
$("search-bar").onsubmit = (e) => { e.preventDefault(); srchRun($("search-q").value.trim()); };
$("search-clear").onclick = () => { srchSet(""); if ($("search-q").focus) $("search-q").focus(); };
$("search-cancel").onclick = srchClose;
$("rail-search").onclick = srchOpen;`;
