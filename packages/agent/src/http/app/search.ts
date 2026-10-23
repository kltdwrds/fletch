// The Search dialog (M23.5, on the system's SearchDialog at M27.3, its rows on F2's answer at F3): Recents are the
// person's chats, newest first, and a query lists one row per chat: its title, the line that matched with the match
// emphasised, and when. Choosing a row opens its chat at that message. The route answers for the session's person
// alone and a memory line opens a chat only when it is theirs. A search that could not run says so; a chat that could
// not be searched, and the memory half failing, are said under the rows, never as none.

import { ic } from "./icons.ts";
import { SEARCH_TEXT } from "./permission-words.ts";

/** The dialog's own words: Clear, the canvas's no-results line (`{q}` the query as typed) and a chat not searched. */
export const SEARCH_DIALOG_TEXT = { clear: "Clear search", noResults: "No results for “{q}”.", side: "Side chat", unsearched: "“{title}” could not be searched just now." };

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
/* The card leaves with the system's dialog card exit (F3), in parallel with the scrim's and at its duration; the scrim
   holds #search, not the card, so the bundle's .qf-scrim2>.qf-dialog rules never reached it. Its enter stays as it was. */
.qf-scrim2.is-closing > #search > .qf-dialog { animation: qf-pop-out var(--qf-dur-fast) var(--qf-ease-in) forwards; }
@media (prefers-reduced-motion: reduce) { .qf-scrim2.is-closing > #search > .qf-dialog { animation: none; visibility: hidden; } }
#search-rule { height: 1px; margin: 0 13px; background: var(--fill-divider); }
#search-list { display: flex; flex-direction: column; }
#search-list .qf-result { width: 100%; min-height: 50px; border: 0; background: transparent; color: inherit; text-align: left; font-family: inherit; }
#search-list .qf-result .tile { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%; background: var(--fill-primary); color: var(--text-secondary); }
#search-list .qf-result .body { min-width: 0; }
#search-list .qf-result .t-foot { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#search-list .qf-result.is-active { background: var(--fill-highlight); }
.qf-snip { display: flex; gap: 4px; min-width: 0; font-size: 11px; line-height: 13px; color: var(--text-secondary); }
.qf-snip .line { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qf-snip mark { background: transparent; color: var(--text-primary); font-weight: 600; }
.qf-snip .when { flex-shrink: 0; }
.qf-snip .line + .when::before { content: "· "; }
#search-note, #search-unsearched p { margin: 16px 8px; }
#search-unsearched p { margin-block: 4px; }
#search-note:empty { display: none; }
`;

export const SEARCH_MARKUP = `<div id="search" role="dialog" aria-label="${SEARCH_TEXT.title}" hidden>
  <div id="search-card" class="qf-dialog">
    <form id="search-bar" class="qf-dialog-input" style="height:auto;padding:24px 18px 18px;gap:4px"><span class="lead">${ic("search", "sm")}</span><input id="search-q" type="text" enterkeyhint="search" placeholder="${SEARCH_TEXT.placeholder}" aria-label="${SEARCH_TEXT.label}" aria-controls="search-list" autocomplete="off"><button id="search-clear" type="button" class="qf-ibtn qf-ibtn--28" aria-label="${SEARCH_DIALOG_TEXT.clear}" hidden>${ic("x", "xs")}</button><button id="search-cancel" type="button" class="vh">${SEARCH_TEXT.cancel}</button></form>
    <div id="search-rule"></div>
    <div class="qf-dialog-list" style="padding:12px">
      <span id="search-heading" class="qf-dialog-label">${SEARCH_TEXT.recents}</span>
      <div id="search-list" role="listbox"></div>
      <div id="search-unsearched" class="t-sub t-2"></div>
      <p id="search-note" class="t-sub t-2"></p>
    </div>
  </div>
</div>`;

export const SEARCH_SCRIPT = `const SRCH = ${JSON.stringify(SEARCH_TEXT)}, SRCH_DLG = ${JSON.stringify(SEARCH_DIALOG_TEXT)};
// Answers arrive in any order; only the latest query's is drawn, and none once the dialog is closed. \`srchShown\` is
// the query whose rows are drawn, so an Enter typed before its answer opens that answer's first row when it lands.
let srchSeq = 0, srchShown = null, srchEnter = false, srchActive = 0;
function srchOpen() {
  if (!isOpen($("search"))) openDialog($("search"), { form: "center", onClose: () => { srchSeq++; srchEnter = false; } });
  srchSet("");
  if ($("search-q").focus) $("search-q").focus();
}
function srchClose() { closeDialog($("search")); }
// The query as typed: Clear is the field's one control, shown only with a query, and the list answers it.
function srchSet(q) { $("search-q").value = q; $("search-clear").hidden = !q; srchRun(q); }
// A row's line (F3, the dialog's and the drawer's): the matched message's words with the match in a mark, every part a
// text node, so a line holding markup reads as the text it is. A title or memory match draws its words alone.
function matchLine(c, fallback) {
  const s = el("span"); s.className = "line";
  const line = c.line || fallback;
  const m = c.line && c.match;
  if (m && m.start >= 0 && m.end > m.start && m.end <= line.length) s.append(line.slice(0, m.start), el("mark", line.slice(m.start, m.end)), line.slice(m.end));
  else s.append(line);
  return s;
}
// The snippet under a title: the line, then when (foundWhen, the list's helper).
function snipOf(c, fallback) {
  const s = el("div"); s.className = "qf-snip";
  s.append(matchLine(c, fallback));
  const w = el("span", foundWhen(c.at)); w.className = "when"; s.append(w);
  return s;
}
// Opens a row's chat at its message: the chat connects, and once its history is drawn the bubble is in view.
function openFound(c) { seekTo(c.chatId, c.mid); show("chat"); chats(c.chatId); }
function srchRow(c, i) {
  // A SearchDialog result: the chat's round tile, its title, then the line that matched (or the chat's kind) and when.
  const b = el("button"); b.className = "qf-result"; b.id = "search-opt-" + i; b.setAttribute("role", "option"); b.dataset.chat = c.chatId;
  const tile = el("span"); tile.className = "tile"; tile.append(icon("chat", "xs"));
  const body = el("div"); body.className = "body";
  const t = el("div", c.main ? SRCH.main : c.title); t.className = "t-foot";
  body.append(t, snipOf(c, c.main ? SRCH.main : SRCH_DLG.side)); b.append(tile, body);
  b.onclick = () => { srchClose(); openFound(c); };
  return b;
}
const srchRows = () => [...$("search-list").children];
// The active row (the arrow keys move it; Enter opens it): the first after every answer.
function srchMark(i) {
  const rows = srchRows();
  srchActive = rows.length ? Math.max(0, Math.min(rows.length - 1, i)) : 0;
  rows.forEach((r, k) => { cls(r, "is-active", k === srchActive); r.setAttribute("aria-selected", String(k === srchActive)); });
  if (rows[srchActive]) $("search-q").setAttribute("aria-activedescendant", rows[srchActive].id); else $("search-q").removeAttribute("aria-activedescendant");
}
async function srchRun(q) {
  const mine = ++srchSeq;
  srchShown = null;
  $("search-heading").textContent = q ? SRCH.results : SRCH.recents;
  let r;
  try { r = await getJson("/app/search?q=" + encodeURIComponent(q)); } catch (e) { if (mine === srchSeq) { srchEnter = false; $("search-list").replaceChildren(); $("search-unsearched").replaceChildren(); coded($("search-note"), SRCH.notRead, e.code); } return; }
  if (mine !== srchSeq) return;
  const rows = (q ? r.results : r.recents) || [];
  $("search-list").replaceChildren();
  rows.forEach((row, i) => $("search-list").append(srchRow(row, i)));
  srchMark(0);
  srchShown = q;
  // A chat that could not be searched is named with its code, one line each, under the rows that were found.
  $("search-unsearched").replaceChildren();
  for (const u of (q && r.unsearched) || []) $("search-unsearched").append(coded(el("p"), SRCH_DLG.unsearched.replace("{title}", u.title), u.code));
  $("search-note").dataset.code = "";
  const notes = [];
  if (!rows.length) notes.push(q ? SRCH_DLG.noResults.replace("{q}", q) : SRCH.emptyRecents);
  if (q && r.memory && !r.memory.ok) notes.push(SRCH.memoryDown);
  if (q && r.memory && r.memory.ok && r.memory.unplaced) notes.push(SRCH.unplaced[r.memory.unplaced === 1 ? 0 : 1].replace("{n}", String(r.memory.unplaced)));
  $("search-note").textContent = notes.join(" ");
  if (srchEnter) { srchEnter = false; srchPick(); }
}
// Enter opens the active row of the query as typed; before that query's answer is drawn, its first row once it is.
function srchPick() {
  if (srchShown !== $("search-q").value.trim()) { srchEnter = true; return; }
  const row = srchRows()[srchActive];
  if (row) row.onclick();
}
$("search-q").oninput = () => { const q = $("search-q").value.trim(); $("search-clear").hidden = !q; srchRun(q); };
$("search-q").onkeydown = (e) => {
  const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault(); srchMark(srchActive + step);
  const row = srchRows()[srchActive];
  if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
};
$("search-bar").onsubmit = (e) => { e.preventDefault(); srchPick(); };
$("search-clear").onclick = () => { srchSet(""); if ($("search-q").focus) $("search-q").focus(); };
$("search-cancel").onclick = srchClose;
$("rail-search").onclick = srchOpen;`;
