// The thread shows the work (F24; contract P2, B-P2-04 and B-P2-10; specimen `ds/specimens/loop-status.html`). Two
// things the chat view draws from what the chat already sends, never from the model's words about itself:
//
// - The status line: while a tool runs, the thread shows the dots with the activity in words where the reply will
//   stand (`.qf-busy`). The words come from `STATUS_WORDS`, this page's table by tool, from the turn's `status` frames;
//   a tool the table does not name is "Working", and the harness's own `send_to_user` and `react` draw no line. It goes
//   when the tool returns, when words stream and at the turn's end, so it never outlives the turn.
// - Links in the agent's words: a markdown link to an `http(s)` address is an anchor (no unfurl, delta 5); a link to a
//   file in the person's store (`files/<path>`, or the Library's own `/library/files/<path>`) is a file card
//   (`.qf-fcard--chat`): a link to the Library's viewer with the file's glyph, name and kind, and the first lines of the
//   file once the page has read them. The stored message stays the markdown; the card is drawn from it every time.
//
// The script runs inside the chat's (CHAT_SCRIPT interpolates it), so it shares that scope: `add`, `thinking`,
// `endThinking`, `el`, `icon`, `filePath`, `go` and `getJson`. Text is always set as text, never as markup.
import { NOT_STEPS } from "../../chat/activity-steps.ts";
import { CAPTURE_ITEM_SCRIPT } from "./capture-item.ts";

/** What the status line says while each tool runs: the activity in words, never the tool's identifier. */
export const STATUS_WORDS: Record<string, string> = {
  file_read: "Reading a file",
  file_list: "Looking through your files",
  file_write: "Writing a file",
  file_edit: "Editing a file",
  file_delete: "Deleting a file",
  file_grep: "Searching your files",
  file_find: "Looking for files",
  code_execute: "Running a script",
  todo_write: "Updating the checklist",
  memory_write: "Saving to memory",
  memory_search: "Searching memory",
  memory_get: "Reading memory",
  memory_explain: "Looking up a memory",
  skill_read: "Reading a skill",
  skill_search: "Searching skills",
  docs_read: "Reading the docs",
  tool_search: "Finding the right tools",
  subagents_delegate: "Starting sub-agents",
  subagents_close: "Closing sub-agents",
  subagents_status: "Checking on sub-agents",
  jobs_create: "Setting up a scheduled task",
  jobs_update: "Changing a scheduled task",
  jobs_list: "Looking at your scheduled tasks",
  jobs_enable: "Turning on a scheduled task",
  jobs_disable: "Turning off a scheduled task",
  jobs_remove: "Removing a scheduled task",
  page_read: "Reading a web page",
  browse_open: "Reading a web page",
  browse_live: "Using the live browser",
  web_search: "Searching the web",
};

/** The line for a tool the table does not name. */
export const STATUS_OTHER = "Working";

/** How many of a file's first lines its card previews (the bundle's `.qf-fcard--chat .pv` is four lines high). */
export const CARD_PREVIEW_LINES = 4;

export const THREAD_WORK_SCRIPT = `const STATUS = ${JSON.stringify(STATUS_WORDS)}, STATUS_OTHER = ${JSON.stringify(STATUS_OTHER)}, QUIET = ${JSON.stringify([...NOT_STEPS])};
// The status line (F24): the tool now running, worded by the table; null (the tool returned) draws nothing. It stands in
// the thinking slot, so whatever ends the thinking dots ends it too.
function statusLine(tool) {
  endThinking();
  if (!tool || QUIET.includes(tool)) return;
  thinking = add("shimmer working", "");
  const line = el("div"); line.className = "qf-busy"; line.setAttribute("role", "status");
  const dots = el("span"); dots.className = "qf-dots"; dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) dots.append(el("b"));
  line.append(dots, el("span", Object.prototype.hasOwnProperty.call(STATUS, tool) ? STATUS[tool] : STATUS_OTHER));
  thinking.append(line);
}
// A file in the person's store a link names: \`files/<path>\` as the agent writes it, or the viewer's own address; a path
// with an empty, "." or ".." segment names none.
function storedFile(target) {
  let path = null;
  if (target.startsWith("files/")) path = target.slice(6);
  else if (target.startsWith("/library/files/")) { try { path = target.slice(15).split("/").map(decodeURIComponent).join("/"); } catch (e) { return null; } }
  if (!path || path.split("/").some((s) => !s || s === "." || s === "..")) return null;
  return path;
}
// The first lines of each file a card showed, kept for the page's session so a redraw reads nothing again.
const previews = new Map();
function fileCard(path) {
  const name = path.split("/").pop(), dot = name.lastIndexOf(".");
  const a = el("a"); a.className = "qf-fcard qf-fcard--chat"; a.href = filePath(path); a.dataset.file = path;
  // A plain click opens the viewer in this page (F6's address); a modified one is the browser's.
  a.onclick = (e) => { if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return; if (e) e.preventDefault(); go(filePath(path)); };
  const head = el("span"); head.className = "qf-fcard-head";
  const nm = el("span", name); nm.className = "nm";
  const kd = el("span", dot > 0 ? name.slice(dot + 1) : "file"); kd.className = "kd";
  head.append(icon("file", "sm"), nm, kd); a.append(head);
  const pv = el("pre"); pv.className = "pv"; pv.hidden = true; a.append(pv);
  const shown = (text) => { pv.textContent = text.split("\\n").slice(0, ${CARD_PREVIEW_LINES}).join("\\n"); pv.hidden = false; };
  if (previews.has(path)) shown(previews.get(path));
  // A file that cannot be read keeps its glyph and no preview; the code stays on the card for programs.
  else getJson("/app/file?path=" + encodeURIComponent(path)).then((f) => { if (typeof f.text !== "string") return; previews.set(path, f.text); shown(f.text); }, (e) => { a.dataset.code = (e && e.code) || ""; });
  return a;
}
// The agent's words with their links drawn (F24): an http(s) link an anchor, a stored file's a card where the link
// stood, anything else left as written. A message with no link is left as it was drawn.
const LINK = /\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)/g;
${CAPTURE_ITEM_SCRIPT}function linked(d) {
  const text = d.raw, b = d.bubble;
  // A capture link (F36) is drawn as its item after the words, whatever else the bubble holds.
  if (!b || typeof text !== "string" || !text.match(LINK)) return captureItems(d);
  b.textContent = ""; b.replaceChildren(); delete b.dataset.flow;
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > at) b.append(text.slice(at, m.index));
    at = m.index + m[0].length;
    const file = storedFile(m[2]);
    if (file) b.append(fileCard(file));
    else if (/^https?:\\/\\//i.test(m[2])) { const a = el("a", m[1]); a.href = m[2]; a.target = "_blank"; a.rel = "noopener noreferrer"; b.append(a); }
    else b.append(m[0]);
  }
  if (at < text.length) b.append(text.slice(at));
  captureItems(d);
}
`;
