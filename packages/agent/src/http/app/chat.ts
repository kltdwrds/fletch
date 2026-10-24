// The chat view of the page (M4.1, M14.2, M17.1, M18.1, M19.1, M20.1; split out of page.ts at M23.1, drawn on
// the Fletch system at M27.3): the thread, the composer and the socket script, with the chats list drawn into the
// shell's list column. The only state the page draws is a dot on the avatar (live or not), the composer's
// placeholder while the socket is not live, a status line while a turn runs and the thinking dots while the
// model reasons; a sentence about the socket is never drawn. The
// chat decides everything: a send is drawn as sent only once the chat answers `turn_started`, a refusal is
// said in words with its code kept on the node, a decision is a request the chat answers, and a socket
// quiet while a turn is shown working is asked for the chat's state (M19.1). Text from the server is
// always set as text, never as markup. A new chat (F8) is the placeholder at `/chats/new`: the composer open with
// no chat connected and nothing on the server; its first send creates the chat, titled from the prompt, connects
// it and sends the message once its history is drawn, in the same view.

import { ANSWER_TIMEOUT_MS, OPEN_TIMEOUT_MS, RECONNECT_DELAYS_MS } from "../reconnect.ts";
import { CHATS_CSS, CHATS_SCRIPT, CHATS_TEXT } from "./chats-list.ts";
import { ic } from "./icons.ts";
import { MESSAGE_CSS, MESSAGE_MARKUP, MESSAGE_SCRIPT, REPLY_CHIP_MARKUP } from "./message-actions.ts";

/** How long a socket may stay quiet while a turn is shown working before the page asks the chat (M19.1). */
export const TURN_CHECK_MS = 8_000;

/** What the page says for a send the chat refused (M18.1); the code stays on the note for programs. */
export const NOT_SENT_TEXT: Record<string, string> = {
  EMPTY_MESSAGE: "Not sent: the message was empty.",
  MEMORY_UNAVAILABLE: "Not sent: your agent could not read your memory just now. Try again in a moment.",
  SECRET_NOT_HELD: "Not sent: a secret in it could not be stored safely, so nothing was kept. Try again.",
  CHAT_NOT_OWNER: "Not sent: this chat is not yours.",
  LOST: "Not sent: the connection dropped before your agent got this. Send it again.",
  DOWN: "Not sent: the chat is not connected. It is reconnecting now; send it again in a moment.",
  ATTACHMENT_NOT_FOUND: "Not sent: an attachment on it is not one of yours any more. Attach it again.",
  ATTACHMENT_ALREADY_SENT: "Not sent: an attachment on it already went with another message. Attach it again.",
  QUOTE_NOT_FOUND: "Not sent: the message it replies to is not in this chat any more. Send it without the quote.",
  OTHER: "Not sent: your agent did not take this message. Send it again; if it keeps happening, tell an admin.",
};

/** A decision the page got no answer for, or one in no words the chat gave (M20.1); never the code. */
export const NOT_DECIDED_TEXT = "Not decided: the answer did not come back. Reload the page to see the card as it stands.";
/** A waiting card that offers no choice says so rather than showing nothing (M20.1, QYVR-173). */
export const NO_CHOICES_TEXT = "This card offers no choice here. Your agent waits for a decision it cannot take; reload the page if this stays.";
/** Anything the page asked for that was not done, said in words; the code stays on the node (M20.1). */
export const NOT_DONE_TEXT = "That did not go through. Try again; if it keeps happening, tell an admin.";

/**
 * The composer's words (M23.2): while the socket is not live it is closed and its placeholder says why in
 * one word; no sentence about the socket is drawn anywhere else.
 */
export const COMPOSER_TEXT = { live: "Message", down: "Reconnecting…" };

/** What the thread says while a turn runs and the model reasons; the reasoning itself is never drawn. */
export const WORKING_TEXT = { background: "Working in the background", thinking: "Thinking…" };

/**
 * The Stop control on the status line (M24.2): shown only while a turn is shown working; a click asks the
 * chat to end the turn at its next step boundary, and the line says it is stopping until the chat answers.
 * What the stopped turn left done is the chat's words, one line each, under the stopped entry.
 */
export const STOP_TEXT = { button: "Stop", stopping: "Stopping…" };

/** The chat's words for a job it just set up (M21.1): the line the harness wrote, and the button that opens the Reminders. */
export const JOB_LINE = /^Set for .+ Say so to change it\.$/;
export const JOB_BUTTON_TEXT = "View scheduled task";

/** The notice chips' labels, with the verdict each posts (M16.2's delivery feedback). */
export const NOTICE_CHIPS: Array<[string, string]> = [["accept", "Useful"], ["reject", "Not now"], ["stop", "Stop these"]];

/** A chat's kind as the list says it, for the kinds that are not the person's own conversations (M23.1). */
export const KIND_TEXT: Record<string, string> = { request: "Request", mail: "Mail" };

/**
 * The attach control (M24.3), in the canvas's shape: a round "+" at the composer's start opens the file
 * picker, and an image pasted into the message is attached too. Each file is uploaded at once and drawn as a
 * chip in the composer above the message; a refusal is the route's own sentence on the chip, with its code kept.
 */
export const ATTACH_TEXT = {
  attach: "Attach",
  uploading: "Uploading…",
  remove: "Remove",
  failed: "Not attached: the upload did not go through. Try again.",
  wait: "Wait for the upload to finish, then send.",
};

/**
 * The chat's own rules (M27.3): what the canvas's `Main` writes in its style block and inline for the thread
 * (`.chatwrap`, `.chatfade`, `.msg`, the composer's wrapper) and what the system has no class for: the thread's
 * entries keep the page's own class names (`m you`, `m agent`, `m note`, `card`, …, which about sixty assertions
 * from M15 on read), so each is the canvas's `.msg` holding the system's MessageBubble; the BUILD-ONLY objects sit on
 * the nearest component: an approval card is the agent bubble as a card (`bubble-agent-card`) with Button rows, a
 * link card and the job line the Card, the notice and attach chips the Chip, Stop a Button, the stopped note a
 * `t-foot` line.
 */
export const CHAT_CSS = `
#chat { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; }
#chat-scroll { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column-reverse; padding: 96px 24px 120px; -webkit-mask-image: linear-gradient(to bottom, transparent 0, transparent 40px, #000 96px); mask-image: linear-gradient(to bottom, transparent 0, transparent 40px, #000 96px); }
#log { width: 100%; max-width: 768px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
#log > .m { position: relative; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
#log > .m.you { align-items: flex-end; }
#log > .m:has(> .qf-bubble--mid), #log > .m:has(> .qf-bubble--last) { margin-top: -8px; }
#log > .m.pending { opacity: .5; }
#log > .m.unsent > .qf-bubble { opacity: .6; }
#log > .m.note, #log > .m.job-line { align-items: center; text-align: center; font-size: 13px; line-height: 18px; color: var(--text-secondary); }
#log > .m.note .effect { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-secondary); }
#log > .m.shimmer { flex-direction: row; align-items: center; gap: 8px; }
#log .qf-bubble { white-space: pre-line; }
.bubble-agent-card { display: flex; flex-direction: column; gap: 8px; width: 100%; min-height: 44px; padding: 11px 15px; border-radius: 22px; background: var(--bubble-agent); color: var(--text-primary); }
.bubble-agent-card h3 { margin: 0; font: 500 16px/22px var(--font-sans); }
.bubble-agent-card .sub, .bubble-agent-card .status { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-secondary); }
.bubble-agent-card .status:empty { display: none; }
.bubble-agent-card .choices { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
#log .qf-prompt-card { max-width: 100%; }
#log .qf-prompt-card h3 { margin: 0; font: 500 16px/22px var(--font-sans); }
#log .qf-prompt-card p { margin: 0; font-size: 14px; line-height: 20px; color: var(--text-secondary); }
#log .qf-prompt-card .act { display: flex; justify-content: flex-end; gap: 10px; }
#log .chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 6px; }
.chips .qf-chip, #attached .qf-chip { border: 0; background: var(--fill-secondary-elevated); color: var(--text-primary); font-family: inherit; }
.chips .qf-chip { cursor: pointer; }
#attached .qf-chip button { border: 0; padding: 0 0 0 4px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
#attached .qf-chip.refused { background: var(--fill-primary); color: var(--text-destructive); }
.composerwrap { flex-direction: column; align-items: center; gap: 8px; }
#f { max-width: 736px; }
#attached { display: flex; flex-wrap: wrap; gap: 6px; }
.composer-row { display: flex; align-items: center; gap: 8px; width: 100%; }
#t { flex: 1; min-width: 0; height: 24px; border: 0; outline: 0; padding: 0; background: transparent; color: var(--text-primary); font: 400 15px/24px var(--font-sans); }
#t::placeholder { color: var(--text-tertiary); }
#send { width: 32px; height: 32px; background: var(--fill-blue); color: #000; }
#status-row { display: flex; align-items: center; gap: 8px; max-width: 736px; width: 100%; padding: 0 8px; }
#status-row #busy { flex: 1; margin: 0; }
#stop { height: 28px; padding: 0 12px; font-size: 13px; }
${MESSAGE_CSS}${CHATS_CSS}@container qf (max-width: 767px) {
  #chat-scroll { padding: 76px 16px 150px; -webkit-mask-image: linear-gradient(to bottom, transparent 0, transparent 24px, #000 76px); mask-image: linear-gradient(to bottom, transparent 0, transparent 24px, #000 76px); }
  .composerwrap { bottom: 52px; padding: 0 12px 8px; }
}
`;

/**
 * The thread and the composer (the canvas's chat: the scrolling column under the floating header, the Composer
 * in its footer band, design review 1's F1: `bg-primary`, the stage's width, the composer's height plus its gutter,
 * so the thread scrolls under it and never shows behind or around the pill; 8 px above the phone's tab bar). The
 * composer stacks (`qf-composer--stack`): 12 px above and below its row at every height, the staged files' chips
 * 8 px above the row. The status line with Stop sits over the pill; the staged files are chips inside it, above
 * the message; Send shows once there is something to send (the canvas draws it only with a draft); dictate is not
 * drawn (M26.2: no control that does nothing).
 */
export const CHAT_MARKUP = `<main id="chat">
  <div id="chat-scroll"><div id="log"></div></div>
  <div class="composerwrap qf-composer-foot">
    <div id="status-row" hidden><span class="qf-dots" aria-hidden="true"><b></b><b></b><b></b></span><p id="busy" class="t-foot t-2" role="status" hidden>${WORKING_TEXT.background}</p><button id="stop" class="qf-btn qf-btn--secondary" hidden>${STOP_TEXT.button}</button></div>
    <form id="f" class="qf-composer qf-composer--stack" aria-label="Message your agent">${REPLY_CHIP_MARKUP}<div id="attached" hidden></div><div class="composer-row"><button type="button" id="attach" class="qf-ibtn qf-ibtn--32" aria-label="${ATTACH_TEXT.attach}" disabled>${ic("plus", "sm")}</button><input type="file" id="file" multiple hidden><input id="t" autocomplete="off" placeholder="${COMPOSER_TEXT.down}" aria-label="Message" disabled><button id="send" class="qf-ibtn" aria-label="Send" hidden disabled>${ic("up", "sm")}</button></div></form>
  </div>
  ${MESSAGE_MARKUP}
</main>`;

export const CHAT_SCRIPT = `const log = $("log"), form = $("f"), input = $("t");
// Each entry is the canvas's .msg under its own class name; a message holds its MessageBubble, every other entry its words.
// A message that arrives while the page is open (\`live\`) fades in (MessageBubble, .qf-msg-new); one drawn from history does not.
function add(cls, text, live) {
  const d = el("div"); d.className = "m " + cls; d.fresh = !!live;
  if (/^(you|agent)\\b/.test(cls)) { d.bubble = el("div", text); d.bubble.className = "qf-bubble"; d.append(d.bubble); }
  else d.textContent = text;
  log.append(d); regroup(); d.scrollIntoView(); return d;
}
// The words of a message, or of any entry: a bubble's text when it has one.
const words = (d) => d.bubble || d;
// Consecutive messages from one side are a run: the first squares its end corner, the last its start, the middle both.
const sideOf = (n) => n && n.bubble ? (/\\byou\\b/.test(n.className) ? "user" : "agent") : null;
function regroup() {
  const list = log.children;
  for (let i = 0; i < list.length; i++) {
    const n = list[i], s = sideOf(n);
    if (!s) continue;
    const before = sideOf(list[i - 1]) === s, after = sideOf(list[i + 1]) === s;
    n.bubble.className = "qf-bubble qf-bubble--" + s + (before && after ? " qf-bubble--mid" : after ? " qf-bubble--first" : before ? " qf-bubble--last" : "") + (n.fresh ? " qf-msg-new" : "");
  }
}
// Streamed text fades in a word group at a time: each delta is its own span in the bubble (MessageBubble, .qf-stream-chunk).
function flow(d, text) {
  const b = words(d); b.dataset.flow = "1";
  const w = el("span", text); w.className = "w qf-stream-chunk"; b.append(w);
}
let reply = null, thinking = null, conn = null, chatId = null, mainId = null, fresh = false;
// The placeholder (F8): \`drafting\` while the view is a chat not yet made, \`draft\` its unsent text while the person is
// elsewhere in this page session (never sent, never stored), and \`held\` the first send, waiting for the made chat's
// history to be drawn before it goes.
let drafting = false, draft = "", held = null;
// Files staged for the next message (M24.3): each uploaded as soon as it is chosen or pasted, and sent by id.
let staged = [];
// The turn the page shows working and how much of its reply text it drew (M19.1); watch is its quiet-socket check.
let current = null, drawn = 0, watch = null;
// Sends the chat has not answered yet, by the page's id for each: drawn faint until turn_started. A send
// said lost on a new socket can still be answered there, if the old socket's frame was being stored.
const pending = new Map(), gone = new Map();
const NOT_SENT = ${JSON.stringify(NOT_SENT_TEXT)};
// Codes are for programs (M20.1, QYVR-174): the person reads these words, and the code stays on the node.
const NOT_DECIDED = ${JSON.stringify(NOT_DECIDED_TEXT)}, NO_CHOICES = ${JSON.stringify(NO_CHOICES_TEXT)}, NOT_DONE = ${JSON.stringify(NOT_DONE_TEXT)};
const COMPOSER = ${JSON.stringify(COMPOSER_TEXT)}, WORKING = ${JSON.stringify(WORKING_TEXT)}, KIND = ${JSON.stringify(KIND_TEXT)}, STOP = ${JSON.stringify(STOP_TEXT)};
const CHATS = ${JSON.stringify(CHATS_TEXT)};
// The turn the person asked to stop (M24.2): the line says so, and Stop waits, until the turn ends or the stop is refused.
let stopping = null;
const JOB_LINE = ${JOB_LINE.toString()}, JOB_BUTTON = ${JSON.stringify(JOB_BUTTON_TEXT)}, CHIPS = ${JSON.stringify(NOTICE_CHIPS)};
// The composer is open only while the socket is live, and says why in its placeholder; the panel's Connected dot
// is the socket's state (panel.ts). Nothing here writes a sentence about the socket.
let sock = "connecting", busyNow = false;
function showState() {
  // The placeholder has no socket: its composer is open for the draft (F8).
  const live = sock === "connected" || drafting;
  input.disabled = !live; $("send").disabled = !live; $("attach").disabled = !live;
  input.placeholder = live ? COMPOSER.live : COMPOSER.down;
  drawSend();
}
// Send shows once there is something to send: words typed or a file staged (the canvas's hasDraft).
function drawSend() { $("send").hidden = !(input.value || "").trim() && !staged.length; }
// An error the page has to say (a list it could not read): the one line under the header, with its code kept.
const lineError = (text, code) => { const n = $("conn"); n.hidden = false; return coded(n, text, code); };
// While a turn is shown working, a socket quiet for TURN_CHECK_MS is asked once more; any frame restarts the wait.
function watchTurn() {
  if (watch !== null) { clearTimeout(watch); watch = null; }
  if (!$("busy").hidden) watch = setTimeout(() => { watch = null; act(true); watchTurn(); }, ${TURN_CHECK_MS});
}
const working = (on) => {
  if (!on) stopping = null;
  const halting = on && stopping !== null && stopping === current;
  $("busy").hidden = !on; $("stop").hidden = !on; $("status-row").hidden = !on; $("stop").disabled = halting;
  if (on) $("busy").textContent = halting ? STOP.stopping : WORKING.background;
  busyNow = on; if (!on) endThinking(); showState(); watchTurn();
};
// Stop asks the chat; nothing is drawn as stopped until the chat says the turn ended (turn_stopped).
$("stop").onclick = () => {
  if (!conn || !current) return;
  if (!conn.send(JSON.stringify({ type: "stop" }))) { add("note", NOT_SENT.DOWN).dataset.code = "DOWN"; return; }
  stopping = current; $("stop").disabled = true; $("busy").textContent = STOP.stopping;
};
// A stopped turn's entry (M24.2), live and from history alike: the chat's words, then one t-foot line per thing it already did.
function stoppedNote(s) {
  const n = add("note stopped", s.text); n.dataset.turn = s.turn || "";
  for (const e of s.effects || []) { const p = el("p", e); p.className = "effect"; n.append(p); }
  return n;
}
// A send the chat took (turn_started, queued, or a duplicate answered with the first): drawn as sent, its bubble handed
// back. One taken before (queued, then starting a turn of its own) is found by the page's id it keeps.
function taken(id) {
  const p = id && (pending.get(id) || gone.get(id));
  if (!p) return (id && [...log.children].find((n) => n.dataset && n.dataset.sid === id)) || null;
  p.node.className = "m you"; p.node.dataset.sid = id; if (p.note) p.note.remove(); pending.delete(id); gone.delete(id); regroup();
  return p.node;
}
// The chat stored the person's message (F10): its bubble is named now, under the mid history draws it by, so a reaction
// on it lands before the turn ends. A bubble named already (queued, now its own turn's) takes the new mid.
function nameSent(d, mid) {
  if (!d || !mid) return;
  if (d.msg) { d.dataset.mid = mid; d.msg.mid = mid; } else named(d, { mid, text: words(d).textContent, at: Date.now(), kind: "you" });
}
function unsent(id, code) {
  const p = pending.get(id); if (!p) return;
  pending.delete(id); p.node.className = "m you unsent";
  const n = add("note", NOT_SENT[code] || NOT_SENT.OTHER); n.dataset.code = code;
  if (code === "LOST") gone.set(id, { node: p.node, note: n });
}
// An approval card, drawn once per id (M20.1): drawn again, live, from a re-sync or from a decision's
// answer, it replaces its earlier drawing in place. Its status line says in words what happened to it;
// its choices show only while it waits, and a click holds them all until the chat answers. A refusal is
// said in the chat's words; the code stays on the line for programs. BUILD-ONLY on the system: the agent's
// bubble as a card (bubble-agent-card), the shield, the title and the sub line, Button rows across the foot.
function card(c, where, chat) {
  const d = el("div"); d.className = "card bubble-agent-card"; d.dataset.card = c.id;
  const mark = el("span"); mark.className = "t-2"; mark.append(icon("shield", "sm")); d.append(mark);
  const title = el("h3", c.title); d.append(title);
  // The harness's words about the card, on one muted line; an action id or the arguments are never drawn.
  if (c.lines.length) { const m = el("p", c.lines.join(" · ")); m.className = "sub"; d.append(m); }
  const row = el("div"); row.className = "choices";
  const status = el("p", c.status || ""); status.className = "status";
  const hold = (on) => { for (const b of row.children) b.disabled = on; };
  // The canvas's order: Deny, then the lasting allows, then Allow once as the primary, last.
  const RANK = { deny: 0, always: 1, period: 2, once: 3 };
  const order = [...c.choices].sort((x, y) => (RANK[x.choice] ?? 9) - (RANK[y.choice] ?? 9));
  for (const ch of order) {
    const b = el("button", ch.label); b.className = "qf-btn " + (ch.choice === "once" ? "qf-btn--primary" : "qf-btn--secondary");
    b.onclick = async () => {
      hold(true); status.textContent = "Deciding…";
      let body = {}, r;
      try { body = await (await post("/chats/" + chat + "/cards/decide", { ids: [c.id], choice: ch.choice })).json(); r = (body.results || [])[0]; } catch (e) {}
      if (r && r.ok && r.card) { card(r.card, d.parentNode || where, chat); refreshCount(); return; }
      hold(false);
      status.textContent = (r && r.text) || body.text || NOT_DECIDED;
      status.dataset.code = (r && r.code) || body.code || "";
    };
    row.append(b);
  }
  if (c.state === "pending") d.append(c.choices.length ? row : el("p", NO_CHOICES));
  d.append(status);
  drawOnce(d, where, "card", c.id);
}
// One drawing per card id in a list: a later one replaces it where it stands (QYVR-175).
function drawOnce(d, where, key, id) {
  const old = [...where.children].find((n) => n.dataset && n.dataset[key] === id);
  if (old) old.replaceWith(d); else { where.append(d); d.scrollIntoView(); }
  if (where === log) regroup();
}
// A link card (M16.2), on the system's Card: words and one link to where the person decides. No button posts anything.
function linkCard(c, where) {
  const d = el("div"); d.className = "card link qf-prompt-card"; d.dataset.link = c.id;
  const t = el("h3", c.title);
  const p = el("p", c.text);
  d.append(t, p);
  const act = el("div"); act.className = "act";
  const a = el("a", "Open"); a.className = "qf-btn qf-btn--secondary"; a.href = c.href; a.target = "_blank"; a.rel = "noopener";
  act.append(a); d.append(act);
  drawOnce(d, where, "link", c.id);
}
// The agent's reasoning (M18.2, M23.2): while it streams, the MessageBubble's streaming dots and one "Thinking…"
// line; once the reply starts, or the turn ends, nothing. The reasoning's text is never drawn; the Ledger keeps it.
function startThinking() {
  if (thinking) return;
  thinking = add("shimmer", "");
  const dots = el("span"); dots.className = "qf-dots"; dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) dots.append(el("b"));
  const t = el("span", WORKING.thinking); t.className = "t-foot t-2";
  thinking.append(dots, t);
}
function endThinking() { if (thinking) { thinking.remove(); thinking = null; regroup(); } }
// The date divider (MessageBubble's) between entries a day or an hour apart (M23.2): a new day under its day, an
// hour's gap inside a day under its time.
let lastAt = null;
function dayOf(at) {
  const d = new Date(at), today = new Date(), y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return CHATS.today;
  if (d.toDateString() === y.toDateString()) return CHATS.yesterday;
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function stamp(at) {
  if (typeof at !== "number") return;
  if (lastAt === null) { lastAt = at; return; }
  const a = new Date(lastAt), b = new Date(at);
  let label = null;
  if (a.toDateString() !== b.toDateString()) label = dayOf(at);
  else if (at - lastAt >= 3600000) label = b.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (label !== null) { const t = add("when", ""); const s = el("div", label); s.className = "qf-stamp"; t.append(s); t.dataset.at = String(at); }
  lastAt = at;
}
// The harness's own line for a job it set up gets a Card with a button to the Reminders where it can be changed.
function jobButton() {
  const row = el("div"); row.className = "m job-line";
  const c = el("div"); c.className = "qf-prompt-card";
  const b = el("button", JOB_BUTTON); b.className = "qf-btn qf-btn--secondary"; b.onclick = () => show("jobs");
  c.append(b); row.append(c); log.append(row); regroup();
}
function frame(e) {
  const f = JSON.parse(e.data);
  // A turn that ended is never shown as working. One whose reply the page drew less of than the chat
  // streamed (frames lost, or a turn joined midway) asks for the history, and stays working until it is drawn.
  if (f.type === "turn_failed" || f.type === "turn_stopped") { current = null; working(false); }
  if (f.type === "turn_done") { const missed = f.turn !== current || drawn !== f.chars; current = null; if (missed) act(true); else working(false); }
  // A check answered on the same socket while the turn the page follows still runs changes nothing drawn (M19.1).
  if (f.type === "history" && !fresh && current && f.running && f.running.turn === current) { watchTurn(); return; }
  if (f.type === "history") {
    // Sent on every open and reconnect: this chat's own earlier turns, which replace what is drawn.
    log.replaceChildren(); reply = thinking = null; lastAt = null;
    // A failed turn is an entry of its own (M17.1), drawn in words; its code stays in the frame.
    // The agent's reasoning (M18.2) is not drawn from history (M23.2); the Ledger keeps it.
    // The cards a turn showed are drawn where they were shown (M18.1), with their choices while pending.
    const stored = new Set();
    for (const h of f.entries) {
      if (h.kind === "thinking") continue;
      stamp(h.at);
      if (h.kind === "stopped") stoppedNote(h);
      else if (h.kind === "card") card(h.card, log, chatId);
      else if (h.kind === "link") linkCard(h.card, log);
      else { const d = add(h.kind === "you" ? "you" : h.kind === "note" || h.kind === "failed" ? "note" : "agent", h.text); if (h.mid) named(d, h); if (h.id) { stored.add(h.id); d.dataset.sid = h.id; } if (h.kind === "agent" && JOB_LINE.test(h.text)) jobButton(); }
    }
    // A send this chat stored is drawn above; on a new socket, one it does not hold never arrived, and is said so.
    // A send still unanswered on the same socket stays drawn, faint, after what the chat holds.
    // A send said not sent stays said, after what the chat holds, until the chat says it took it after all.
    for (const [id, g] of [...gone]) { if (stored.has(id)) gone.delete(id); else log.append(g.node, g.note); }
    for (const [id, p] of [...pending]) {
      if (stored.has(id)) pending.delete(id);
      else if (fresh) { log.append(p.node); unsent(id, "LOST"); }
      else log.append(p.node);
    }
    regroup(); seekDrawn();
    fresh = false;
    // Whether a turn still runs is the chat's answer, so a finished turn is never shown as working. A turn
    // this page joined midway streamed part of its reply before the socket opened: when it ends, the
    // page asks once for the history, which holds the whole of it.
    current = f.running ? f.running.turn : null; drawn = 0; working(!!f.running);
    // The first send from the placeholder goes now that the made chat's history is drawn (F8), under its bubble.
    if (held) { const m = held; held = null; if (dispatch(m)) tookOff(m); }
  }
  else if (f.type === "turn_started") {
    // A turn that goes on after a decision (M20.1) has no text: nothing the person typed starts it.
    nameSent(taken(f.id) || (f.text ? add("you", f.text, true) : null), f.mid);
    reply = null; endThinking(); current = f.turn; drawn = 0; working(true);
  }
  // A send while a turn runs is queued (M24.2): drawn as sent, and the reply that takes it up starts below it.
  else if (f.type === "queued") { nameSent(taken(f.id) || (f.text ? add("you", f.text, true) : null), f.mid); reply = null; }
  else if (f.type === "duplicate") taken(f.id);
  else if (f.type === "turn_stopping") { if (f.turn === current) { stopping = current; $("stop").disabled = true; $("busy").textContent = STOP.stopping; } }
  else if (f.type === "turn_stopped") { endThinking(); reply = null; stoppedNote(f); }
  else if (f.type === "reasoning") { reply = null; startThinking(); }
  else if (f.type === "delta") { endThinking(); reply ??= add("agent", "", true); flow(reply, f.text); if (f.turn === current) drawn += f.text.length; }
  else if (f.type === "message") { endThinking(); add("agent", f.text, true); if (JOB_LINE.test(f.text)) jobButton(); if (f.turn === current) drawn += f.text.length; }
  else if (f.type === "card") { card(f.card, log, chatId); refreshCount(); }
  else if (f.type === "link") linkCard(f.card, log);
  else if (f.type === "notice") feedback(add("note", f.text), f.id);
  // The chat's answer to a reaction (M29.4): drawn only now, on the message it names.
  else if (f.type === "reaction") { const d = byMid(f.mid); if (d) setReaction(d, f.by, f.emoji); }
  // A turn that ended names the messages it drew live, so their actions show without drawing the thread again.
  else if (f.type === "named") nameLive(f.messages);
  else if (f.type === "turn_done") { endThinking(); reply = null; }
  else if (f.type === "turn_failed") { endThinking(); reply = null; add("note", f.text); }
  else if (f.type === "refused" && f.id && pending.has(f.id)) unsent(f.id, f.code);
  else if (f.type === "refused" || f.type === "error") {
    // A refused stop (no send id) lets Stop be asked again while the turn is still shown working.
    if (f.type === "refused" && stopping !== null) { stopping = null; if (busyNow) working(true); }
    add("note", NOT_DONE).dataset.code = f.code || "";
  }
  watchTurn();
}
// The list's row for the open chat wears aria-current; on the placeholder (null) none does.
function currentRow(id) {
  for (const r of $("chats").querySelectorAll("[data-chat]")) { const b = r.children[0]; if (id && r.dataset.chat === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
}
// Leaving the placeholder (F8) keeps its unsent text for the next time, out of the chat's composer; so does leaving a
// first send still held (its chat made, its history not yet drawn): it never goes, and its words are the draft again.
function leaveDraft() {
  if (held) { held = null; drafting = true; }
  if (!drafting) return;
  draft = input.value; input.value = ""; drafting = false; drawSend();
}
// The placeholder (F8): the chat view with no chat connected, the composer open with the draft and focused. Drawn
// again while it is on screen, it only takes focus.
function openDraft() {
  if (!drafting) {
    leaveDraft();
    if (conn) conn.stop();
    endReply(); closeActions(); seeking = null;
    chatId = null; drafting = true; held = null; log.replaceChildren(); reply = thinking = null; lastAt = null; current = null; stopping = null; drawn = 0; pending.clear(); gone.clear(); working(false);
    currentRow(null);
    input.value = draft; drawSend();
  }
  showState();
  if (input.focus) input.focus();
}
function open(id) {
  leaveDraft();
  if (conn) conn.stop();
  endReply(); closeActions();
  // A message sought in another chat (F3) is not sought once the person has moved on.
  if (seeking && seeking.chat !== id) seeking = null;
  chatId = id; log.replaceChildren(); reply = thinking = null; lastAt = null; current = null; stopping = null; drawn = 0; pending.clear(); gone.clear(); held = null; working(false);
  // The address is the router's (F4): opening a chat never writes it, so a chat connected under another view leaves
  // that view's address alone. A fresh open gets the chat from the Person (M17.1).
  currentRow(id);
  connect(id);
}
// The chat's socket, kept connected; the first send (F8) connects the chat it made here without clearing its bubble.
function connect(id) {
  conn = keepConnected(
    () => new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/chats/" + id + "/ws"),
    // The composer is open while the socket is live; its placeholder says why it is not (M23.2).
    (state) => { sock = state; showState(); if (state === "connected") fresh = true; },
    { delays: ${JSON.stringify(RECONNECT_DELAYS_MS)}, openTimeoutMs: ${OPEN_TIMEOUT_MS}, answerTimeoutMs: ${ANSWER_TIMEOUT_MS}, probe: JSON.stringify({ type: "sync" }), onmessage: frame },
  );
}
${CHATS_SCRIPT}const ATTACH = ${JSON.stringify(ATTACH_TEXT)};
function drawStaged() { $("attached").hidden = !$("attached").children.length; drawSend(); }
async function upload(file, pasted) {
  const s = { id: null, name: file.name || "pasted image", ready: false };
  s.chip = el("span", s.name + " · " + ATTACH.uploading); s.chip.className = "qf-chip chip"; $("attached").append(s.chip); staged.push(s); drawStaged();
  const fd = new FormData(); fd.append("file", file, file.name || "pasted.png"); if (pasted) fd.append("pasted", "1");
  let r = null, b = {};
  try { r = await api("/app/attachments", { method: "POST", body: fd }); b = await r.json().catch(() => ({})); } catch (e) {}
  const x = el("button", "×"); x.setAttribute("aria-label", ATTACH.remove);
  x.onclick = () => { staged = staged.filter((o) => o !== s); s.chip.remove(); drawStaged(); };
  if (r && r.ok && b.attachment) { s.id = b.attachment.id; s.name = b.attachment.name; s.ready = true; s.chip.textContent = s.name; s.chip.append(x); return; }
  // Refused or lost: said in the route's words on the chip, with its code; it is not sent with the message.
  staged = staged.filter((o) => o !== s);
  coded(s.chip, (b && b.words) || ATTACH.failed, (b && b.code) || (r ? "HTTP_" + r.status : "DOWN")); s.chip.className = "qf-chip chip refused"; s.chip.append(x);
  drawSend();
}
$("attach").onclick = () => { const f = $("file"); if (typeof f.click === "function") f.click(); };
$("file").onchange = () => { for (const f of [...($("file").files || [])]) upload(f, false); $("file").value = ""; };
input.onpaste = (e) => {
  const files = [...((e.clipboardData && e.clipboardData.items) || [])].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean);
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) upload(f, true);
};
form.onsubmit = async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (staged.some((s) => !s.ready)) { add("note", ATTACH.wait).dataset.code = "UPLOADING"; return; }
  const sent = staged.slice();
  if ((!text && !sent.length) || (!conn && !drafting)) return;
  const id = crypto.randomUUID();
  const shown = [text, ...sent.map((s) => "+ " + s.name)].filter(Boolean).join(" · ");
  // Drawn faint until the chat answers that it stored it; held before the frame goes, since the answer can come at once.
  const node = add("you pending", shown, true);
  const frame = { type: "send", text, id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  if (sent.length) frame.attachments = sent.map((s) => s.id);
  // A reply names the message it quotes; the chat reads the quote's text from its own history (M29.4).
  if (replying) { frame.quote = replying.mid; drawQuote(node, replying); }
  const m = { id, shown, node, frame, sent };
  if (drafting) { await create(m, text); return; }
  if (dispatch(m)) tookOff(m);
};
// What a send that went leaves behind: the composer without its words, its files' chips and its quote. Until it
// goes (a first send held for its chat's history, F8) the words stay, so a send that never goes is never lost.
function tookOff(m) { input.value = ""; staged = staged.filter((s) => !m.sent.includes(s)); for (const s of m.sent) s.chip.remove(); drawStaged(); endReply(); }
// A send goes over the socket under its bubble (drawn again where the history replaced the thread); one the socket
// could not take is said so.
function dispatch(m) {
  if (!m.node.parentNode) { log.append(m.node); regroup(); }
  pending.set(m.id, { text: m.shown, node: m.node });
  if (conn && conn.send(JSON.stringify(m.frame))) return true;
  pending.delete(m.id); m.node.remove(); regroup(); add("note", NOT_SENT.DOWN).dataset.code = "DOWN";
  return false;
}
// The first send from the placeholder (F8): one create, titled from the prompt's own words (the Person keeps its own
// default for a send with no words), then the chat connected under the bubble already drawn, the address replaced
// with the chat's (Back belongs to where the person came from, never here) and the list drawn with its row; the
// message goes once the chat's history is drawn, and the composer keeps its words until then. A refused create keeps
// the draft in the composer and says so.
async function create(m, text) {
  const r = await post("/app/chats", text ? { title: promptTitle(text) } : {});
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.chatId) { m.node.remove(); regroup(); lineError(CHATS.notOpened, b.code || "HTTP_" + r.status); return; }
  drafting = false; draft = ""; chatId = b.chatId; held = m; $("conn").hidden = true;
  connect(chatId);
  go(chatPath(chatId), { replace: true });
  await chats(chatId, true);
}
// The person's actions (M18.1, Q33): coming back to the tab, focus or the network checks the socket
// once; typing reconnects one that is down. Nothing checks it on a timer.
const act = (check) => { if (conn) conn.nudge(check); };
input.oninput = () => { act(false); drawSend(); };
input.onfocus = () => act(true);
if (document.addEventListener) document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") act(true); });
if (typeof addEventListener === "function") { addEventListener("focus", () => act(true)); addEventListener("online", () => act(true)); }
// Feedback on a delivered item carries only its id and a verdict; "stop" stops that kind of message. The chips are Chips.
function feedback(node, id) {
  const row = el("div"); row.className = "chips";
  for (const [verdict, label] of CHIPS) {
    const b = el("button", label); b.className = "qf-chip";
    b.onclick = async () => { const r = await post("/delivery/feedback", { id, verdict }); if (r.ok) row.textContent = "Thanks: " + label.toLowerCase() + "."; else await failedTo(row, "Not recorded", r); };
    row.append(b);
  }
  node.append(row);
}
${MESSAGE_SCRIPT}`;
