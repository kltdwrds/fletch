// Message actions (M29.4, design review 1's row H1): the canvas's message with its phone ⋯ and the "Message
// actions" sheet, the hover row from 768 with the reaction picker and More options, the reaction pill, the composer's
// "Replying to" quote and Copy with the refused-clipboard fallback. Interpolated into the chat's words, rules,
// markup and script (`chat.ts`), so it shares the chat's scope: `log`, `conn`, `input`, `add`, `sideOf` and the
// shell's overlays.
import { REACTIONS } from "../../chat/reactions.ts";
import { ic } from "./icons.ts";

/**
 * Message actions' words (M29.4, design review 1's H1; the canvas's `Main` message, hover row, reaction picker and
 * "Message actions" sheet). The canvas names its agent; the page names it as the header does.
 */
export const MESSAGE_TEXT = {
  more: "More",
  react: "React",
  reply: "Reply",
  copyResponse: "Copy response",
  moreOptions: "More options",
  reactions: "Reactions",
  reactWith: "React with ",
  moreReactions: "More reactions",
  sheet: "Message actions",
  copy: "Copy",
  replyingTo: "Replying to ",
  yourself: "yourself",
  agent: "your agent",
  dismiss: "Dismiss quote",
  copied: "Copied",
  copyTitle: "Copy message",
  copyField: "Message text",
  done: "Done",
  manual: "This browser did not let the page copy. The message is selected in the field: copy it from there.",
};

/** How long a touch rests on a bubble before its actions open over it (M29.4, Muse's press-and-hold). */
export const HOLD_MS = 500;

export const MESSAGE_CSS = `/* Message actions (M29.4): the canvas's .msg .acts row shows on hover and focus only (and while its picker or menu
   is open); the phone's ⋯ is under each bubble instead, and a touch held on a bubble selects nothing. */
#log > .m .acts { position: relative; display: flex; opacity: 0; transition: opacity var(--qf-dur-none); }
#log > .m.you .acts { flex-direction: row-reverse; }
#log > .m:hover .acts, #log > .m:focus-within .acts, #log > .m .acts.is-open, #log > .m .acts:has([aria-expanded="true"]) { opacity: 1; }
#log > .m .msg-more { width: 28px; height: 28px; color: var(--text-secondary); }
#log > .m .qf-quote { max-width: 85%; }
#log > .m .reaction-pill { margin-top: -10px; padding: 2px 8px; border-radius: 9999px; background: var(--fill-primary); box-shadow: var(--elevation-1); font-size: 14px; }
#log > .m .qf-react { position: absolute; bottom: 32px; left: 0; z-index: 55; }
#log > .m.you .qf-react { left: auto; right: 0; }
.emo { width: 44px; height: 44px; border: 0; border-radius: 50%; background: var(--fill-primary); font-size: 22px; line-height: 1; cursor: pointer; }
.emo.more { display: flex; align-items: center; justify-content: center; color: var(--text-primary); }
.emo:disabled { cursor: default; }
#msg-actions .msg-emos { display: flex; justify-content: space-between; align-items: center; padding: 0 8px; }
#msg-actions .qf-dlg-body { padding: 8px 16px 0; gap: 12px; }
#msg-actions.msg-pop { position: absolute; z-index: 60; width: auto; padding: 12px 0; gap: 0; border-radius: 28px; }
#msg-actions.msg-pop .qf-dlg-body { display: flex; flex-direction: column; padding: 0 12px; gap: 12px; }
#msg-actions.msg-pop .msg-emos { gap: 4px; padding: 0; }
#msg-actions.msg-pop .emo { width: 40px; height: 40px; font-size: 20px; }
#msg-copy-text { width: 100%; min-height: 88px; resize: none; font: 400 15px/22px var(--font-sans); }
#reply-chip { width: 100%; }
#reply-chip .qf-ibtn { width: 20px; height: 20px; }
/* The quote grows the floating composer, so the thread's last message keeps clear of it. */
#chat:has(#reply-chip:not([hidden])) #chat-scroll { padding-bottom: 196px; }
@container qf (max-width: 767px) {
  #chat:has(#reply-chip:not([hidden])) #chat-scroll { padding-bottom: 226px; }
  #log .qf-bubble { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
}
`;

/** The composer's "Replying to" quote, above the staged files in the pill (the canvas's `.qf-quote` with Dismiss). */
export const REPLY_CHIP_MARKUP = `<div id="reply-chip" class="qf-quote" hidden><div class="top"><span id="reply-who"></span><button type="button" id="reply-dismiss" class="qf-ibtn qf-ibtn--glass" aria-label="${MESSAGE_TEXT.dismiss}">${ic("x", "2xs")}</button></div><div id="reply-text" class="q"></div></div>`;

/** The sheet and popover's node, the Copy fallback's dialog and the line that says a copy went through. */
export const MESSAGE_MARKUP = `<p id="msg-status" class="vh" role="status"></p>
  <div id="chat-overlays" hidden>
    <div id="msg-actions" class="qf-dlg qf-dlg--480" role="dialog" aria-label="${MESSAGE_TEXT.sheet}"><span class="qf-grab qf-only-phone"></span><div class="qf-dlg-body">
      <div id="msg-stamp" class="t-foot t-2" style="text-align:center"></div>
      <div id="msg-emos" class="msg-emos"></div>
      <div class="qf-grpcard"><button id="msg-reply" class="qf-srow"><span class="tx">${MESSAGE_TEXT.reply}</span><span class="trail">${ic("reply", "xs")}</span></button><button id="msg-copy-row" class="qf-srow"><span class="tx">${MESSAGE_TEXT.copy}</span><span class="trail">${ic("copy", "xs")}</span></button></div>
    </div></div>
    <div id="msg-copy" class="qf-dlg qf-dlg--416" role="dialog" aria-label="${MESSAGE_TEXT.copyTitle}"><span class="qf-grab qf-only-phone"></span><div class="qf-dlg-head"><h2>${MESSAGE_TEXT.copyTitle}</h2></div><div class="qf-dlg-body"><textarea id="msg-copy-text" class="qf-input qf-input--fill" readonly aria-label="${MESSAGE_TEXT.copyField}"></textarea><p id="msg-copy-note" class="t-foot t-2">${MESSAGE_TEXT.manual}</p><div class="qf-dlg-act"><button id="msg-copy-done" class="qf-btn qf-btn--secondary">${MESSAGE_TEXT.done}</button></div></div></div>
  </div>
  <div id="msgpop-backdrop" class="qf-backdrop" hidden></div>`;

export const MESSAGE_SCRIPT = `// Message actions (M29.4, the canvas's message): a message the history named (its id, \`mid\`) gets the phone's ⋯
// under its bubble, which opens the "Message actions" sheet, and from 768 the hover row (React on the agent's
// messages, Reply, Copy response, More options). A touch held HOLD_MS on a bubble at 390 opens the same actions
// as a popover over the message. A reaction is drawn when the chat answers it; a reply's quote rides on the next send.
const MSG = ${JSON.stringify(MESSAGE_TEXT)}, REACTIONS = ${JSON.stringify(REACTIONS)};
const whoWord = (who) => who === "you" ? MSG.yourself : MSG.agent;
const byMid = (mid) => [...log.children].find((n) => n.dataset && n.dataset.mid === mid);
// The messages a turn drew live, named by the chat when it ended: each to the first unnamed bubble of its side and words.
function nameLive(list) {
  for (const m of list) {
    const d = [...log.children].find((n) => n.bubble && !n.dataset.mid && sideOf(n) === (m.who === "you" ? "user" : "agent") && n.bubble.textContent === m.text);
    if (d) named(d, { mid: m.mid, text: m.text, at: m.at, kind: m.who === "you" ? "you" : "agent" });
  }
}
function named(d, h) {
  d.dataset.mid = h.mid;
  d.msg = { mid: h.mid, text: h.text, at: h.at, who: h.kind === "you" ? "you" : "agent", reaction: null };
  if (h.quote) drawQuote(d, h.quote);
  if (h.reaction) setReaction(d, h.reaction);
  const more = el("button"); more.className = "qf-ibtn qf-only-phone msg-more"; more.setAttribute("aria-label", MSG.more); more.append(icon("dots", "xs"));
  more.onclick = () => openActions(d, "sheet");
  const acts = el("div"); acts.className = "acts qf-hide-phone";
  const row = el("div"); row.className = "qf-msgact";
  const btn = (label, glyph, run) => { const b = el("button"); b.setAttribute("aria-label", label); b.append(icon(glyph, "xs")); b.onclick = run; row.append(b); return b; };
  if (d.msg.who === "agent") btn(MSG.react, "smile", () => picker(d));
  btn(MSG.reply, "reply", () => replyTo(d.msg));
  btn(MSG.copyResponse, "copy", () => copyMsg(d.msg));
  const mo = btn(MSG.moreOptions, "dots", () => {
    const head = el("div", stampOf(d.msg.at)); head.className = "qf-menu-head";
    openMenu(mo, [head, { label: MSG.reply, glyph: "reply", run: () => replyTo(d.msg) }, { label: MSG.copy, glyph: "copy", run: () => copyMsg(d.msg) }]);
  });
  acts.append(row); d.append(more, acts); d.acts = acts;
  holdable(d);
}
// The quote a reply carries, drawn above its bubble (the system's .qf-quote).
function drawQuote(d, q) {
  const box = el("div"); box.className = "qf-quote";
  const top = el("div", MSG.replyingTo + whoWord(q.who)); top.className = "top";
  const t = el("div", q.text); t.className = "q";
  box.append(top, t); d.insertBefore(box, d.bubble);
}
// The person's reaction on a message: the canvas's pill under the bubble, or none.
function setReaction(d, emoji) {
  if (d.msg) d.msg.reaction = emoji || null;
  if (d.pill) { d.pill.remove(); d.pill = null; }
  if (!emoji) return;
  d.pill = el("span", emoji); d.pill.className = "reaction-pill";
  if (d.bubble.nextSibling) d.insertBefore(d.pill, d.bubble.nextSibling); else d.append(d.pill);
}
function react(mid, emoji) {
  if (!conn || !conn.send(JSON.stringify({ type: "react", mid, emoji }))) add("note", NOT_DONE).dataset.code = "DOWN";
}
const emojiButton = (m, ch, label, cls, after) => {
  const b = el("button", ch); if (cls) b.className = cls; b.setAttribute("aria-label", MSG.reactWith + label);
  if (m.reaction === ch) b.setAttribute("aria-pressed", "true");
  b.onclick = () => { after(); react(m.mid, ch); };
  return b;
};
const moreReactions = (cls, tier) => { const b = el("button"); b.className = cls; b.setAttribute("aria-label", MSG.moreReactions); b.disabled = true; b.append(icon("plus", tier)); return b; };
// From 768 React opens the canvas's reaction picker over the row; a pick, React again or Escape closes it.
let picked = null;
function closePicker() { if (!picked) return; picked.box.remove(); picked.d.acts.className = "acts qf-hide-phone"; picked = null; }
function picker(d) {
  const again = picked && picked.d === d;
  closePicker();
  if (again) return;
  const box = el("div"); box.className = "qf-react"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", MSG.reactions);
  for (const [ch, label] of REACTIONS) box.append(emojiButton(d.msg, ch, label, "", closePicker));
  box.append(moreReactions("more", "xs"));
  d.acts.append(box); d.acts.className = "acts qf-hide-phone is-open"; picked = { d, box };
}
// The "Message actions" sheet (the ⋯ at 390), or the same actions as a popover over the message (a held touch).
let actionsFor = null;
const stampOf = (at) => typeof at === "number" ? dayOf(at) + " " + new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
function openActions(d, form) {
  closeActions(); closePicker();
  const n = $("msg-actions"), m = d.msg;
  actionsFor = d;
  $("msg-stamp").textContent = stampOf(m.at);
  const emos = $("msg-emos"); emos.replaceChildren();
  for (const [ch, label] of REACTIONS.slice(0, form === "sheet" ? 5 : 6)) emos.append(emojiButton(m, ch, label, "emo", closeActions));
  emos.append(moreReactions("emo more", "sm"));
  n.dataset.form = form;
  if (form === "sheet") { n.className = "qf-dlg qf-dlg--480"; n.removeAttribute("style"); openDialog(n, { form: "sheet", onClose: () => { actionsFor = null; } }); return; }
  settle(n);
  n.className = "qf-pop msg-pop"; borrow(n, $("app")); n.hidden = false; $("msgpop-backdrop").hidden = false;
  // Anchored to the bubble: under it, or over it when it would not fit below, inside the frame's 16px gutters. The
  // popover's own size is its layout box: its enter animation is scaling it, which its client rect would carry.
  if (d.bubble.getBoundingClientRect && $("app").getBoundingClientRect) {
    const b = d.bubble.getBoundingClientRect(), a = $("app").getBoundingClientRect(), p = { width: n.offsetWidth, height: n.offsetHeight };
    const left = Math.max(16, Math.min(m.who === "you" ? b.right - a.left - p.width : b.left - a.left, a.width - p.width - 16));
    const below = b.bottom - a.top + 8, above = b.top - a.top - 8 - p.height;
    n.setAttribute("style", "left:" + Math.round(left) + "px;top:" + Math.round(below + p.height <= a.height - 16 || above < 16 ? below : above) + "px");
  }
}
function closeActions() {
  const n = $("msg-actions");
  if (isOpen(n)) { closeDialog(n); return; }
  if (!actionsFor) return;
  actionsFor = null;
  exit([n], [n], () => { n.hidden = true; n.removeAttribute("style"); giveBack(n); $("msgpop-backdrop").hidden = true; });
}
$("msgpop-backdrop").onclick = closeActions;
$("msg-reply").onclick = () => { const d = actionsFor; closeActions(); if (d) replyTo(d.msg); };
$("msg-copy-row").onclick = () => { const d = actionsFor; closeActions(); if (d) copyMsg(d.msg); };
if (document.addEventListener) document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePicker(); closeActions(); } });
// Press-and-hold: a touch (never a mouse) resting HOLD_MS on a bubble at 390; lifting, moving or a scroll first
// cancels it. The bubble selects no text on a phone, so the hold shows no callout.
// The finger that held still has to lift: the click its lift makes would land on the popover's backdrop and close it.
let lifting = false;
if (document.addEventListener) {
  document.addEventListener("pointerdown", () => { lifting = false; }, true);
  document.addEventListener("click", (e) => { if (lifting) { lifting = false; e.stopPropagation(); e.preventDefault(); } }, true);
}
function holdable(d) {
  let t = null, x0 = 0, y0 = 0;
  const cancel = () => { if (t !== null) { clearTimeout(t); t = null; } };
  d.bubble.onpointerdown = (e) => {
    if (e.pointerType !== "touch" || device() !== "phone") return;
    cancel(); x0 = e.clientX; y0 = e.clientY;
    t = setTimeout(() => { t = null; openActions(d, "popover"); lifting = true; }, ${HOLD_MS});
  };
  d.bubble.onpointermove = (e) => { if (t !== null && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); };
  d.bubble.onpointerup = cancel; d.bubble.onpointercancel = cancel; d.bubble.onpointerleave = cancel;
  d.bubble.oncontextmenu = (e) => { if (device() === "phone" && e.preventDefault) e.preventDefault(); };
}
// Reply: the composer's "Replying to" quote, dismissible, until the next send carries it.
let replying = null;
function replyTo(m) {
  replying = m;
  $("reply-who").textContent = MSG.replyingTo + whoWord(m.who); $("reply-text").textContent = m.text; $("reply-chip").hidden = false;
  if (input.focus) input.focus();
}
function endReply() { replying = null; $("reply-chip").hidden = true; }
$("reply-dismiss").onclick = endReply;
// Copy: the message's text on the clipboard; a refused clipboard puts it in a read-only field, selected, as Invite does.
async function copyMsg(m) {
  let ok = false;
  try { await navigator.clipboard.writeText(m.text); ok = true; } catch (e) {}
  if (ok) { $("msg-status").textContent = MSG.copied; return; }
  const f = $("msg-copy-text"); f.value = m.text;
  openDialog($("msg-copy"), { form: device() === "phone" ? "sheet" : "center" });
  if (f.focus) f.focus();
  if (f.select) f.select();
}
$("msg-copy-done").onclick = () => closeDialog($("msg-copy"));`;
