// The task drawer (F15): a row of the panel's Activity tab opens one task from `GET /app/activity/<chat>/<turn>`
// (F12 to F14) in its own dialog, the bundle's "Task drawer (activity)" block as F11's specimen draws it. The head is
// the status pill, the task's title and Refresh; the timeline is the main steps on `.qf-tl` in order, each
// `SUBAGENT nn` section under its `.qf-items-head` with its rows' status, verdict and steps, then the summary; the
// detail pane draws the selected step generically from its `StepDetail` (the typed shapes are F16's). The drawer is
// an overlay without an address (decision 6.5): it pushes one entry and back closes it. A running task is the
// snapshot of its opening, with Refresh. Every word is in `ACTIVITY_TEXT`; the title is the record's own string,
// drawn as it came, in the head and the detail pane as in the row; a task that could not be read is said with its code.

import type { StepRecord } from "../../chat/activity-steps.ts";
import type { TaskStatus } from "../../chat/activity.ts";
import { ACTIVITY_TEXT as STATUS_WORDS } from "../../obs/activity-words.ts";
import { type IconName, ic } from "./icons.ts";
import { SCRIPT_GLYPHS } from "./shell.ts";

/** Every word the drawer says, one table. The task's status words are F12's table, cited, not copied. */
export const ACTIVITY_TEXT = {
  status: STATUS_WORDS.status,
  dialog: "Task",
  refresh: "Refresh",
  back: "Back",
  close: "Close",
  steps: "Steps",
  summary: "Summary",
  showMore: "Show more",
  copy: "Copy",
  download: "Download",
  /** `couldNot` says "Could not read this task just now…" with the refusal's code. */
  thisTask: "this task",
  /** The route's own marker step titles itself; this is the words a count is said in. */
  moreSteps: "{n} more steps are not shown",
  subAgent: "Sub-agent",
  section: "SUBAGENT {n}",
  /** A step's state, beside its title in the detail pane. */
  state: { started: "Started, no answer yet", done: "Done", failed: "Failed", waiting: "Waiting on you", refused: "Refused" },
  /** A sub-agent row's status. */
  rowStatus: { queued: "Queued", running: "Running", waiting: "Waiting", done: "Done", failed: "Failed: {code}" },
  verdict: "Verdict: {verdict}",
  noVerdict: "No verdict yet",
  stepsUnavailable: "This sub-agent's own steps cannot be shown yet.",
  result: "Result",
  cutAt: "cut at 20,000 characters",
  finished: "Finished",
  failedWith: "Failed with {code}",
  after: "after {duration}",
  ms: "{n} ms",
  sec: "{n} s",
  min: "{m} min {s} s",
  pick: "Choose a step to see what it did.",
} as const;

/** The pill's tone by the task's status: the four `.qf-status` tones of the bundle. */
export const TASK_TONE: Record<TaskStatus, "done" | "run" | "fail" | "wait"> = { done: "done", running: "run", failed: "fail", waiting: "wait", stopped: "wait" };
/** A step's glyph on the rail, by its kind, from `icons.ts` alone. */
export const STEP_GLYPH: Record<StepRecord["kind"], IconName> = {
  read: "file",
  edit: "pencil",
  write: "file",
  delete: "trash",
  search: "search",
  code: "data",
  todo: "checksq",
  memory: "bulb",
  load: "plug",
  launch: "sparkle",
  close: "x",
  action: "shield",
  observe: "eye",
  other: "dot",
  marker: "dots",
  summary: "list",
  verdict: "checkcircle",
};
/** Every glyph the drawer's script copies is in the page's one glyph set. */
for (const g of Object.values(STEP_GLYPH)) if (!(SCRIPT_GLYPHS as readonly string[]).includes(g)) throw new Error(`SCRIPT_GLYPHS lacks the drawer's glyph "${g}"`);

/** Only what the bundle's task drawer block does not hold: the dialog's column, the head's Refresh, a tappable step, a section's lines. */
export const ACTIVITY_CSS = `
#task-dialog { display: flex; flex-direction: column; }
#task-dialog[hidden] { display: none; }
#task-dialog .qf-task-head .qf-btn { flex-shrink: 0; }
#task-dialog .qf-task { min-height: 0; }
#task-note { padding: 16px 24px 0; }
.qf-task-list .qf-tl li { cursor: pointer; }
.qf-task-list .qf-tl li:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 10px; }
.qf-task-list .qf-items-head { gap: 8px; }
.qf-task-list .qf-items-head span:last-child { margin-left: auto; text-transform: none; font-weight: 500; }
.task-sub { margin: 0 0 8px; color: var(--text-secondary); font: 400 13px/18px var(--font-sans); }
.task-sub-note { margin: 0 0 16px 30px; color: var(--text-secondary); font: 400 13px/18px var(--font-sans); }
.task-caption { margin: 0; color: var(--text-tertiary); font: 500 12px/16px var(--font-sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#task-pane { display: flex; flex-direction: column; gap: 12px; }
#task-pane .task-result[data-code]:not([data-code=""]) { color: var(--status-error); }
`;

/** `#task-dialog`: the head (pill, title, Refresh, the X), a note for a read that failed, then the two panes. */
export const ACTIVITY_MARKUP = `<div id="task-dialog" class="qf-dlg qf-dlg--960" role="dialog" aria-labelledby="task-title" hidden>
  <div class="qf-task-head"><span id="task-state" class="qf-status" hidden></span><h2 id="task-title"></h2><button id="task-refresh" class="qf-btn qf-btn--secondary">${ACTIVITY_TEXT.refresh}</button><button id="task-close" class="qf-ibtn qf-dlg-x" aria-label="${ACTIVITY_TEXT.close}">${ic("x", "xs")}</button></div>
  <p id="task-note" class="panel-note" role="status"></p>
  <div id="task-body" class="qf-task">
    <div id="task-steps" class="qf-task-list" aria-label="${ACTIVITY_TEXT.steps}"></div>
    <div id="task-detail" class="qf-task-detail"><button id="task-back" class="qf-btn qf-btn--ghost qf-task-back">${ic("back", "xs")}${ACTIVITY_TEXT.back}</button><p id="task-detail-task" class="task-caption"></p><div id="task-pane"></div></div>
  </div>
</div>`;

export const ACTIVITY_SCRIPT = `const TASK = ${JSON.stringify(ACTIVITY_TEXT)}, TASK_TONE = ${JSON.stringify(TASK_TONE)}, STEP_GLYPH = ${JSON.stringify(STEP_GLYPH)};
// The drawer's one record: the task it shows (its ref and the route's last answer) and the step selected, by key.
let taskRef = null, taskShown = null, taskSel = null, taskReads = 0;
// The title is the record's own string, the same the list row shows; nothing here formats it.
const titleOf = (t) => t.title;
const fill = (s, o) => s.replace(/\\{(\\w+)\\}/g, (_, k) => (o[k] === undefined || o[k] === null ? "" : String(o[k])));
const durationWords = (ms) => ms < 1000 ? fill(TASK.ms, { n: ms }) : ms < 60000 ? fill(TASK.sec, { n: (ms / 1000).toFixed(1) }) : fill(TASK.min, { m: Math.floor(ms / 60000), s: Math.round((ms % 60000) / 1000) });
// Opens one task from its chat and anchor turn, over the panel as the job dialog does: on a phone it takes the panel
// dialog's place, from 768 px the pinned panel stays beside it. The overlay pushes its one entry.
function openTask(chatId, turnId) {
  taskRef = { chatId, turnId }; taskShown = null; taskSel = null;
  drawTask(null);
  if (isOpen($("panel-dialog"))) closeDialog($("panel-dialog"));
  openDialog($("task-dialog"), { form: "full" });
  return loadTask(taskRef);
}
// Reads the task again and draws it; only the latest read draws. A read that fails is said with its code, and the
// drawing it replaces goes, so an old answer is never shown as current.
async function loadTask(ref) {
  const mine = ++taskReads;
  let t;
  try { t = await getJson("/app/activity/" + encodeURIComponent(ref.chatId) + "/" + encodeURIComponent(ref.turnId)); }
  catch (e) { if (mine === taskReads && taskRef === ref) { drawTask(null); couldNot($("task-note"), TASK.thisTask, e); } return; }
  if (mine !== taskReads || taskRef !== ref) return;
  drawTask(t);
}
function drawTask(t) {
  taskShown = t;
  coded($("task-note"), "", "");
  const pill = $("task-state");
  pill.hidden = !t; pill.replaceChildren();
  $("task-title").textContent = t ? titleOf(t.task) : "";
  $("task-detail-task").textContent = t ? titleOf(t.task) : "";
  $("task-dialog").setAttribute("aria-label", t ? titleOf(t.task) : TASK.dialog);
  if (t) { pill.className = "qf-status qf-status--" + TASK_TONE[t.task.status]; pill.append(el("i"), fill(TASK.status[t.task.status], { code: t.task.code })); }
  drawSteps(t);
  const keep = t && taskSel && stepAt(taskSel) ? taskSel : null;
  // From 768 px the detail pane stands beside the timeline, so a step is always open there; a phone shows one pane.
  selectStep(keep || (t && device() !== "phone" && t.steps.length ? String(t.steps[0].n) : null), !keep);
}
// Every step the drawer drew, by its key: a main step by its n, a child's by its section, row and n.
let taskSteps = new Map();
const stepAt = (key) => taskSteps.get(key);
function stepLi(list, s, key) {
  const li = el("li"); li.dataset.key = key; li.dataset.kind = s.kind; li.dataset.state = s.state;
  li.setAttribute("role", "button"); li.setAttribute("tabindex", "0");
  const rail = el("span"); rail.className = "rail";
  const mark = el("b"); mark.className = s.state === "failed" || s.state === "refused" ? "is-fail" : s.state === "waiting" || s.state === "started" ? "is-wait" : "";
  mark.append(icon(STEP_GLYPH[s.kind] || "dot", "xs")); rail.append(mark, el("i"));
  const tx = el("span"); tx.className = "tx";
  const nm = el("span", s.title); nm.className = "nm"; tx.append(nm);
  const under = [s.code, s.durationMs !== null && s.durationMs !== undefined ? durationWords(s.durationMs) : ""].filter(Boolean).join(" · ");
  if (under) tx.append(el("p", under));
  li.append(rail, tx);
  li.onclick = () => selectStep(key, true);
  li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectStep(key, true); } };
  taskSteps.set(key, s); list.append(li); return li;
}
const tl = (box, nested) => { const ol = el("ol"); ol.className = "qf-tl" + (nested ? " qf-tl--nested" : ""); box.append(ol); return ol; };
// The timeline: the main steps in order, each sub-agent section, then the summary (and the cap's marker before it).
function drawSteps(t) {
  const box = $("task-steps"); box.replaceChildren(); taskSteps = new Map();
  if (!t) return;
  const tail = t.steps.filter((s) => s.kind === "summary");
  const main = tl(box, false);
  for (const s of t.steps) if (s.kind !== "summary") stepLi(main, s, String(s.n));
  for (const sec of t.subagents || []) {
    const lead = sec.rows[0];
    const head = el("div"); head.className = "qf-items-head"; head.dataset.section = sec.n;
    head.append(el("span", fill(TASK.section, { n: sec.n })), el("span", lead ? fill(TASK.rowStatus[lead.status] || lead.status, { code: lead.code }) : ""));
    box.append(head);
    for (const r of sec.rows) {
      const sub = el("p"); sub.className = "task-sub"; sub.dataset.row = r.id;
      sub.append(el("span", [TASK.subAgent + " " + r.id.split(".").slice(1).join("."), r.role, fill(TASK.rowStatus[r.status] || r.status, { code: r.code }), r.verdict ? fill(TASK.verdict, { verdict: r.verdict }) + (r.verdictReason ? ": " + r.verdictReason : "") : TASK.noVerdict].join(" · ")));
      box.append(sub);
      // A child's steps are drawn when the answer carries them; refused, they are said by code, never an empty list.
      if (Array.isArray(r.steps)) { const ol = tl(box, true); for (const s of r.steps) stepLi(ol, s, sec.n + "/" + r.id + "/" + s.n); }
      else { const note = coded(el("p"), TASK.stepsUnavailable, r.steps && r.steps.code); note.className = "task-sub-note"; box.append(note); }
    }
  }
  if (tail.length) { const end = tl(box, false); for (const s of tail) stepLi(end, s, String(s.n)); }
}
// Marks the step and draws it; on a phone a chosen step (\`open\`) shows the detail pane in the list's place.
function selectStep(key, open) {
  taskSel = key && stepAt(key) ? key : null;
  for (const [k, li] of stepLis()) cls(li, "is-sel", k === taskSel);
  drawDetail(taskSel ? stepAt(taskSel) : null);
  cls($("task-body"), "is-detail", !!taskSel && device() === "phone" && (open || hasCls($("task-body"), "is-detail")));
}
// The drawn steps' nodes, by key, walking the timeline (the drawer keeps no second index of nodes).
function stepLis() {
  const out = [];
  const walk = (n) => { for (const c of n.children) { if (c.dataset && c.dataset.key) out.push([c.dataset.key, c]); else walk(c); } };
  walk($("task-steps"));
  return out;
}
// One labelled block as code: its bar says the label, and that the route cut it when it did.
function codeBlock(label, text, cut) {
  const box = el("div"); box.className = "qf-code";
  const bar = el("div"); bar.className = "qf-code-bar";
  const k = el("span", label + (cut ? " · " + TASK.cutAt : "")); k.className = "k"; bar.append(k);
  const src = el("pre", text); src.className = "qf-src";
  box.append(bar, src); return box;
}
// The step's detail, generically from its StepDetail: the title, its state, the prose, each block, the result with
// its code and duration in words, and the lines.
function drawDetail(s) {
  const pane = $("task-pane"); pane.replaceChildren();
  if (!s) { if (taskShown) pane.append(el("p", TASK.pick)); return; }
  const d = s.detail || { prose: "", blocks: [], result: null, lines: [] };
  pane.append(el("h3", s.title));
  pane.append(el("p", [TASK.state[s.state] || s.state, s.code].filter(Boolean).join(" · ")));
  if (d.prose) pane.append(el("p", d.prose));
  for (const b of d.blocks) pane.append(codeBlock(b.label, b.text, b.cut));
  if (d.result) {
    if (d.result.text) pane.append(codeBlock(TASK.result, d.result.text, d.result.cut));
    const when = d.result.durationMs !== null && d.result.durationMs !== undefined ? " " + fill(TASK.after, { duration: durationWords(d.result.durationMs) }) : "";
    const words = (d.result.ok ? TASK.finished : fill(TASK.failedWith, { code: d.result.code })) + when + ".";
    const r = coded(el("p"), words, d.result.ok ? "" : d.result.code); r.className = "task-result"; pane.append(r);
  }
  for (const line of d.lines) pane.append(el("p", line));
}
async function taskRefresh() { if (taskRef) await loadTask(taskRef); }
$("task-refresh").onclick = taskRefresh;
$("task-close").onclick = () => closeDialog($("task-dialog"));
$("task-back").onclick = () => cls($("task-body"), "is-detail", false);`;
