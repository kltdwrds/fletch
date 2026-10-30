// The capture item (F36, P9 delta 1; B-P9-02; specimen `ds/specimens/connections.html`): a capture link in the agent's
// words (`/vault/capture?ref=…&host=…&setup=…`, the link `credential_request` returned) is drawn in its bubble as an item that
// says what the setup binds (the host and how the key is sent) and its state, read from the Vault every time it is
// drawn: not entered yet, with Open the form and Dismiss; entered, from the `captured` event; dismissed, after which
// that link opens no form (`VAULT_REF_INVALID`), while a later ask's link (a new setup id) still does. Nothing is stored before the submit, so the pending state is this
// item's alone, never a vault row; a state that could not be read is said, never drawn as pending.
//
// The script runs inside the chat's (thread-work.ts interpolates it), so it shares that scope: `el`, `getJson`, `post`
// and `coded`. Text is always set as text, never as markup.

export const CAPTURE_TEXT = {
  open: "Open the form",
  dismiss: "Dismiss",
  reading: "Reading whether it was entered…",
  pending: "Not entered yet: the form takes the key; nothing is saved until you submit it.",
  entered: "Entered {at}; bound to {host}.",
  dismissed: "Dismissed {at}. The link no longer opens a form; ask again for a new one.",
  unread: "Could not read whether it was entered. Reload the page to try again.",
  notDismissed: "Not dismissed: that did not go through. Try again.",
  login: "a login typed into the sign-in page",
  key: "an API key sent as {placement}",
};

export const CAPTURE_ITEM_SCRIPT = `const CAPTURE = ${JSON.stringify(CAPTURE_TEXT)};
const CAPTURE_LINK = /\\/vault\\/capture\\?[^\\s)"'<>\\]]+/g;
// One item per capture link in the agent's words, drawn again (and its state read again) each time the bubble is.
function captureItems(d) {
  for (const n of d.captures || []) n.remove();
  d.captures = [];
  const b = d.bubble;
  if (!b || typeof d.raw !== "string") return;
  for (const m of d.raw.matchAll(CAPTURE_LINK)) {
    const href = m[0].replace(/[.,;:]+$/, "");
    const q = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    const ref = q.get("ref") || "", host = q.get("host") || "";
    if (!ref || !host) continue;
    const login = q.get("kind") === "login" || q.get("fills") === "on";
    const placement = ((q.get("header") || "authorization") + " " + (q.has("prefix") ? q.get("prefix") : "Bearer")).trim().replace(/^authorization Bearer$/i, "a Bearer header");
    const item = el("div"); item.className = "qf-prompt-card capture-item";
    Object.assign(item.dataset, { ref, host, setup: q.get("setup") || "", kind: login ? "login" : "secret", state: "" });
    const line = el("p");
    const what = host + " · " + (login ? CAPTURE.login : CAPTURE.key.replace("{placement}", placement)) + ". ";
    item.append(el("h3", ref.replace(/^cred:\\/\\//, "")), line);
    b.append(item); d.captures.push(item);
    captureState(item, line, what, href);
  }
}
const captureAt = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
// The state is the Vault's answer for this person; the buttons are offered only while the setup waits on them.
async function captureState(item, line, what, href) {
  for (const n of Array.from(item.children)) if (n.className === "qf-dlg-act") n.remove();
  coded(line, what + CAPTURE.reading, "");
  let s;
  try { s = await getJson("/vault/capture/state?ref=" + encodeURIComponent(item.dataset.ref) + "&setup=" + encodeURIComponent(item.dataset.setup)); }
  catch (e) { item.dataset.state = "unread"; coded(line, what + CAPTURE.unread, e && e.code); return; }
  item.dataset.state = s.state;
  const at = s.at ? captureAt(s.at) : "";
  if (s.state === "entered") { coded(line, what + CAPTURE.entered.replace("{at}", at).replace("{host}", item.dataset.host), ""); return; }
  if (s.state === "dismissed") { coded(line, what + CAPTURE.dismissed.replace("{at}", at), ""); return; }
  coded(line, what + CAPTURE.pending, "");
  const act = el("div"); act.className = "qf-dlg-act";
  const open = el("a", CAPTURE.open); open.className = "qf-btn qf-btn--primary"; open.href = href; open.target = "_blank"; open.rel = "noopener";
  const dismiss = el("button", CAPTURE.dismiss); dismiss.className = "qf-btn qf-btn--secondary";
  dismiss.onclick = async () => {
    dismiss.disabled = true;
    const r = await post("/vault/capture/dismiss", { ref: item.dataset.ref, setup: item.dataset.setup }).catch(() => null);
    if (!r || !r.ok) { dismiss.disabled = false; coded(line, what + CAPTURE.notDismissed, r ? (await r.json().catch(() => ({}))).code : "NETWORK"); return; }
    await captureState(item, line, what, href);
  };
  act.append(open, dismiss); item.append(act);
}
`;
