// The agent's profile panel (M23.1's sheet, M23.3's profile, the panel host at M27.2, the tab bodies at M27.4):
// opened from the chat header's avatar, pinned at the end of the chat from 768 px and a bottom sheet on a phone
// (M29.2); the shell moves `#panel` between the two. The host is the system's: the
// avatar, the name, the handle, Connected with its dot, and the four-icon segment Activity, Approvals, Upcoming,
// Identity. Activity is the person's tasks (F12) in day groups of ListRows, each opening its task in the drawer
// (F15, `activity.ts`); Approvals the decided cards with where each went and how it was decided, each opening to its words and, for a standing grant, Revoke (the cards still
// waiting sit above); Upcoming the jobs grouped by cadence, each opening the job dialog with its schedule, its run
// history, Run now, Turn off or on and Remove (asked again on the ConfirmDialog); Identity the name card and the
// SOUL and MEMORY IdentityCards, each opening its file. Devices is Settings' (M27.6) and Compact the chat's menu
// (M27.3). Every row comes from a route whose owning store answers for the signed-in person alone; the page only
// says it in words and decides nothing. A part that could not be read says so.

import { ACTIVITY_TEXT } from "../../obs/activity-words.ts";
import { type IconName, ic } from "./icons.ts";
import { SCRIPT_GLYPHS } from "./shell.ts";

/** The panel's own words, one table, so a test can walk them for a code shown as words (M20.1's rule). */
export const PANEL_TEXT = {
  title: "Your agent",
  badge: "agent",
  tablist: "Your agent's profile",
  connected: "Connected",
  notConnected: "Not connected",
  close: "Close",
  closeDialog: "Close",
  tabs: { activity: "Activity", approvals: "Approvals", upcoming: "Upcoming", identity: "Identity" },
  today: "Today",
  yesterday: "Yesterday",
  activityEmpty: "Nothing yet. What your agent does for you shows up here.",
  reading: "Reading…",
  waitingTitle: "Waiting on you",
  historyTitle: "Approvals history",
  historyEmpty: "No decisions yet.",
  destination: "Destination",
  decision: "Decision",
  revoke: "Revoke",
  revoked: "Revoked. Your agent asks you again next time.",
  wasRevoked: "This permission was revoked.",
  expired: "This permission has expired.",
  grantsUnread: "Could not read whether this permission still stands just now. Reload the page to try again.",
  remindersEmpty: "No reminders yet. Ask your agent to remind you of something.",
  groups: { runonce: "Reminders", daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly", unread: "Not read just now", off: "Off" },
  /** The interval group's title, one per cadence: `{n}` is the job's minutes. */
  every: ["Every minute", "Every {n} minutes"],
  next: "Next",
  noNext: "Not scheduled",
  runs: "Run history",
  noRuns: "No runs yet.",
  /** An earlier definition in the run history (delta 7): `{when}` is the time it was changed. */
  earlier: "Before {when}",
  runNow: "Run now",
  jobOff: "Turn off",
  jobOn: "Turn on",
  jobRemove: "Remove",
  removeTitle: "Remove this job?",
  removeBody: "A removed job cannot be turned back on. Its past runs are kept.",
  jobRemoved: "Removed. Its past runs are kept.",
  done: "done",
  runStarted: "started; what it finds arrives in the chat",
  runFailed: "did not finish",
  runBlocked: "paused by the site",
  runNothing: "nothing new",
  runReported: "reported",
  /** A run that reported but whose notice the chat never took (F31, P5 delta 5). */
  runUndelivered: "reported, but it did not arrive",
  runSending: "reported, not delivered yet",
  runManual: "manual",
  runScheduled: "scheduled",
  /** The name card's words (F40, P14 delta 2): what is true today, with no control and no promise. */
  nameNote: "No name is chosen for your agent, and a chat message cannot name it.",
  soul: "SOUL",
  memory: "MEMORY",
  withCare: "ACCESS WITH CARE",
  changed: "changed",
  soulAbout: "About this file: SOUL.md is who your agent is and how it speaks. Your agent reads it before every answer.",
  fileEmpty: "Nothing here yet.",
  /** `{calls}`, `{tokens}` and `{cost}` are filled by the page from the usage route's totals. */
  call: ["model call", "model calls"],
  token: ["token", "tokens"],
  run: ["run", "runs"],
  free: "$0.00",
  cheap: "less than $0.01",
};

export const PANEL_TABS = ["activity", "approvals", "upcoming", "identity"] as const;
/** The segment indicator's box under tab `i` of the four, as the canvas's \`ptabInd\` places it. */
const segAt = (i: number) => `left:calc(4px + ${i} * (100% - 8px) / ${PANEL_TABS.length});width:calc((100% - 8px) / ${PANEL_TABS.length})`;
/** Each tab's glyph, the canvas's for the panel's tabs (`ptabs`). */
const PANEL_GLYPH: Record<(typeof PANEL_TABS)[number], IconName> = { activity: "list", approvals: "shield", upcoming: "countdown", identity: "finger" };
/** Each tab's body (M27.4). */
export const PANEL_BODY: Record<(typeof PANEL_TABS)[number], string> = { activity: "panel-activity", approvals: "panel-approvals", upcoming: "panel-upcoming", identity: "panel-identity" };

/** An Activity row's glyph by its task's status (F12), beside its words in \`ACTIVITY_TEXT.status\`; a done task with a failed step has its own (F31). */
export const ACTIVITY_GLYPH: Record<keyof typeof ACTIVITY_TEXT.status | "failedSteps", IconName> = { done: "check", running: "pulse", waiting: "bell", failed: "x", stopped: "dot", failedSteps: "flag" };
/** Every glyph the panel's script copies is in the page's one glyph set. */
for (const g of [...Object.values(ACTIVITY_GLYPH), "shield", "bell", "clock", "chevup", "chevdown"])
  if (!(SCRIPT_GLYPHS as readonly string[]).includes(g)) throw new Error(`SCRIPT_GLYPHS lacks the panel's glyph "${g}"`);

/** The panel's rules: the canvas's inline styles for the rows, the job dialog and the file view, on the system's tokens. */
export const PANEL_CSS = `
.panel-body { display: flex; flex-direction: column; gap: 2px; width: 100%; }
.panel-h { margin: 8px 0 4px; font: 500 16px/22px var(--font-sans); }
.panel-note { margin: 0; color: var(--text-secondary); font-size: 14px; line-height: 20px; }
.panel-note:empty { display: none; }
.prow { display: flex; gap: 8px; align-items: flex-start; width: 100%; padding: 8px; border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; }
button.prow { cursor: pointer; }
button.prow:hover { background: var(--fill-secondary); }
.prow-tile { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 10px; background: var(--fill-primary); color: var(--text-secondary); }
.prow-tile--round { border-radius: 50%; }
.prow-main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.prow-under { font-size: 12px; line-height: 16px; color: var(--text-secondary); }
.prow-chev { padding-top: 4px; color: var(--text-quaternary); }
#panel-pin .prow-under, #panel-pin .prow-chev, #panel-dialog .prow-side { display: none; }
.prow-detail { display: flex; flex-direction: column; gap: 8px; margin: 0 8px 8px 56px; padding: 12px; border-radius: 12px; background: var(--fill-primary); font-size: 13px; line-height: 18px; }
.prow-detail dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
.prow-detail dt { color: var(--text-secondary); }
.prow-detail dd, .prow-detail p { margin: 0; }
.prow-detail .qf-btn { align-self: flex-start; }
.is-danger { color: var(--status-error); }
#panel-identity { display: flex; flex-direction: column; gap: 16px; margin-top: 8px; }
#panel-identity[hidden] { display: none; }
#job-dialog h2 { margin: 0; font: 600 16px/22px var(--font-sans); }
#job-dialog .qf-dlg-body { gap: 12px; }
.job-runs-toggle { display: flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; cursor: pointer; font: 500 13px/18px var(--font-sans); color: var(--text-secondary); }
.job-run { display: flex; align-items: center; gap: 8px; height: 28px; }
.job-run span:last-child { font-size: 11px; line-height: 13px; }
.job-run-label { flex: 1; }
.job-earlier { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; font-size: 11px; line-height: 13px; }
.job-earlier p { margin: 0; color: var(--text-secondary); }
.job-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--status-success); }
.job-dot--bad { background: var(--status-error); }
.job-dot--wait { background: var(--fill-tertiary); }
#job-remove { grid-column: 1 / -1; }
#file-dialog .qf-dlg-body p.file-about { font-style: italic; }
`;

const closeBtn = (id: string) => `<button id="${id}" class="qf-ibtn qf-ibtn--glass qf-ibtn--28" aria-label="${PANEL_TEXT.closeDialog}">${ic("x", "xs")}</button>`;
const idCard = (k: "soul" | "memory", tone: string) =>
  `<button id="tile-${k}" class="qf-idcard qf-idcard--${tone}" aria-label="${PANEL_TEXT[k]}"><b>${PANEL_TEXT[k]}</b><span class="k">${PANEL_TEXT.withCare}</span><span id="tile-${k}-date" class="d"></span><span class="h">${ic("heart", "xs")}</span></button>`;

/**
 * The panel host (M27.2, AppShell's profile panel and SegmentedControl): the header row's one control, a
 * right-aligned X (M29.2, design review 1's D1), then the body that scrolls under that row (M29.5, I1): the 100 px
 * avatar, the name, the meta line (the handle, Connected with its dot), the four icon tabs, then the selected tab's
 * body (M27.4). The dialog form draws no hero, as the canvas's phone and tablet panel do not. Edit avatar and name
 * is not drawn: nothing backs it. The job dialog and the file view live here until the overlay helper opens them.
 */
export const PANEL_MARKUP = `<div id="panel">
  <div class="panel-head"><button id="close-sheet" class="qf-ibtn qf-panel-x" aria-label="${PANEL_TEXT.close}">${ic("x", "md")}</button></div>
  <div class="panel-scroll">
    <div class="panel-hero"><span class="qf-avatar agent-av" style="width:100px;height:100px">${ic("sparkle", "lg")}</span></div>
    <div class="panel-hero panel-name">${PANEL_TEXT.title}</div>
    <div class="panel-hero panel-meta"><span id="handle"></span><span id="sheet-sock" class="panel-dot" data-live="false"></span><span id="sheet-live"></span></div>
    <div class="seg2 qf-seg--ind" role="tablist" aria-label="${PANEL_TEXT.tablist}"><span id="panel-seg-ind" class="qf-seg-ind" style="${segAt(0)}"></span>
${PANEL_TABS.map((k) => `      <button id="panel-tab-${k}" class="tab" role="tab" aria-selected="${k === "activity"}" aria-label="${PANEL_TEXT.tabs[k]}" title="${PANEL_TEXT.tabs[k]}">${ic(PANEL_GLYPH[k], "xs")}${k === "approvals" ? `<span id="approvals-count" class="qf-badge" hidden></span>` : ""}</button>`).join("\n")}
    </div>
    <div id="panel-panes" class="panel-body">
      <div id="panel-activity" class="panel-body"></div>
      <div id="panel-approvals" class="panel-body" hidden>
        <p id="approvals-note" class="panel-note"></p>
        <div id="approvals-waiting" hidden><h3 class="panel-h">${PANEL_TEXT.waitingTitle}</h3><div id="approval-list"></div></div>
        <h3 class="panel-h">${PANEL_TEXT.historyTitle}</h3><div id="approval-history" class="panel-body"></div>
      </div>
      <div id="panel-upcoming" class="panel-body" hidden><p id="jobs-note" class="panel-note"></p><div id="job-list" class="panel-body"></div></div>
      <div id="panel-identity" hidden>
        <p id="profile-note" class="panel-note"></p>
        <div class="qf-idname"><h3>${PANEL_TEXT.title}</h3><p id="profile-name-note" class="panel-note">${PANEL_TEXT.nameNote}</p></div>
        <div class="qf-idgrid">${idCard("soul", "soul")}${idCard("memory", "mem")}</div>
      </div>
    </div>
  </div>
  <div id="job-dialog" class="qf-dlg" role="dialog" aria-labelledby="job-title" hidden>
    <div class="qf-dlg-head" style="align-items:center"><div style="flex:1"><span id="job-state" class="qf-chip qf-chip--white"></span></div>${closeBtn("job-back")}</div>
    <div class="qf-dlg-body">
      <div><h2 id="job-title"></h2><p id="job-words"></p><p id="job-about" class="t-cap t-2"></p></div>
      <button id="job-runs-toggle" class="job-runs-toggle" aria-expanded="true" aria-controls="job-runs">${PANEL_TEXT.runs}<span id="job-runs-chev" class="qf-acc-chev">${ic("chevdown", "2xs")}</span></button>
      <div id="job-runs-acc" class="qf-acc"><div id="job-runs"></div></div>
      <div id="job-actions" class="qf-dlg-act--eq"><button id="job-run" class="qf-btn qf-btn--secondary">${PANEL_TEXT.runNow}</button><button id="job-toggle" class="qf-btn qf-btn--secondary"></button><button id="job-remove" class="qf-btn qf-btn--destructive">${PANEL_TEXT.jobRemove}</button></div>
      <p id="job-result" role="status"></p>
    </div>
  </div>
  <div id="file-dialog" class="qf-dlg qf-dlg--600" role="dialog" aria-labelledby="file-title" hidden>
    <div class="qf-dlg-head"><h2 id="file-title"></h2>${closeBtn("file-back")}</div>
    <div class="qf-dlg-body"><p id="file-about" class="file-about" hidden>${PANEL_TEXT.soulAbout}</p><div id="file-lines"></div></div>
  </div>
</div>`;

export const PANEL_SCRIPT = `const PANEL = ${JSON.stringify(PANEL_TEXT)};
const PANEL_TABS = ${JSON.stringify(PANEL_TABS)}, PANEL_BODY = ${JSON.stringify(PANEL_BODY)}, ACTIVITY_GLYPH = ${JSON.stringify(ACTIVITY_GLYPH)}, ACTIVITY_TEXT = ${JSON.stringify(ACTIVITY_TEXT)};
const SEG_AT = ${JSON.stringify(PANEL_TABS.map((_, i) => segAt(i)))};
// Settings' usage card (settings.ts) draws its totals with these and PANEL's usage words.
const plural = (n, w) => n + " " + (n === 1 ? w[0] : w[1]);
const grouped = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
const dollars = (micros) => micros === 0 ? PANEL.free : micros < 10000 ? PANEL.cheap : "$" + (micros / 1000000).toFixed(2);
const clock = (at) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayName = (at, now) => { const d = new Date(at), n = new Date(now); const days = Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000); return days === 0 ? PANEL.today : days === 1 ? PANEL.yesterday : d.toLocaleDateString(); };
const whenOf = (at) => { const d = dayName(at, Date.now()); return d === PANEL.today ? clock(at) : d + ", " + clock(at); };
// How long ago, as the canvas's history says it: minutes, hours, then days.
const ago = (at) => { const m = Math.max(0, Math.round((Date.now() - at) / 60000)); return m < 60 ? m + "m" : m < 1440 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; };
const two = (n) => String(n).padStart(2, "0");
const shortDate = (at) => { const d = new Date(at); return two(d.getMonth() + 1) + "." + two(d.getDate()) + "." + two(d.getFullYear() % 100); };
// The panel's dot is the socket's state, the page's one connection status (M29.2: small avatars carry no dot): the
// chat's own state function is wrapped, never replaced.
function drawPanelLive() {
  const live = sock === "connected";
  // The dot is the state (M23.2); the word is said only while it is true, and a down socket is never described.
  $("sheet-sock").dataset.live = String(live); $("sheet-sock").setAttribute("aria-label", live ? PANEL.connected : PANEL.notConnected);
  $("sheet-live").textContent = live ? PANEL.connected : "";
}
{ const base = showState; showState = function () { base(); drawPanelLive(); }; }
let panelNow = "activity", panelSwitches = 0;
// The tabs are the system's SegmentedControl: the one indicator slides to the picked tab, and the panes cross-fade,
// alternating .qf-fade-a and .qf-fade-b so the fade runs again on every switch (none under reduced motion).
function panelTab(which) {
  if (which !== panelNow) { panelSwitches++; const p = $("panel-panes"); cls(p, "qf-fade-a", panelSwitches % 2 === 1); cls(p, "qf-fade-b", panelSwitches % 2 === 0); }
  panelNow = which;
  $("panel-seg-ind").setAttribute("style", SEG_AT[PANEL_TABS.indexOf(which)]);
  for (const k of PANEL_TABS) { $("panel-tab-" + k).setAttribute("aria-selected", String(k === which)); $(PANEL_BODY[k]).hidden = k !== which; }
  if (PANEL_LOAD[which]) PANEL_LOAD[which]();
}
for (const k of PANEL_TABS) $("panel-tab-" + k).onclick = () => panelTab(k);
// A ListRow of the panel: the 40 px tile with its glyph, the title, the description, and the time beside it (pinned)
// or under it (the dialog). \`o.tap\` makes it a button, \`o.round\` the round tile of Upcoming, \`o.chev\` the
// collapsible's chevron, \`o.danger\` says the description in red (an approval that was allowed and did not run).
function prow(parent, o) {
  const r = el(o.tap ? "button" : "div"); r.className = "prow";
  const tile = el("span"); tile.className = "prow-tile" + (o.round ? " prow-tile--round" : ""); tile.append(icon(o.glyph, "sm"));
  const main = el("span"); main.className = "prow-main";
  const t = el("span", o.title); t.className = "t-sub-m";
  const d = el("span", o.desc); d.className = "t-foot " + (o.danger ? "is-danger" : "t-2");
  main.append(t, d);
  if (o.time) { const u = el("span", o.time); u.className = "prow-under"; main.append(u); }
  r.append(tile, main);
  if (o.time) { const s = el("span", o.time); s.className = "t-cap t-2 prow-side"; r.append(s); }
  if (o.chev) { const c = el("span"); c.className = "prow-chev"; c.append(icon("chevdown", "2xs")); r.append(c); }
  if (o.tap) r.onclick = o.tap;
  parent.append(r); return r;
}
const heading = (parent, text) => { const h = el("h3", text); h.className = "panel-h"; parent.append(h); return h; };
const say = (parent, text) => { const p = el("p", text); p.className = "panel-note"; parent.append(p); return p; };
// A tab opened twice quickly reads twice; only the latest read draws, so no row is drawn twice.
const latest = (fn) => { let n = 0; return () => { const mine = ++n; return fn(() => mine === n); }; };
const sheetActivity = latest(async (current) => {
  const box = $("panel-activity"); box.replaceChildren(); say(box, PANEL.reading);
  let a;
  try { a = await getJson("/app/activity"); } catch (e) { if (current()) { box.replaceChildren(); box.append(couldNot(el("p"), "your activity", e)); } return; }
  if (!current()) return;
  box.replaceChildren();
  // A chat that could not be read is said with its code, so the tab is never empty for want of a read (F12).
  for (const u of a.unread || []) box.append(couldNot(el("p"), "\u201c" + u.title + "\u201d", u));
  for (const u of a.jobsUnread || []) box.append(couldNot(el("p"), "a job", u));
  const runs = a.runs || [];
  if (!a.tasks.length && !runs.length) { if (!(a.unread || []).length && !(a.jobsUnread || []).length) say(box, PANEL.activityEmpty); return; }
  const now = Date.now(); let day = null;
  // Tasks and job runs in one list, newest first: a run that fired leaves a row too (F31, B-P5-09).
  const rows = [...a.tasks.map((t) => ({ at: t.startedAt, t })), ...runs.map((r) => ({ at: r.at, r }))].sort((x, y) => y.at - x.at);
  for (const { at, t, r: run } of rows) {
    const d = dayName(at, now);
    if (d !== day) { day = d; heading(box, d); }
    if (run) {
      const r = prow(box, { glyph: "clock", round: true, title: run.title, desc: runLabel(run), time: clock(run.at), danger: run.word === "runFailed" || run.word === "runUndelivered", tap: () => openJobById(run.jobId) });
      r.dataset.run = run.runId; continue;
    }
    // A row opens its task in the drawer (F15, activity.ts) by its chat and anchor turn.
    // The row says the record's own words (its status and failed-step count, F31), with the failed-count mark for a task that finished with a failed step.
    const r = prow(box, { glyph: t.failed && t.status === "done" ? ACTIVITY_GLYPH.failedSteps : ACTIVITY_GLYPH[t.status], title: t.title, desc: t.words, time: clock(t.startedAt), danger: t.status === "failed", tap: () => openTask(t.chatId, t.id) });
    r.dataset.task = t.id;
  }
});
// One decided approval: the row opens to where it went, how it was decided, its words, and Revoke while the standing
// grant it signed is in force. Whether it is in force is the person's grant store's answer (\`grants\`); a list that
// could not be read offers no Revoke and says so.
function approvalRow(hist, c, grants) {
  const wrap = el("div"); wrap.dataset.card = c.id;
  const r = prow(wrap, { glyph: "shield", title: c.title, desc: c.status, time: ago(c.at), danger: c.state === "failed", chev: true, tap: () => { const open = detail.hidden; detail.hidden = !open; r.setAttribute("aria-expanded", String(open)); } });
  r.setAttribute("aria-expanded", "false");
  const detail = el("div"); detail.className = "prow-detail"; detail.hidden = true;
  const dl = el("dl");
  for (const [k, v] of [[PANEL.destination, c.dest], [PANEL.decision, c.status]]) dl.append(el("dt", k), el("dd", v));
  detail.append(dl);
  for (const line of c.lines) detail.append(el("p", line));
  if (c.standing) {
    const out = el("p"), g = grants ? grants.find((x) => x.id === c.standing) : undefined;
    if (!grants) coded(out, PANEL.grantsUnread, "GRANTS_UNREAD");
    else if (g && g.revoked_at) out.textContent = PANEL.wasRevoked;
    else if (g && g.expires_at && g.expires_at <= Date.now()) out.textContent = PANEL.expired;
    else if (g) {
      const b = el("button", PANEL.revoke); b.className = "qf-btn qf-btn--destructive"; b.dataset.revoke = g.id;
      b.onclick = async () => {
        b.disabled = true;
        const res = await post("/api/grants/" + g.id + "/revoke", {});
        if (res.ok) { b.remove(); coded(out, PANEL.revoked, ""); } else { b.disabled = false; await failedTo(out, PANEL.revoke, res); }
      };
      detail.append(b);
    }
    detail.append(out);
  }
  wrap.append(detail); hist.append(wrap);
}
const sheetApprovals = latest(async (current) => {
  const list = $("approval-list"), hist = $("approval-history"); list.replaceChildren(); hist.replaceChildren();
  coded($("approvals-note"), PANEL.reading, "");
  let a, grants = null;
  try { a = await getJson("/app/approvals"); } catch (e) { if (current()) { setCount(null); couldNot($("approvals-note"), "your approvals", e); } return; }
  try { grants = (await getJson("/api/grants")).grants || null; } catch (e) { grants = null; }
  if (!current()) return;
  setCount(a.cards.length);
  coded($("approvals-note"), a.unread.length ? a.unread.length + " chat(s) could not be read just now; reload the page to try again." : "", a.unread.map((u) => u.code).join(","));
  // The cards still waiting keep their buttons, above the history (the chat's own card drawing).
  $("approvals-waiting").hidden = !a.cards.length;
  for (const c of a.cards) { const at = el("p", "In " + c.chatTitle + ":"); at.className = "t-cap t-2"; list.append(at); card(c, list, c.chatId); }
  if (!(a.decided || []).length) say(hist, PANEL.historyEmpty);
  for (const c of a.decided || []) approvalRow(hist, c, grants);
});
// The cadence groups in the canvas's order; an interval job is grouped by its own minutes in the Daily group's form,
// and monthly and yearly follow Weekly in the same form, so every listed job is drawn somewhere.
const JOB_KINDS = ["runonce", "daily", "interval", "weekly", "monthly", "yearly"];
const everyOf = (job) => (job.job && job.job.def && job.job.def.timing && job.job.def.timing.schedule.every) || 0;
const groupOf = (job) => !job.ok || !JOB_KINDS.includes(job.kind) ? "unread" : job.listed === "off" ? "off" : job.kind === "interval" ? "interval:" + everyOf(job) : job.kind;
const groupTitle = (g) => g.startsWith("interval:") ? (+g.slice(9) === 1 ? PANEL.every[0] : PANEL.every[1].replace("{n}", g.slice(9))) : PANEL.groups[g];
const jobLine = (job) => (job.job ? job.job.cadence : "") + (job.words && job.words !== "on" ? " · " + job.words : "");
const sheetReminders = latest(async (current) => {
  const list = $("job-list"); list.replaceChildren(); $("jobs-note").textContent = PANEL.reading;
  let j;
  try { j = await getJson("/app/jobs"); } catch (e) { if (current()) couldNot($("jobs-note"), "your jobs", e); return; }
  if (!current()) return;
  // A spent or removed job is not upcoming; a paused one is listed under Off, where its dialog turns it on again.
  const shown = j.jobs.filter((x) => !x.ok || x.listed !== "none");
  $("jobs-note").textContent = shown.length ? "" : PANEL.remindersEmpty;
  if (!shown.length) return;
  const order = (g) => { const k = g.split(":")[0]; return (k === "unread" ? 99 : k === "off" ? 98 : JOB_KINDS.indexOf(k)) * 1e6 + (+g.split(":")[1] || 0); };
  const groups = [...new Set(shown.map(groupOf))].sort((x, y) => order(x) - order(y));
  for (const g of groups) {
    heading(list, groupTitle(g));
    for (const job of shown.filter((x) => groupOf(x) === g)) {
      if (!job.ok) { const r = prow(list, { glyph: "clock", round: true, title: job.id, desc: "" }); couldNot(r.children[1].children[1], "this job", job); continue; }
      const r = prow(list, { glyph: job.kind === "runonce" ? "bell" : "clock", round: true, title: job.title || job.id, desc: jobLine(job), tap: () => openJob(job) });
      r.dataset.job = job.id;
    }
  }
});
// The job dialog (Dialog; a full-width sheet on a phone): the state chip, the title, the schedule and next run, the
// run history, and the actions the job's own object allows. A result stays said in the dialog (QYVR-224).
// A run's line, the same on its Activity row and in the Run history: its word from the route (\`runWord\`), by its
// delivery for a run that reported (F31), else how far it went; then manual or scheduled.
const RUN_SIGNAL = { failed: PANEL.runFailed, blocked: PANEL.runBlocked, nothing_to_report: PANEL.runNothing, notify: PANEL.runReported };
const runLabel = (r) => ((r.word && PANEL[r.word]) || RUN_PHASE[r.phase] || r.phase) + " · " + (r.manual ? PANEL.runManual : PANEL.runScheduled);
// Opens a job's dialog from its Activity row, read fresh from the job route.
async function openJobById(id) {
  const j = await getJson("/app/jobs").catch(() => null);
  const job = j && j.jobs.find((x) => x.id === id && x.ok);
  if (job) openJob(job);
}
let jobShown = null;
function drawJob(job) {
  jobShown = job;
  const st = job.job ? job.job.status : "", on = st === "active" || st === "blocked";
  // The chip is the status in the one table's words (M20.1), as the route sends them.
  $("job-state").textContent = (job.words || "").replace(/^./, (c) => c.toUpperCase());
  $("job-title").textContent = job.title || job.id;
  $("job-words").textContent = jobLine(job) + (job.nextRun ? " · " + PANEL.next + ": " + whenOf(job.nextRun) : on ? "" : " · " + PANEL.noNext);
  // The job's instructions are its owner's words, drawn as text and never as a control (T-P7-04).
  $("job-about").textContent = (job.job && job.job.def && job.job.def.instructions) || "";
  $("job-run").hidden = !on;
  $("job-toggle").textContent = on ? PANEL.jobOff : PANEL.jobOn; $("job-toggle").dataset.action = on ? "disable" : "enable";
  const runs = $("job-runs"); runs.replaceChildren();
  if (!job.runs.length) say(runs, PANEL.noRuns);
  // A finished run is labelled by how it ended; its code stays on the line.
  for (const r of job.runs) {
    const row = el("div"); row.className = "job-run"; if (r.code) row.dataset.code = r.code;
    const dot = el("span"); dot.className = "job-dot" + (r.signal === "failed" || r.signal === "blocked" ? " job-dot--bad" : r.phase === "done" ? "" : " job-dot--wait");
    const label = el("span", runLabel(r)); label.className = "t-cap t-2 job-run-label";
    row.append(dot, label, el("span", whenOf(r.scheduledFor))); runs.append(row);
  }
  // The definitions it had before each change in place (delta 7), newest first, as text: the cadence and the instructions.
  for (const h of ((job.job && job.job.history) || []).slice().reverse()) {
    const row = el("div"); row.className = "job-earlier";
    row.append(el("span", PANEL.earlier.replace("{when}", whenOf(h.until))), el("p", (h.cadence || "") + " · " + ((h.def && h.def.instructions) || "")));
    runs.append(row);
  }
}
function openJob(job) {
  coded($("job-result"), "", ""); $("job-actions").hidden = false;
  drawJob(job);
  // As the canvas does, the job dialog takes the panel's dialog's place; the pinned panel stays beside it.
  if (isOpen($("panel-dialog"))) closeDialog($("panel-dialog"));
  openDialog($("job-dialog"), { form: "full" });
}
// After an action the dialog redraws the job from the route and the list behind it reads again; the result stays.
async function jobAgain(id) {
  sheetReminders();
  const j = await getJson("/app/jobs").catch(() => null);
  const fresh = j && j.jobs.find((x) => x.id === id && x.ok);
  if (fresh && jobShown && jobShown.id === id) drawJob(fresh);
}
async function jobAct(action, label) {
  const id = jobShown.id, out = $("job-result");
  const r = await post("/app/jobs/" + id, { action });
  if (!r.ok) { await failedTo(out, label, r); return; }
  // A run is said as far as it went: one that ended at once by how it ended (a failed or blocked one is never
  // "done"), one still going as started.
  const ran = action === "run" ? await r.json().catch(() => ({})) : null;
  if (!ran) coded(out, label + ": " + PANEL.done + ".", "");
  else coded(out, label + ": " + (RUN_SIGNAL[ran.signal] || PANEL.runStarted) + ".", ran.signal === "failed" || ran.signal === "blocked" ? ran.code : "");
  await jobAgain(id);
}
$("job-run").onclick = () => jobAct("run", PANEL.runNow);
$("job-toggle").onclick = () => jobAct($("job-toggle").dataset.action, $("job-toggle").textContent);
// Remove is asked again on the ConfirmDialog, since a removed job cannot be turned back on; it archives the job and keeps its runs.
$("job-remove").onclick = () => confirmDialog(PANEL.removeTitle, PANEL.removeBody, { label: PANEL.jobRemove, run: async () => {
  const id = jobShown.id, out = $("job-result");
  const r = await post("/app/jobs/" + id, { action: "remove" });
  if (!r.ok) { await failedTo(out, PANEL.jobRemove, r); return; }
  coded(out, PANEL.jobRemoved, ""); $("job-actions").hidden = true;
  sheetReminders();
} });
$("job-back").onclick = () => closeDialog($("job-dialog"));
// Run history is the system's disclosure (AppShell, Accordion): the body stays mounted, and .is-closed on the body and
// the chevron runs the 200 ms collapse and the chevron's turn (none under reduced motion).
function drawRunsToggle(open) {
  $("job-runs-toggle").setAttribute("aria-expanded", String(open));
  cls($("job-runs-acc"), "is-closed", !open); cls($("job-runs-chev"), "is-closed", !open);
}
$("job-runs-toggle").onclick = () => drawRunsToggle(hasCls($("job-runs-acc"), "is-closed"));
drawRunsToggle(true);
// A file of the agent's own (SOUL.md, MEMORY.md) in the panel's viewer, read-only, with its words as lines.
function openFile(name, f, about) {
  $("file-title").textContent = name; $("file-about").hidden = !about;
  const box = $("file-lines"); box.replaceChildren();
  if (!f.ok) box.append(couldNot(el("p"), name, f));
  else if (!f.lines.length) box.append(el("p", PANEL.fileEmpty));
  else for (const x of f.lines) box.append(el("p", x.text));
  openDialog($("file-dialog"), { form: "full" });
}
$("file-back").onclick = () => closeDialog($("file-dialog"));
async function sheetProfile() {
  const note = $("profile-note"); coded(note, PANEL.reading, "");
  let p;
  try { p = await getJson("/app/profile"); } catch (e) { couldNot(note, "your agent's profile", e); return; }
  coded(note, "", "");
  for (const [k, f, name, file] of [["soul", p.soul, PANEL.soul, "SOUL.md"], ["memory", p.memory, PANEL.memory, "MEMORY.md"]]) {
    // The card's foot holds the short date (IdentityCards); its label says what the date is.
    const on = f.ok && f.updatedAt ? shortDate(f.updatedAt) : "";
    $("tile-" + k + "-date").textContent = on;
    $("tile-" + k).setAttribute("aria-label", on ? name + ", " + PANEL.changed + " " + on : name);
    $("tile-" + k).onclick = () => openFile(file, f, k === "soul");
  }
}
const PANEL_LOAD = { activity: sheetActivity, approvals: sheetApprovals, upcoming: sheetReminders, identity: sheetProfile };
// Read each time the panel opens, so it never shows what it showed before.
async function loadPanel(tab) {
  drawPanelLive();
  getJson("/me").then((me) => { $("handle").textContent = me.person + "/agent"; }, (e) => couldNot($("handle"), "who you are", e));
  panelTab(tab || panelNow);
}`;
