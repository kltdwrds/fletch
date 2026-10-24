// The Library and its viewers (M23.4; on the Fletch system at M27.5, the canvas's `Main` Library, TitlePicker,
// LibraryGrid, FilesTable, artifact viewer and DocumentViewer): the person's own files, sorted into the picker's
// sections by the kind each file's name says (All artifacts, Documents, Images, System files), as a grid of Cards
// or a list, with a card menu (Rename, Pin, Delete) through the shell's overlay helper; a file opens in the
// full-height viewer (title, More, Close) and a Markdown file in the read-only DocumentViewer with View source. A
// file has its address (F6), `/library/files/<path>`: opening one goes there, Close is back, Copy link copies it.
// Every read and write is a request the owning `Person` decides for the session's person alone, and a path outside
// the person's home tree is refused there; the page only says the answer in words and never draws a code. What a
// file says is data: it is set as text or built into nodes by the renderer below, never as markup.
import { type IconName, ic } from "./icons.ts";

/** The Library's own words, one table, so a test walks them for a code shown as words (M20.1's rule). */
export const LIBRARY_TEXT = {
  title: "Library",
  reading: "Reading…",
  recent: "Recent",
  all: "All",
  empty: { all: "No artifacts yet", docs: "No documents yet", images: "No images yet", files: "No files yet" } as Record<string, string>,
  create: "Create an artifact",
  createLine: "Make me an artifact: ",
  search: "Search",
  options: "Artifact options",
  sort: "Sort artifacts",
  sortDate: "Last modified",
  sortName: "Title",
  viewGrid: "View as grid",
  viewList: "View as list",
  pinned: "Pinned",
  moreFor: "More options for ",
  more: "More options",
  close: "Close",
  rename: "Rename",
  pin: "Pin",
  unpin: "Unpin",
  delete: "Delete",
  deleteTitle: "Delete this file?",
  deleteBody: "It will be removed from your library and can’t be recovered.",
  save: "Save",
  nameLabel: "File name",
  copyLink: "Copy link",
  copy: "Copy",
  download: "Download",
  viewSource: "View source",
  formatting: "Formatting (read-only)",
  linkCopied: "Link copied. Only you can open it.",
  linkIs: "Your link: ",
  copied: "Copied.",
  pdfOpen: "Open the PDF in your browser",
  partial: "Showing the first part of this file; it is longer than the page reads at once.",
  head: { name: "Name", type: "Type", modified: "Last modified", size: "Size" },
  justNow: "Just now",
  minutesAgo: "m ago",
  hoursAgo: "h ago",
  /** A file's kind as the person reads it, by extension; an unknown one is "File". */
  types: { md: "Markdown", markdown: "Markdown", html: "HTML", htm: "HTML", pdf: "PDF", txt: "Text", csv: "Text", json: "Text", docx: "Word document", odt: "Document", rtf: "Document", svg: "Image", png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image", heic: "Image", other: "File" } as Record<string, string>,
  /** What each refusal of the file store says, in words; a code outside the table falls to `notDone`. */
  refused: {
    FILES_PATH_INVALID: "That file is not in your library.",
    FILES_NOT_FOUND: "That file is not in your library any more.",
    FILES_NOT_OWNER: "Only you can open your files.",
    FILES_UNAVAILABLE: "That file could not be read just now. Try again in a moment.",
    FILES_TOO_LARGE: "That file is too large.",
    FILES_EXISTS: "A file with that name is already in your library.",
    FILES_BINARY: "This document has no preview here. Download it from More options.",
  } as Record<string, string>,
  notDone: "That did not go through. Try again.",
};

/**
 * A file's kind, from the name `/app/library` reports for it: what the picker's sections are made of. A document is
 * written to be read, a web artifact is a page, an image is a picture; anything else is one of the system's files.
 */
export const LIB_KINDS: Record<string, "document" | "web" | "image"> = {
  md: "document", markdown: "document", txt: "document", pdf: "document", docx: "document", odt: "document", rtf: "document",
  html: "web", htm: "web",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", heic: "image",
};
/**
 * The title picker's sections (the canvas's `libSections` and System files) and the kinds each shows; System files
 * is every file, as a table. Web artifacts, Videos and Podcasts are the canvas's and have no object here.
 */
export const LIB_SECTIONS = {
  all: { label: "All artifacts", glyph: "grid", group: "artifacts", kinds: ["document", "web"] },
  docs: { label: "Documents", glyph: "file", group: "artifacts", kinds: ["document"] },
  images: { label: "Images", glyph: "image", group: "media", kinds: ["image"] },
  files: { label: "System files", glyph: "folder", group: "", kinds: null },
} as const satisfies Record<string, { label: string; glyph: IconName; group: string; kinds: readonly string[] | null }>;
const GROUPS = { artifacts: "Artifacts", media: "Media" };
/** How many of the newest files the Recent grid holds; the All grid below it shows the section in the chosen sort. */
export const RECENT_SHOWN = 6;

/**
 * What the canvas's frame and inline styles say and the bundle does not carry: the Library heads itself (its title
 * picker and actions), so the shell's header is not drawn on it; the card's hover kebab, the tones a card and a tile
 * take by kind, the image grid, the picker's nodes in either home, and the viewer's head and body at a phone's width.
 */
export const LIBRARY_CSS = `
#app[data-view="library"] #head { display: none; }
#lib-sections, #lib-sections > #lib-picks { display: flex; flex-direction: column; flex: 1; gap: 1px; }
#lib-sections .lib-spacer { flex: 1; }
#lib-sections .qf-tick, .lib-pop .qf-ico24 { display: none; }
#lib-head .rel, .cardwrap { position: relative; }
.lib-pop { position: absolute; left: 0; top: 48px; z-index: 55; }
.lib-pop--end { left: auto; right: 0; top: 44px; }
.lib-backdrop { position: fixed; inset: 0; z-index: 45; }
.lib-pop .qf-menu-item { width: 100%; border: 0; background: transparent; color: inherit; font-size: 14px; line-height: 20px; gap: 10px; }
.lib-pop .qf-menu-item.is-current { color: var(--fill-blue); }
.lib-tick-l { width: 20px; display: flex; }
.lib-tick-l .ico, .lib-pop [aria-checked="false"] .qf-tick { visibility: hidden; }
[aria-checked="true"] > .lib-tick-l .ico { visibility: visible; }
#lib-menu-note:empty { display: none; }
.lib-create-circle { background: var(--fill-blue); color: var(--gray-1100); }
/* The pill's "+" is the xs tier as the canvas draws it; under 1024 px the same button is the canvas's md "+" in a circle. */
.lib-create-circle .ico { width: var(--size-icon-md); height: var(--size-icon-md); }
.lib-h { margin: 0; font: 600 18px/26px var(--font-sans); }
.cardwrap .qf-lcard { width: 100%; border-left: 0; border-right: 0; padding: 0; font: inherit; }
.cardwrap .cmore { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; }
.cardwrap .qf-lcard .th, .qf-lcard .nm, .qf-lcard .mt { display: block; }
.qf-lcard .lib-cap { min-width: 0; }
.lib-row .nm { border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.lib-row .nm > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-k-document .th { background: linear-gradient(180deg, var(--gray-025), var(--gray-200)); }
.lib-k-web .th { background: linear-gradient(180deg, var(--blue-750), var(--blue-500)); }
.lib-k-image .th, .lib-k-other .th { background: linear-gradient(135deg, var(--gray-050), var(--green-500)); }
.lib-x-md .ic, .lib-x-md .tile { background: var(--blue-500); }
.lib-x-pdf .ic, .lib-x-pdf .tile { background: var(--red-650); }
.lib-x-html .ic, .lib-x-html .tile { background: var(--orange-500); }
.lib-x-docx .ic, .lib-x-docx .tile { background: var(--indigo-650); }
.lib-x-txt .ic, .lib-x-txt .tile { background: var(--gray-500); }
.qf-file.lib-row { grid-template-columns: 1fr 112px 128px 40px; }
.qf-file .lib-sub { display: none; font-size: 12px; line-height: 16px; color: var(--text-secondary); }
.lib-imgs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.lib-imgs button { aspect-ratio: 1; border: 0; padding: 0; border-radius: 16px; overflow: hidden; background: var(--fill-primary); cursor: pointer; }
.lib-imgs img { width: 100%; height: 100%; object-fit: cover; display: block; }
#viewer:not([data-doc]) .qf-doc-head { grid-template-columns: auto 1fr auto; }
#doc-tools button:disabled { cursor: default; }
#library:not([hidden]):has(> #viewer:not([hidden])) { height: 100%; display: flex; flex-direction: column; }
#viewer:not([hidden]) { flex: 1; min-height: 0; }
#app[data-view="library"]:has(#viewer:not([hidden])) #tabs { display: none; }
.lib-art { flex: 1; overflow: auto; padding: 40px; background: var(--bg-primary); display: flex; flex-direction: column; align-items: center; }
.lib-art iframe { flex: 1; width: 100%; max-width: 820px; border: 0; background: var(--text-white); }
.lib-art img { max-width: 100%; max-height: 100%; object-fit: contain; }
.lib-pre { margin: 0; width: 100%; max-width: 820px; white-space: pre-wrap; font: 400 13px/19.5px var(--font-mono); color: var(--text-primary); }
.qf-doc-body blockquote { margin: 0 0 24px; padding: 0 0 0 16px; border-left: 3px solid var(--gray-500); color: var(--text-secondary); font-style: italic; }
.lib-src { flex: 1; display: flex; overflow: auto; background: var(--bg-primary); }
.lib-src .qf-src:first-child { color: var(--text-tertiary); text-align: right; padding-right: 0; user-select: none; }
#viewer-note:empty, #lib-note:empty { display: none; }
/* A card's more button waits on a hover only for a hovering fine pointer (F9); on touch it rests visible. */
@media (hover: hover) and (pointer: fine) {
  @container qf (min-width: 768px) {
    .cardwrap .cmore { opacity: 0; }
    .cardwrap:hover .cmore, .cardwrap .cmore:focus-visible, .cardwrap .cmore[aria-expanded="true"] { opacity: 1; }
  }
}
@container qf (max-width: 767px) {
  .qf-file .lib-sub { display: block; }
  .qf-file.lib-row { grid-template-columns: 1fr 120px; }
  .qf-file.lib-row > :nth-child(4) { display: none; }
  .lib-imgs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  #viewer .qf-doc-head { padding: 0 6px 0 12px; gap: 4px; }
  #viewer[data-doc] .qf-doc-head b { max-width: 48px; }
  #doc-tools button { width: 28px; }
  #viewer .qf-doc-body { padding: 32px 16px; }
  .lib-art { padding: 0 16px 16px; }
}
`;

const pickNode = (k: keyof typeof LIB_SECTIONS) =>
  `<button id="lib-pick-${k}" role="menuitemradio" aria-checked="false"><span class="qf-ico24">${ic(LIB_SECTIONS[k].glyph, "sm")}</span><span class="qf-lbl">${LIB_SECTIONS[k].label}</span><span class="qf-tick">${ic("check", "xs")}</span></button>`;
const optNode = (id: string, label: string) =>
  `<button id="${id}" class="qf-menu-item" role="menuitemradio" aria-checked="false"><span class="lib-tick-l">${ic("check", "xs")}</span>${label}</button>`;
const menuItem = (id: string, glyph: IconName, label: string, mods = "") =>
  `<button id="${id}" class="qf-menu-item${mods}" role="menuitem">${ic(glyph, "xs")}<span${id.endsWith("pin") ? ` id="${id}-label"` : ""}>${label}</span></button>`;
const tool = (label: string, face: string) => `<button aria-label="${label}" disabled>${face}</button>`;

/**
 * The Library page on the system's PageHeader and page column: the title (an h1 from 1024 px, the TitlePicker under
 * it) with its popover, the options (sort and view) and Create; Recent and All grids of Cards or their list, the
 * Images grid and the System files FilesTable. The picker's sections are one set of nodes that live in the Library's
 * list column from 1024 px and in the picker's popover under it. The card and viewer menus' items wait in their homes
 * for the shell's `openMenu`. The viewer is the canvas's `qf-doc`: its head (title, the read-only toolbar for a
 * Markdown file, More options, Close) over the file's render.
 */
export const LIBRARY_MARKUP = `<main id="library" hidden>
  <div id="lib-list-view">
    <div id="lib-head" class="qf-phead"><div id="lib-backdrop" class="lib-backdrop" hidden></div><div class="qf-phead-in"><div class="rel" style="min-width:0;display:flex">
      <h1 id="lib-title" class="qf-only-desktop">${LIB_SECTIONS.all.label}</h1>
      <button id="lib-pick" class="qf-titlepick qf-titlepick--lib qf-hide-desktop" aria-haspopup="menu" aria-expanded="false"><span id="lib-pick-label">${LIB_SECTIONS.all.label}</span>${ic("chevdown", "md")}</button>
      <div id="lib-pick-menu" class="qf-menu lib-pop" role="menu" aria-label="${LIBRARY_TEXT.title}" hidden></div>
    </div><div class="qf-phead-act">
      <div id="lib-options-wrap" class="rel"><button id="lib-options" class="qf-ibtn qf-ibtn--filled qf-only-phone" aria-label="${LIBRARY_TEXT.options}" aria-haspopup="menu" aria-expanded="false">${ic("dots", "md")}</button><button id="lib-sort" class="qf-ibtn qf-ibtn--filled qf-hide-phone" aria-label="${LIBRARY_TEXT.sort}" aria-haspopup="menu" aria-expanded="false">${ic("sort", "md")}</button>
        <div id="lib-options-menu" class="qf-menu lib-pop lib-pop--end" role="menu" aria-label="${LIBRARY_TEXT.options}" hidden>${optNode("lib-sort-date", LIBRARY_TEXT.sortDate)}${optNode("lib-sort-name", LIBRARY_TEXT.sortName)}<div class="qf-menu-sep"></div>${optNode("lib-view-grid", LIBRARY_TEXT.viewGrid)}${optNode("lib-view-list", LIBRARY_TEXT.viewList)}</div>
      </div>
      <button id="lib-create" class="qf-btn qf-btn--primary qf-btn--icon-start" aria-label="${LIBRARY_TEXT.create}">${ic("plus", "xs")}<span id="lib-create-label">${LIBRARY_TEXT.create}</span></button>
    </div></div></div>
    <div class="qf-page"><div class="qf-page-in">
      <p id="lib-note" class="t-sub t-2"></p>
      <h2 id="lib-recent-h" class="lib-h">${LIBRARY_TEXT.recent}</h2>
      <p id="lib-empty" class="t-sub t-2" hidden></p>
      <div id="lib-list"></div>
      <h2 id="lib-all-h" class="lib-h" hidden>${LIBRARY_TEXT.all}</h2>
      <div id="lib-all" hidden></div>
      <div id="lib-files" class="qf-files" role="table" aria-label="${LIB_SECTIONS.files.label}" hidden></div>
    </div></div>
  </div>
  <div id="viewer" class="qf-doc" hidden>
    <div class="qf-doc-head">
      <div class="l"><b id="viewer-title"></b></div>
      <div id="doc-tools" class="qf-tools" role="toolbar" aria-label="${LIBRARY_TEXT.formatting}" hidden>${tool("Bold", "<b>B</b>")}${tool("Italic", "<i>I</i>")}<i></i>${tool("Heading 1", "H1")}${tool("Heading 2", "H2")}${tool("Heading 3", "H3")}<i></i>${tool("Bullet list", ic("list", "sm"))}${tool("Numbered list", ic("olist", "sm"))}</div>
      <div class="r"><button id="viewer-more" class="qf-ibtn" aria-label="${LIBRARY_TEXT.more}" aria-haspopup="menu" aria-expanded="false">${ic("dots", "md")}</button><button id="viewer-back" class="qf-ibtn" aria-label="${LIBRARY_TEXT.close}">${ic("x", "md")}</button></div>
    </div>
    <p id="viewer-note" class="t-sub t-2" style="margin:12px 20px 0"></p>
    <div id="viewer-body" class="lib-art"></div>
  </div>
  <div id="lib-homes" hidden>
    <div id="lib-picks"><div id="lib-group-artifacts">${GROUPS.artifacts}</div>${pickNode("all")}${pickNode("docs")}<div id="lib-group-media">${GROUPS.media}</div>${pickNode("images")}<div id="lib-pick-sep"></div>${pickNode("files")}</div>
    <button id="lib-search" class="qf-search" style="cursor:pointer">${ic("search", "sm")}<span class="t-sub-m t-2">${LIBRARY_TEXT.search}</span></button>
    ${menuItem("lib-rename", "pencil", LIBRARY_TEXT.rename)}
    <form id="lib-rename-form" class="qf-search" hidden><input id="lib-rename-to" aria-label="${LIBRARY_TEXT.nameLabel}" required><button class="qf-btn qf-btn--primary">${LIBRARY_TEXT.save}</button></form>
    ${menuItem("lib-pin", "pin", LIBRARY_TEXT.pin)}
    <div id="lib-menu-sep" class="qf-menu-sep"></div>
    ${menuItem("lib-delete", "trash", LIBRARY_TEXT.delete, " is-danger")}
    <p id="lib-menu-note" class="qf-menu-head"></p>
    <button id="doc-source" class="qf-menu-item" role="menuitemcheckbox" aria-checked="false"><span class="lib-tick-l">${ic("check", "xs")}</span>${LIBRARY_TEXT.viewSource}</button>
    <div id="doc-sep" class="qf-menu-sep"></div>
    ${menuItem("viewer-share", "link", LIBRARY_TEXT.copyLink)}
    ${menuItem("viewer-pin", "pin", LIBRARY_TEXT.pin)}
    ${menuItem("viewer-copy", "copy", LIBRARY_TEXT.copy)}
    <a id="viewer-download" class="qf-menu-item" role="menuitem" href="#" download>${ic("download", "xs")}<span>${LIBRARY_TEXT.download}</span></a>
    <div id="viewer-sep" class="qf-menu-sep"></div>
    ${menuItem("viewer-delete", "trash", LIBRARY_TEXT.delete, " is-danger")}
  </div>
</main>`;

// String.raw keeps the regular expressions' backslashes as written; the renderer never uses a backtick, which
// is why the fence and the inline-code mark are built from `TICK`.
export const LIBRARY_SCRIPT = String.raw`const LIB = ${JSON.stringify(LIBRARY_TEXT)};
const LIB_KIND = ${JSON.stringify(LIB_KINDS)}, LIB_SECT = ${JSON.stringify(LIB_SECTIONS)}, LIB_RECENT = ${RECENT_SHOWN};
const TICK = String.fromCharCode(96);
const extOf = (p) => { const m = /\.([A-Za-z0-9]+)$/.exec(p); return m ? m[1].toLowerCase() : ""; };
const baseOf = (p) => p.split("/").pop();
// A file's kind is its name's (the listing's path); a binary row the name does not place says its type.
const libKind = (f) => LIB_KIND[extOf(f.path)] || (f.mediaType && /^image\//.test(f.mediaType) ? "image" : "other");
const libType = (p) => LIB.types[extOf(p)] || LIB.types.other;
const isMd = (p) => /^(md|markdown)$/.test(extOf(p || ""));
// A refusal is said in the table's words by code; one the table does not know says that it did not go through.
const libWords = (code) => LIB.refused[code] || LIB.notDone;
const libSay = async (node, r) => { const b = await r.json().catch(() => ({})); coded(node, libWords(b.code), b.code); };
// Every download and preview is a short-lived signed link the person's own object makes (M24.3): asked for
// each time a file is shown, and again when its menu opens, so a link is never kept past its few minutes.
const libLink = async (p, download) => (await getJson("/app/file/link?path=" + encodeURIComponent(p) + (download ? "&download=1" : ""))).url;
// A link that could not be made leaves the node without one and answers its code, for the page to say.
const libLinkInto = (node, attr, p, download) => libLink(p, download).then((u) => { node[attr] = u; return ""; }, (e) => { node.dataset.code = (e && e.code) || "LINK_UNAVAILABLE"; return node.dataset.code; });
let libFiles = [], libRead = false, libSection = "all", libSort = "date", libView = "grid", libPicked = null, libPop = null;
let libOpened = null, libText = "", libSrc = false;
function libAgo(at) {
  const s = (Date.now() - at) / 1000, d = new Date(at);
  if (s < 60) return LIB.justNow;
  if (s < 3600) return Math.floor(s / 60) + LIB.minutesAgo;
  if (s < 86400) return Math.floor(s / 3600) + LIB.hoursAgo;
  return d.toLocaleDateString(undefined, s < 6 * 86400 ? { weekday: "short" } : { month: "short", day: "numeric" });
}
const libMeta = (f) => libType(f.path) + " · " + libAgo(f.updated_at) + (f.pinned ? " · " + LIB.pinned : "");
const libSize = (n) => n < 1000 ? n + " B" : n < 1e6 ? (n / 1000).toFixed(1) + " kB" : (n / 1e6).toFixed(1) + " MB";

// ---- the Markdown renderer: nodes made from text, never markup; a link is drawn only to http(s) or mail ----
function mdInline(parent, s) {
  const re = new RegExp("(" + TICK + "[^" + TICK + "]+" + TICK + ")|(\\*\\*[^*]+\\*\\*)|(\\*[^*]+\\*)|(\\[[^\\]]+\\]\\([^)\\s]+\\))", "g");
  let i = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > i) parent.append(el("span", s.slice(i, m.index)));
    const t = m[0];
    if (m[1]) parent.append(el("code", t.slice(1, -1)));
    else if (m[2]) parent.append(el("strong", t.slice(2, -2)));
    else if (m[3]) parent.append(el("em", t.slice(1, -1)));
    else {
      const k = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t), text = k[1], href = k[2];
      if (/^(https?:\/\/|mailto:)/i.test(href)) { const a = el("a", text); a.href = href; a.setAttribute("rel", "noopener noreferrer"); a.setAttribute("target", "_blank"); parent.append(a); }
      else parent.append(el("span", text));
    }
    i = m.index + t.length;
  }
  if (i < s.length) parent.append(el("span", s.slice(i)));
}
function mdRender(into, text) {
  into.replaceChildren();
  const lines = text.split("\n");
  let i = 0, para = [], list = null, quote = [];
  const flush = () => {
    if (para.length) { const p = el("p"); mdInline(p, para.join(" ")); into.append(p); para = []; }
    if (quote.length) { const q = el("blockquote"); mdInline(q, quote.join(" ")); into.append(q); quote = []; }
    if (list) { into.append(list); list = null; }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith(TICK + TICK + TICK)) {
      flush(); const code = []; i++;
      while (i < lines.length && !lines[i].startsWith(TICK + TICK + TICK)) code.push(lines[i++]);
      const pre = el("pre", code.join("\n")); into.append(pre); i++; continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    const bq = /^>\s?(.*)$/.exec(line);
    if (h) { flush(); const e = el("h" + h[1].length); mdInline(e, h[2]); into.append(e); }
    else if (li) {
      if (para.length || quote.length) flush();
      const ordered = /^\s*\d+\./.test(line);
      if (list && list.tag !== (ordered ? "ol" : "ul")) flush();
      if (!list) list = el(ordered ? "ol" : "ul");
      const item = el("li"); mdInline(item, li[1]); list.append(item);
    }
    else if (bq) { if (para.length || list) flush(); quote.push(bq[1]); }
    else if (!line.trim()) flush();
    else { if (list || quote.length) flush(); para.push(line.trim()); }
    i++;
  }
  flush();
}

// ---- the sections: one set of nodes, the Library's list column from 1024 px and the TitlePicker's popover under it ----
// Held by reference: a node between homes is still the same node.
const LIB_PICKS = $("lib-picks"), LIB_SEARCH = $("lib-search");
function placeSections() {
  const col = device() === "desktop";
  for (const k of Object.keys(LIB_SECT)) {
    const b = $("lib-pick-" + k), on = k === libSection;
    b.className = (col ? "qf-listrow" : "qf-menu-item") + (on && !col ? " is-current" : "");
    b.setAttribute("aria-checked", String(on));
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  for (const g of ["artifacts", "media"]) $("lib-group-" + g).className = col ? "qf-listhead" : "qf-menu-group";
  $("lib-pick-sep").className = col ? "lib-spacer" : "qf-menu-sep";
  if (col) { closeLibPop(); $("lib-sections").append(LIB_SEARCH, LIB_PICKS); }
  else { $("lib-homes").append(LIB_SEARCH); $("lib-pick-menu").append(LIB_PICKS); }
}
// The picker and the options are the canvas's popovers at every width, over a backdrop that closes them.
function openLibPop(btn, menu) {
  const again = libPop === menu;
  closeLibPop(); closeMenu();
  if (again) return;
  libPop = menu; menu.hidden = false; btn.setAttribute("aria-expanded", "true"); $("lib-backdrop").hidden = false;
}
function closeLibPop() {
  if (!libPop) return;
  libPop.hidden = true; libPop = null; $("lib-backdrop").hidden = true;
  for (const id of ["lib-pick", "lib-options", "lib-sort"]) $(id).setAttribute("aria-expanded", "false");
}
$("lib-backdrop").onclick = closeLibPop;
$("lib-pick").onclick = () => openLibPop($("lib-pick"), $("lib-pick-menu"));
// Artifact options on a phone and Sort artifacts from 768 px (the canvas's two buttons) open the same sort and view menu.
for (const id of ["lib-options", "lib-sort"]) $(id).onclick = () => openLibPop($(id), $("lib-options-menu"));
if (document.addEventListener) document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLibPop(); });
for (const k of Object.keys(LIB_SECT)) $("lib-pick-" + k).onclick = () => { libSection = k; closeLibPop(); libLeave(); drawLib(); };
for (const [id, sort, view] of [["lib-sort-date", "date"], ["lib-sort-name", "name"], ["lib-view-grid", "", "grid"], ["lib-view-list", "", "list"]])
  $(id).onclick = () => { if (sort) libSort = sort; if (view) libView = view; closeLibPop(); drawLib(); };
// The list column's search pill is the rail's Search.
$("lib-search").onclick = () => { const b = $("rail-search"); if (b.click) b.click(); else if (b.onclick) b.onclick(); };
$("lib-create").onclick = () => { toView("chat"); $("t").value = LIB.createLine; };

// ---- the lists: Recent and All grids of Cards (or their list), the Images grid, the System files table ----
function libKebab(f, cls) {
  const b = el("button"); b.className = cls; b.append(icon("dots", "xs"));
  b.setAttribute("aria-label", LIB.moreFor + baseOf(f.path)); b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false");
  b.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); libMenuFor(f, b); };
  return b;
}
function libCard(f) {
  const x = extOf(f.path), wrap = el("div");
  wrap.className = "cardwrap lib-k-" + libKind(f) + " lib-x-" + x; wrap.dataset.path = f.path; wrap.dataset.kind = x;
  const card = el("button"); card.className = "qf-lcard";
  const th = el("span"); th.className = "th";
  const ft = el("span"); ft.className = "ft";
  const tile = el("span"); tile.className = "ic";
  const cap = el("span"); cap.className = "lib-cap";
  const nm = el("span", baseOf(f.path)); nm.className = "nm";
  const mt = el("span", libMeta(f)); mt.className = "mt";
  cap.append(nm, mt); ft.append(tile, cap); card.append(th, ft);
  card.onclick = () => libOpenFile(f.path);
  wrap.append(card, libKebab(f, "qf-ibtn qf-ibtn--glass cmore"));
  return wrap;
}
function libRow(f) {
  const x = extOf(f.path), row = el("div");
  row.className = "qf-file lib-row lib-x-" + x; row.dataset.path = f.path; row.dataset.kind = x;
  const open = el("button"); open.className = "nm";
  const tile = el("span"); tile.className = "tile"; tile.append(icon(libKind(f) === "web" ? "globe" : "file", "sm"));
  open.append(tile, el("span", baseOf(f.path))); open.onclick = () => libOpenFile(f.path);
  const kind = el("span", libType(f.path)), when = el("span", libAgo(f.updated_at) + (f.pinned ? " · " + LIB.pinned : ""));
  kind.className = when.className = "m";
  row.append(open, kind, when, libKebab(f, "qf-ibtn qf-ibtn--28"));
  return row;
}
function libCell(f) {
  const b = el("button"); b.dataset.path = f.path; b.dataset.kind = extOf(f.path); b.setAttribute("aria-label", baseOf(f.path));
  const img = el("img"); img.alt = ""; libLinkInto(img, "src", f.path); b.append(img);
  b.onclick = () => libOpenFile(f.path);
  return b;
}
function libFileRow(f) {
  const row = el("div"); row.className = "qf-file"; row.dataset.path = f.path; row.dataset.kind = extOf(f.path);
  row.setAttribute("role", "row"); row.setAttribute("tabindex", "0");
  const nm = el("span"); nm.className = "nm";
  const tile = el("span"); tile.className = "tile"; tile.append(icon(libKind(f) === "image" ? "image" : "file", "sm"));
  const names = el("span"); names.setAttribute("style", "min-width:0;display:flex;flex-direction:column");
  const sub = el("span", libType(f.path)); sub.className = "lib-sub";
  names.append(el("span", f.path), sub); nm.append(tile, names);
  const cells = [libType(f.path), libAgo(f.updated_at), libSize(f.size)].map((t) => { const c = el("span", t); c.className = "m"; return c; });
  row.append(nm, ...cells);
  row.onclick = () => libOpenFile(f.path);
  return row;
}
function libSorted(list) {
  return list.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (libSort === "name" ? baseOf(a.path).localeCompare(baseOf(b.path)) : b.updated_at - a.updated_at));
}
function libFill(host, list) {
  const grid = libView === "grid";
  host.className = grid ? "qf-lgrid" : "qf-files"; host.replaceChildren();
  for (const f of list) host.append(grid ? libCard(f) : libRow(f));
}
function drawLib() {
  closeMenu(); placeSections();
  const sect = LIB_SECT[libSection], d = device();
  $("lib-title").textContent = sect.label; $("lib-pick-label").textContent = sect.label;
  for (const [id, on] of [["lib-sort-date", libSort === "date"], ["lib-sort-name", libSort === "name"], ["lib-view-grid", libView === "grid"], ["lib-view-list", libView === "list"]]) $(id).setAttribute("aria-checked", String(on));
  // Options and Create belong to the artifact sections (the canvas's libGridActions); Create is the pill from 1024 px
  // and the accent circle under it.
  const arts = libSection === "all" || libSection === "docs", files = !sect.kinds, images = libSection === "images";
  $("lib-options-wrap").hidden = $("lib-create").hidden = !arts;
  $("lib-create").className = d === "desktop" ? "qf-btn qf-btn--primary qf-btn--icon-start" : "qf-ibtn lib-create-circle";
  $("lib-create-label").hidden = d !== "desktop";
  const want = libFiles.filter((f) => !sect.kinds || sect.kinds.includes(libKind(f)));
  for (const id of ["lib-list", "lib-all", "lib-files"]) $(id).replaceChildren();
  $("lib-empty").hidden = want.length > 0; $("lib-empty").textContent = LIB.empty[libSection];
  $("lib-recent-h").hidden = !arts; $("lib-list").hidden = files; $("lib-files").hidden = !files;
  $("lib-all-h").hidden = $("lib-all").hidden = true;
  if (files) {
    if (!want.length) return;
    const h = el("div"); h.className = "qf-files-h"; h.setAttribute("role", "row");
    for (const t of [LIB.head.name, LIB.head.type, LIB.head.modified, LIB.head.size]) h.append(el("span", t));
    $("lib-files").append(h);
    for (const f of want.slice().sort((a, b) => a.path.localeCompare(b.path))) $("lib-files").append(libFileRow(f));
  } else if (images) {
    $("lib-list").className = "lib-imgs";
    for (const f of libSorted(want)) $("lib-list").append(libCell(f));
  } else {
    // Recent is the newest few; All, the section in the chosen sort, follows only when it holds more than Recent.
    const recent = want.slice().sort((a, b) => b.updated_at - a.updated_at).slice(0, LIB_RECENT);
    libFill($("lib-list"), recent);
    if (want.length > recent.length) { $("lib-all-h").hidden = $("lib-all").hidden = false; libFill($("lib-all"), libSorted(want)); }
  }
}
// The shell asks again when the device changes (the sections change homes, Create its form); a list that could not be
// read stays unread, never drawn as empty.
function libRedraw() { placeSections(); if (libRead) drawLib(); }
async function library() {
  placeSections();
  coded($("lib-note"), LIB.reading, "");
  try {
    const l = await getJson("/app/library");
    if (!l.files || l.files.ok === false) throw Object.assign(new Error("not read"), { code: l.files && l.files.code });
    libFiles = l.files.files; libRead = true; $("lib-note").textContent = ""; drawLib();
  } catch (e) {
    libFiles = []; libRead = false; closeMenu();
    for (const id of ["lib-list", "lib-all", "lib-files"]) $(id).replaceChildren();
    $("lib-empty").hidden = true; couldNot($("lib-note"), "your library", e);
  }
}

// ---- the card menu, through the shell's helper: Rename, Pin, Delete (asked first on the ConfirmDialog) ----
function libMenuFor(f, anchor) {
  libPicked = { path: f.path, pinned: f.pinned };
  $("lib-pin-label").textContent = f.pinned ? LIB.unpin : LIB.pin;
  $("lib-rename-form").hidden = true; coded($("lib-menu-note"), "", "");
  openMenu(anchor, [$("lib-rename"), $("lib-rename-form"), $("lib-pin"), $("lib-menu-sep"), $("lib-delete"), $("lib-menu-note")]);
}
$("lib-rename").onclick = () => { if (!libPicked) return; $("lib-rename-form").hidden = false; $("lib-rename-to").value = libPicked.path; };
$("lib-rename-form").onsubmit = async (e) => {
  if (e && e.preventDefault) e.preventDefault();
  if (!libPicked) return;
  const r = await post("/app/file/rename", { path: libPicked.path, to: $("lib-rename-to").value });
  if (r.ok) { closeMenu(); library(); } else await libSay($("lib-menu-note"), r);
};
$("lib-pin").onclick = async () => {
  if (!libPicked) return;
  const r = await post("/app/file/pin", { path: libPicked.path, pinned: !libPicked.pinned });
  if (r.ok) { closeMenu(); library(); } else await libSay($("lib-menu-note"), r);
};
function libAskDelete(path, done, note) {
  closeMenu();
  confirmDialog(LIB.deleteTitle, LIB.deleteBody, { label: LIB.delete, run: async () => {
    const r = await post("/app/file/delete", { path });
    if (r.ok) { done(); library(); } else await libSay(note, r);
  } });
}
$("lib-delete").onclick = () => { if (libPicked) libAskDelete(libPicked.path, () => {}, $("lib-note")); };

// ---- the viewer: the file's render under its head; a Markdown file is the DocumentViewer, read-only ----
function closeViewer() {
  libOpened = null; libText = ""; libSrc = false; closeMenu();
  $("viewer").hidden = true; $("lib-list-view").hidden = false; $("viewer").toggleAttribute("data-doc", false);
  $("viewer-body").replaceChildren(); coded($("viewer-note"), "", "");
}
function drawViewerBody() {
  const body = $("viewer-body"), x = extOf(libOpened);
  body.replaceChildren();
  if (isMd(libOpened) && libSrc) {
    // View source: the file as written, a line-number gutter beside it and its headings marked (the canvas's .qf-src).
    body.className = "lib-src";
    const lines = libText.split("\n"), gutter = el("pre", lines.map((_, i) => i + 1).join("\n")), src = el("pre");
    gutter.className = src.className = "qf-src";
    lines.forEach((line, i) => { const s = el("span", line + (i < lines.length - 1 ? "\n" : "")); if (/^#/.test(line)) s.className = "h"; src.append(s); });
    body.append(gutter, src);
  } else if (isMd(libOpened)) { body.className = "qf-doc-body"; const a = el("article"); mdRender(a, libText); body.append(a); }
  else if (x === "html" || x === "htm") {
    // No script runs and the document has no origin: the empty sandbox attribute turns every permission off.
    body.className = "lib-art";
    const fr = el("iframe"); fr.setAttribute("sandbox", ""); fr.setAttribute("title", baseOf(libOpened)); fr.setAttribute("referrerpolicy", "no-referrer"); fr.srcdoc = libText; body.append(fr);
  } else { body.className = "lib-art"; const pre = el("pre", libText); pre.className = "lib-pre"; body.append(pre); }
}
// Opening a file is going to its address (F6), \`/library/files/<path>\`; the router draws it with \`libShow\`. Leaving
// it is back to the entry beneath, the Library's list (rebuilt beneath a file booted in a fresh tab).
function libOpenFile(path) { go(filePath(path)); }
// A pop of an overlay's own (Delete's confirm) lands first: the step back waits behind it.
function libLeave() { if (libOpened && isFile(here())) hist(() => history.back()); else closeViewer(); }
// The viewer drawn on \`path\`, at its address: a file the Person refuses or cannot read is said here with its code.
async function libShow(path) {
  if (libOpened === path) return;
  closeMenu(); closeLibPop();
  const x = extOf(path), md = isMd(path);
  $("lib-list-view").hidden = true; $("viewer").hidden = false;
  $("viewer").toggleAttribute("data-doc", md); $("doc-tools").hidden = !md;
  $("viewer-title").textContent = baseOf(path); coded($("viewer-note"), LIB.reading, "");
  libOpened = path; libText = ""; libSrc = false; $("doc-source").setAttribute("aria-checked", "false");
  const known = libFiles.find((f) => f.path === path);
  $("viewer-pin-label").textContent = known && known.pinned ? LIB.unpin : LIB.pin;
  $("viewer-download").href = "#";
  const body = $("viewer-body"); body.className = "lib-art"; body.replaceChildren();
  if (x === "pdf" || libKind({ path, mediaType: known && known.mediaType }) === "image") {
    // A PDF and an image are the browser's to show: the file is served with its type, never sniffed, in a sandbox.
    let shown;
    if (x === "pdf") { shown = el("a", LIB.pdfOpen); shown.setAttribute("target", "_blank"); shown.setAttribute("rel", "noopener noreferrer"); }
    else { shown = el("img"); shown.alt = baseOf(path); }
    const code = await libLinkInto(shown, x === "pdf" ? "href" : "src", path);
    if (libOpened !== path) return;
    if (code) coded($("viewer-note"), libWords(code), code);
    else { coded($("viewer-note"), "", ""); body.append(shown); }
    return;
  }
  try {
    const f = await getJson("/app/file?path=" + encodeURIComponent(path));
    if (libOpened !== path) return;
    libText = f.text; coded($("viewer-note"), f.complete ? "" : LIB.partial, "");
    drawViewerBody();
  } catch (e) { if (libOpened === path) coded($("viewer-note"), libWords(e && e.code), e && e.code); }
}
$("viewer-back").onclick = libLeave;
// More options: View source for a Markdown file, then Copy link, Pin, Copy (when the file is text), Download, Delete.
$("viewer-more").onclick = () => {
  if (!libOpened) return;
  $("viewer-copy").hidden = !libText;
  const items = [$("viewer-share"), $("viewer-pin"), $("viewer-copy"), $("viewer-download"), $("viewer-sep"), $("viewer-delete")];
  openMenu($("viewer-more"), isMd(libOpened) ? [$("doc-source"), $("doc-sep"), ...items] : items);
  libLinkInto($("viewer-download"), "href", libOpened, true);
};
$("doc-source").onclick = () => { libSrc = !libSrc; $("doc-source").setAttribute("aria-checked", String(libSrc)); closeMenu(); drawViewerBody(); };
$("viewer-share").onclick = async () => {
  if (!libOpened) return;
  const link = location.protocol + "//" + location.host + filePath(libOpened);
  closeMenu();
  try { await navigator.clipboard.writeText(link); coded($("viewer-note"), LIB.linkCopied, ""); }
  catch (e) { coded($("viewer-note"), LIB.linkIs + link, ""); }
};
$("viewer-copy").onclick = async () => {
  closeMenu();
  try { await navigator.clipboard.writeText(libText); coded($("viewer-note"), LIB.copied, ""); }
  catch (e) { coded($("viewer-note"), LIB.notDone, ""); }
};
$("viewer-pin").onclick = async () => {
  if (!libOpened) return;
  const known = libFiles.find((f) => f.path === libOpened);
  const r = await post("/app/file/pin", { path: libOpened, pinned: !(known && known.pinned) });
  closeMenu();
  if (r.ok) { if (known) known.pinned = !known.pinned; $("viewer-pin-label").textContent = known && known.pinned ? LIB.unpin : LIB.pin; }
  else await libSay($("viewer-note"), r);
};
$("viewer-delete").onclick = () => { if (libOpened) libAskDelete(libOpened, libLeave, $("viewer-note")); };`;
