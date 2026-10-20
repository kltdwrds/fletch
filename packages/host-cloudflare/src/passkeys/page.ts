// The login page (F1): one HTML string with no external asset, served before the app exists for the
// visitor. It takes nothing from the request into the HTML; the state is one of three fixed words. The one
// inline script and the one inline style are allowed by their hashes, so the CSP needs no 'unsafe-*'.
import { sha256 } from "@noble/hashes/sha2.js";

export type PageState = "register" | "add" | "authenticate";

const STYLE = `
:root{color-scheme:light dark;--ink:#1d1d1f;--muted:#5f6368;--bg:#fff;--line:#d7d7db;--accent:#1a56db;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--ink:#ececf1;--muted:#a1a1aa;--bg:#141416;--line:#34343a;--accent:#7aa2ff;--bad:#ff8a80}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{width:100%;max-width:26rem;padding:2rem 1rem}
h1{font-size:1.5rem;margin:0 0 .5rem}
p{margin:.5rem 0 1rem;color:var(--muted)}
button{font:inherit;min-height:44px;padding:.6rem 1.2rem;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--bg);cursor:pointer;width:100%}
button:disabled{opacity:.6;cursor:progress}
a{color:var(--accent)}
label{display:block;margin:.75rem 0 .25rem}
input{font:inherit;width:100%;min-height:44px;padding:.5rem;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
form button{margin-top:1rem}
code{display:block;font-size:1.25rem;letter-spacing:.05em;padding:1rem;border:1px dashed var(--line);border-radius:8px;text-align:center;margin:1rem 0;user-select:all}
.error{color:var(--bad);margin-top:1rem}
`;

const SCRIPT = `(() => {
  const state = document.body.dataset.state;
  const $ = (id) => document.getElementById(id);
  const enc = (buf) => {
    let s = "";
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  };
  const dec = (t) => Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ids = (list) => (list || []).map((c) => ({ ...c, id: dec(c.id) }));
  const fail = (message) => {
    $("error").textContent = message;
    $("error").hidden = false;
  };
  async function post(path, body) {
    const res = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok === false) throw new Error((json && json.reason) || "the server answered " + res.status);
    return json;
  }
  async function register() {
    const o = await post("/login/register/options");
    const p = o.options;
    const cred = await navigator.credentials.create({ publicKey: { ...p, challenge: dec(p.challenge), user: { ...p.user, id: dec(p.user.id) }, excludeCredentials: ids(p.excludeCredentials) } });
    const r = cred.response;
    const credential = {
      id: cred.id, rawId: enc(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
      response: { clientDataJSON: enc(r.clientDataJSON), attestationObject: enc(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] },
    };
    const done = await post("/login/register/verify", { challengeId: o.challengeId, credential });
    if (!done.recoveryCode) return location.assign("/");
    $("code").textContent = done.recoveryCode;
    $("start").hidden = true;
    $("saved").hidden = false;
  }
  async function signIn() {
    const o = await post("/login/options");
    const p = o.options;
    const cred = await navigator.credentials.get({ publicKey: { ...p, challenge: dec(p.challenge), allowCredentials: ids(p.allowCredentials) } });
    const r = cred.response;
    const credential = {
      id: cred.id, rawId: enc(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults(),
      response: { clientDataJSON: enc(r.clientDataJSON), authenticatorData: enc(r.authenticatorData), signature: enc(r.signature), ...(r.userHandle ? { userHandle: enc(r.userHandle) } : {}) },
    };
    await post("/login/verify", { challengeId: o.challengeId, credential });
    location.assign("/");
  }
  async function attempt(button, work) {
    $("error").hidden = true;
    button.disabled = true;
    try {
      await work();
    } catch (err) {
      fail(err && err.message ? err.message : String(err));
    } finally {
      button.disabled = false;
    }
  }
  $("go").addEventListener("click", () => attempt($("go"), () => {
    if (!window.PublicKeyCredential) throw new Error("this browser does not support passkeys");
    return state === "authenticate" ? signIn() : register();
  }));
  $("done").addEventListener("click", () => location.assign("/"));
  const toggle = $("show-recover");
  if (toggle) {
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      $("recover").hidden = false;
      toggle.hidden = true;
    });
    $("recover").addEventListener("submit", (e) => {
      e.preventDefault();
      attempt($("recover-go"), async () => {
        await post("/login/recover", { email: $("email").value, code: $("recovery").value });
        location.reload();
      });
    });
  }
})();`;

const COPY: Record<PageState, { title: string; lead: string; button: string }> = {
  register: { title: "Set up fletch", lead: "Create a passkey for this deploy's owner. It is how you sign in from now on.", button: "Create passkey" },
  add: { title: "Add a passkey", lead: "You are signed in. Create a passkey on this device to sign in with it next time.", button: "Create passkey" },
  authenticate: { title: "Sign in to fletch", lead: "Use the passkey you created for this deploy.", button: "Sign in" },
};

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const hashOf = (text: string) => `'sha256-${base64(sha256(new TextEncoder().encode(text)))}'`;

export const PAGE_CSP = [
  "default-src 'none'",
  `script-src ${hashOf(SCRIPT)}`,
  `style-src ${hashOf(STYLE)}`,
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function loginPage(state: PageState): string {
  const c = COPY[state];
  const recover =
    state === "authenticate"
      ? `<p><a href="#" id="show-recover">Lost your passkey? Use your recovery code</a></p>
<form id="recover" hidden>
<label for="email">Owner email</label><input id="email" type="email" autocomplete="username" required>
<label for="recovery">Recovery code</label><input id="recovery" autocomplete="off" spellcheck="false" required>
<button id="recover-go" type="submit">Recover access</button>
</form>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${c.title}</title>
<style>${STYLE}</style>
</head>
<body data-state="${state}">
<main>
<section id="start">
<h1>${c.title}</h1>
<p>${c.lead}</p>
<button id="go" type="button">${c.button}</button>
${recover}
</section>
<section id="saved" hidden>
<h1>Your recovery code</h1>
<p>Write this down and keep it somewhere safe. It is shown once, and it is the only way back in if you lose every passkey.</p>
<code id="code"></code>
<button id="done" type="button">I have written it down</button>
</section>
<p id="error" class="error" role="alert" hidden></p>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}
