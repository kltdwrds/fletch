// Audio the person can see (P13, F72): the chat's audio item, the Library's Audio section and the Settings Voice row.
// A read-aloud or an episode reaches the chat as a link card of kind `audio` (F71's effect, its `href` the piece's file
// under the person's files); here it is drawn as an item with an `<audio>` player on a short-lived signed read link the
// person's own `Person` makes (`/app/file/link`, as the Library's images), its duration and voice in words, and Open to
// the file's address in the Library. The Audio section lists the person's `audio_items` records (`/app/library`'s
// `audio`), never a loose file, each with its player. Settings > Voice lists aura-2's speakers and writes the person's
// pick to the same record the chat's `voice_set` writes, with writer `settings` (`/app/speaker`); a pick saved whose
// journal row the Ledger did not take is said so (`journaled: false`), never as not saved. What a record says is data:
// it is set as text, never as markup.

/** The words the audio surfaces show, one table, so a test walks them for a code shown as words. */
export const AUDIO_TEXT = {
  section: "Audio",
  empty: "No audio yet",
  open: "Open",
  episode: "Episode",
  readAloud: "Read aloud",
  voice: "Voice",
  voiceSub: "Read-alouds and episodes use this voice",
  voiceSaved: "Saved. Read-alouds now use this voice.",
  voiceSavedUnjournaled: "Saved. Read-alouds now use this voice; the change was not journaled.",
  voiceNotSaved: "Not saved: that did not go through. Try again.",
  voiceUnread: "Your voice could not be read just now.",
  noPlayer: "This audio could not be played just now.",
  unread: "Your audio could not be read just now. Try again in a moment.",
  inVoice: " · voice ",
};

/** The audio item, the Audio section's rows and the Voice row's select. */
export const AUDIO_CSS = `
.qf-audio-item audio, .lib-audio audio { width: 100%; max-width: 480px; height: 40px; display: block; margin: 8px 0; }
.lib-audio { display: flex; flex-direction: column; gap: 8px; }
.lib-audio-row { padding: 12px 16px; border-radius: 16px; background: var(--fill-primary); display: flex; flex-direction: column; gap: 4px; }
.lib-audio-row .nm { font: 600 14px/20px var(--font-sans); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-audio-row .mt { font-size: 12px; line-height: 16px; color: var(--text-secondary); }
.lib-audio-row .qf-tlink { align-self: flex-start; }
#set-voice { min-width: 128px; }
`;

/** The Voice row (Settings > General): the speakers come from `/app/speaker`, so the select is filled by the script. */
export const VOICE_ROW = `<div class="qf-grp"><h3>${AUDIO_TEXT.voice}</h3><div class="qf-grpcard">
    <label id="set-voice-row" class="qf-srow is-static"><span class="tx">${AUDIO_TEXT.voice}<span class="sub">${AUDIO_TEXT.voiceSub}</span></span><select id="set-voice" class="qf-select set-field" aria-label="${AUDIO_TEXT.voice}"></select></label>
  </div><p id="set-voice-note" class="set-note" role="status"></p></div>`;

export const AUDIO_SCRIPT = String.raw`const AUD = ${JSON.stringify(AUDIO_TEXT)};
const audSec = (ms) => (ms / 1000).toFixed(1) + " s";
const audPath = (href) => String(href || "").replace(/^files\//, "");
// A player on a signed read link for one of the person's files; a link that could not be made says so in words.
function audPlayer(path, note) {
  const a = el("audio"); a.controls = true; a.setAttribute("controls", ""); a.setAttribute("preload", "none"); a.dataset.path = path;
  libLinkInto(a, "src", path).then((code) => { if (code && note) coded(note, AUD.noPlayer, code); });
  return a;
}
function audOpen(path) {
  const o = el("a", AUD.open); o.className = "qf-btn qf-btn--secondary"; o.href = "/library/files/" + path.split("/").map(encodeURIComponent).join("/");
  o.onclick = (e) => { if (e && e.preventDefault) e.preventDefault(); libOpenFile(path); };
  return o;
}
// The chat's audio item: the card's words (its length and voice), the player, and Open to the record's file.
function audioItem(c, where) {
  const d = el("div"); d.className = "card link qf-prompt-card qf-audio-item"; d.dataset.link = c.id; d.dataset.kind = "audio";
  const path = audPath(c.href), note = el("p", "");
  d.append(el("h3", c.title), el("p", c.text), audPlayer(path, note), note);
  const act = el("div"); act.className = "act"; act.append(audOpen(path)); d.append(act);
  drawOnce(d, where, "link", c.id);
}
// The Library's Audio section: one row per record, newest first, each with its player and Open.
// A list that could not be read is said, never drawn as empty.
function libAudioDraw(host, items) {
  host.className = "lib-audio"; host.replaceChildren();
  if (libAudio === null) { $("lib-empty").hidden = true; coded($("lib-note"), AUD.unread, libAudioCode); return; }
  for (const a of items.slice().sort((x, y) => y.at - x.at)) {
    const row = el("div"); row.className = "lib-audio-row"; row.dataset.id = a.id; row.dataset.path = a.path; row.dataset.kind = a.kind;
    const note = el("p", ""); note.className = "mt";
    const nm = el("span", (a.kind === "episode" ? AUD.episode : AUD.readAloud) + ": " + String(a.source || "").split("\n")[0].slice(0, 80)); nm.className = "nm";
    const mt = el("span", audSec(a.durationMs) + AUD.inVoice + a.voice + " · " + libAgo(a.at)); mt.className = "mt";
    const open = audOpen(a.path); open.className = "qf-tlink";
    row.append(nm, mt, audPlayer(a.path, note), note, open);
    host.append(row);
  }
}
// Settings > Voice: read when Settings opens; a pick is saved at once and said in words.
async function voiceRow() {
  const s = $("set-voice"); coded($("set-voice-note"), "", "");
  try {
    const v = await getJson("/app/speaker");
    s.replaceChildren();
    for (const k of v.speakers) { const o = el("option", k); o.value = k; s.append(o); }
    s.value = v.speaker;
  } catch (e) { coded($("set-voice-note"), AUD.voiceUnread, e && e.code); }
}
$("set-voice").onchange = async () => {
  const r = await post("/app/speaker", { speaker: $("set-voice").value });
  if (r.ok) { const b = await r.json().catch(() => ({})); coded($("set-voice-note"), b.journaled === false ? AUD.voiceSavedUnjournaled : AUD.voiceSaved, ""); }
  else { const b = await r.json().catch(() => ({})); coded($("set-voice-note"), AUD.voiceNotSaved, b.code); voiceRow(); }
};`;
