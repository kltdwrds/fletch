// The Goals and Feed routes (M23.1's pages, drawn on the Fletch system at M27.7: the canvas's PageHeader sits in
// the shell, so a route here is the page body: ListRow's group headers and goal rows with the Checkbox, the error
// Card, and the digest day on a Card). No store holds goals or digests yet: their engine parts fill them. Until then
// each route draws what it has, which is nothing, in words; the rows are drawn from the shapes below by the
// shipped script, so the part that brings the data hands `goalsLoad` and `feedDraw` an answer and changes nothing
// here. A view decides nothing: a row says what the answer says, and nothing on a row acts yet (no checkbox,
// menu or Generate does anything, so none is live). The Goals options and row menus, goal detail, the feed prompt
// card and its posts are the engine parts' and are not drawn.
import { ic } from "./icons.ts";

/** One goal row: a task with a checkbox, its line under the title, and the pill when the next step is the person's. */
export interface GoalItem {
  id: string;
  title: string;
  sub?: string;
  /** The next step is the person's: the Waiting on you pill. */
  waiting?: boolean;
  done?: boolean;
}

/** What the Goals route draws: the Tracking list and the Goals list, in the order the engine keeps them. */
export interface GoalsAnswer {
  tracking: GoalItem[];
  goals: GoalItem[];
}

/** One thing a digest says the agent did, by the tile it takes. */
export interface DigestRow {
  kind: "waiting" | "web" | "agent" | "done";
  title: string;
  sub?: string;
}

/** One day of the Feed: the agent's summary, the count line and the rows. `written` is the time, said in words. */
export interface DigestDay {
  day: string;
  written: string;
  summary: string;
  stat: string;
  rows: DigestRow[];
}

export const GOALS_TEXT = {
  title: "Goals",
  tracking: "Tracking",
  goals: "Goals",
  trackingEmpty: "Nothing tracked yet.",
  goalsEmpty: "No goals yet. Tell your agent what you're working towards.",
  waiting: "Waiting on you",
  errorTitle: "Couldn't load goals right now",
  errorBody: "Your agent could not read your goals just now.",
  retry: "Try again",
  invalid: "The answer did not hold both lists.",
};

export const FEED_TEXT = {
  title: "Feed",
  empty: "Your agent writes a digest at the end of each day.",
  written: "Written at {time}",
};

/** The glyph each digest row takes, and the tile class that colours it: warn for what waits on the person, web, the agent's own, done. */
export const DIGEST_TILES: Record<DigestRow["kind"], { mod: string; glyph: string }> = {
  waiting: { mod: "digest-tile--warn", glyph: "shield" },
  web: { mod: "digest-tile--web", glyph: "globe" },
  agent: { mod: "digest-tile--agent", glyph: "sparkle" },
  done: { mod: "digest-tile--done", glyph: "check" },
};

const groupHead = (key: "tracking" | "goals", blue: boolean) =>
  `<div class="qf-dotlbl${blue ? " qf-dotlbl--blue" : ""}"><span class="halo"></span><h2 id="goals-${key}-title">${GOALS_TEXT[key]}</h2></div>`;

/** The two routes' pages: the PageHeader is the shell's, so each is the system's page column at 768 and its body. */
export const GOALS_FEED_MARKUP = `<main id="feed" hidden><div class="qf-page qf-page--768"><div class="qf-page-in feed-page">
  <div id="feed-days" class="feed-days"></div>
  <p id="feed-note" class="t-sub t-2 feed-note"></p>
</div></div></main>
<main id="goals" hidden><div class="qf-page qf-page--768"><div class="qf-page-in goals-page">
  <div id="goals-lists" class="goals-lists">
    <section aria-labelledby="goals-tracking-title">${groupHead("tracking", false)}<div id="goals-tracking"></div></section>
    <section aria-labelledby="goals-goals-title">${groupHead("goals", true)}<div id="goals-goals"></div></section>
  </div>
  <div id="goals-error" class="qf-error-card" role="alert" hidden>
    <div class="qf-err-h">${ic("flag", "sm")}<span>${GOALS_TEXT.errorTitle}</span></div>
    <p id="goals-error-body" class="t-sub t-2 goals-error-body"></p>
    <button id="goals-retry" class="qf-btn qf-btn--primary qf-btn--icon-start">${ic("restore", "xs")}${GOALS_TEXT.retry}</button>
  </div>
</div></div></main>`;

/** The routes' placing: the system's page column carries the rest; these are the rows' own parts. */
export const GOALS_FEED_CSS = `
.goals-page { gap: 8px; }
.goals-lists { display: flex; flex-direction: column; }
.goals-error-body { margin: 0; }
.empty-line { margin: 0; padding: 0 0 8px; }
.qf-goalrow { cursor: default; }
.qf-goalrow .qf-check { margin: 2px; cursor: default; }
.qf-goalrow .qf-check:disabled { opacity: 1; }
.qf-goalrow.is-done h3 { text-decoration: line-through; }
.qf-goalrow.is-done .goal-text { opacity: 0.5; }
.goal-text { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.goal-waiting { align-self: flex-start; margin-top: 6px; background: var(--status-attention-tint); color: var(--text-warning); }
.feed-page { gap: 16px; }
.feed-days { display: flex; flex-direction: column; gap: 16px; }
.feed-days:empty, .feed-note:empty { display: none; }
.feed-note { margin: 0; text-align: center; }
.digest-day { max-width: none; }
.digest-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.digest-head h2 { margin: 0; font: 500 18px/26px var(--font-sans); min-width: 0; }
.digest-head .digest-time { flex-shrink: 0; }
.digest-summary { margin: 0; white-space: pre-line; }
.digest-rule { height: 1px; background: var(--fill-divider); }
.digest-row { display: flex; gap: 12px; align-items: flex-start; }
.digest-tile { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 24px; height: 24px; border-radius: var(--radius-8); background: var(--fill-secondary-elevated); color: var(--text-primary); }
.digest-tile--warn { background: var(--status-attention-tint); color: var(--text-warning); }
.digest-tile--web { background: var(--status-working-tint); color: var(--status-working); }
.digest-tile--done { background: var(--status-success-tint); color: var(--status-success); }
.digest-body { min-width: 0; flex: 1; }
.digest-body .digest-title { font-weight: 500; }
`;

export const GOALS_FEED_SCRIPT = `const GOALS = ${JSON.stringify(GOALS_TEXT)}, FEED = ${JSON.stringify(FEED_TEXT)}, DIGEST_TILES = ${JSON.stringify(DIGEST_TILES)};
// A goal row (ListRow's goal row): the Checkbox, the title on one line, the line under it clamped to two, and the pill when
// the next step is the person's. Nothing on it acts yet, so the checkbox is not live. Its words are text, never markup.
function goalRow(g) {
  const row = el("div"); row.className = "qf-goalrow" + (g.done ? " is-done" : ""); row.dataset.goal = g.id;
  const c = el("input"); c.type = "checkbox"; c.className = "qf-check"; c.checked = !!g.done; c.disabled = true; c.setAttribute("aria-label", g.title);
  const body = el("div"); body.className = "goal-text"; body.append(el("h3", g.title));
  if (g.sub) body.append(el("p", g.sub));
  if (g.waiting) { const pill = el("span", GOALS.waiting); pill.className = "qf-chip goal-waiting"; body.append(pill); }
  row.append(c, body);
  return row;
}
function goalList(node, items, empty) {
  node.replaceChildren();
  if (!items.length) { const p = el("p", empty); p.className = "t-sub t-2 empty-line"; node.append(p); return; }
  for (const g of items) node.append(goalRow(g));
}
const goalsError = (code, reason) => Object.assign(new Error(reason), { code });
// Both lists or neither: an answer that does not hold them is a failure with its reason, never two empty groups.
function goalsDraw(answer) {
  if (!answer || !Array.isArray(answer.tracking) || !Array.isArray(answer.goals)) throw goalsError("GOALS_ANSWER_INVALID", GOALS.invalid);
  goalList($("goals-tracking"), answer.tracking, GOALS.trackingEmpty);
  goalList($("goals-goals"), answer.goals, GOALS.goalsEmpty);
  $("goals-error").hidden = true; $("goals-lists").hidden = false;
}
// The error Card (Feedback's): the lists give way to it, so a failed read is never drawn as nothing yet; Try again reads once more.
function goalsFail(e) {
  $("goals-lists").hidden = true; $("goals-error").hidden = false;
  coded($("goals-error-body"), GOALS.errorBody, e && e.code);
}
let goalsRead = null, goalsSeq = 0;
async function goalsLoad(read) {
  goalsRead = read; const mine = ++goalsSeq;
  let answer;
  try { answer = await read(); } catch (e) { if (mine === goalsSeq) goalsFail(e); return; }
  if (mine !== goalsSeq) return;
  try { goalsDraw(answer); } catch (e) { goalsFail(e); }
}
$("goals-retry").onclick = () => goalsLoad(goalsRead);
// A digest row (ListRow on a Card): the tile by what it was, the event in the past tense and its line; it carries no button.
function digestRow(r) {
  const row = el("div"); row.className = "digest-row";
  const tile = DIGEST_TILES[r.kind] || DIGEST_TILES.done;
  const span = el("span"); span.className = "digest-tile " + tile.mod; span.append(icon(tile.glyph, "sm"));
  const body = el("div"); body.className = "digest-body";
  const t = el("div", r.title); t.className = "t-sub digest-title"; body.append(t);
  if (r.sub) { const s = el("div", r.sub); s.className = "t-sub t-2"; body.append(s); }
  row.append(span, body);
  return row;
}
// A day (the prompt Card): the day with the time written beside it, the summary, the count line and the rule, then its rows.
function digestCard(d) {
  const card = el("section"); card.className = "qf-prompt-card digest-day"; card.setAttribute("aria-label", d.day);
  const head = el("div"); head.className = "digest-head";
  const time = el("span", FEED.written.replace("{time}", d.written)); time.className = "t-foot t-2 digest-time";
  head.append(el("h2", d.day), time);
  const para = el("p", d.summary); para.className = "digest-summary";
  const stat = el("div", d.stat); stat.className = "t-foot t-2";
  const rule = el("div"); rule.className = "digest-rule";
  card.append(head, para, stat, rule);
  for (const r of d.rows) card.append(digestRow(r));
  return card;
}
function feedDraw(days) {
  $("feed-days").replaceChildren();
  $("feed-note").textContent = days.length ? "" : FEED.empty;
  for (const d of days) $("feed-days").append(digestCard(d));
}
// No store holds goals or digests yet (their engine parts bring one), so each route draws its empty answer.
function goals() { goalsLoad(async () => ({ tracking: [], goals: [] })); }
function feed() { feedDraw([]); }`;
