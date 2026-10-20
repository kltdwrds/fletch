// The admin pages (authority-model.md "Roles and teams", M10.2): one page served at /admin to an
// admin the `Company` lists, with sections for members and seats, roles, policies, budgets and the
// model tier, each agent's journal and ledger, disabling an agent, company connectors, company
// skills, the company instructions and the workspace mirror, and from M14.2 the workspace's own
// deployment settings (upstream's admin API through the adapter). The page holds no state and decides
// nothing: every section reads or writes through the /admin routes, the `Company` checks the role on
// each, and a refusal is shown with its code. Text from the server is set as text, never as markup.
export const ADMIN_SECTIONS = ["members", "roles", "policies", "budgets", "agents", "connectors", "skills", "instructions", "mirror", "workspace"] as const;

export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>qyvr admin</title>
<style>
  :root { color-scheme: light dark; font: 15px/1.45 system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 52rem; padding: 1rem; }
  section { border-top: 1px solid #8884; padding: .75rem 0; }
  h2 { font-size: 1.05rem; margin: .25rem 0 .5rem; }
  table { border-collapse: collapse; width: 100%; font-size: .9em; }
  td, th { text-align: left; padding: .2rem .4rem; border-bottom: 1px solid #8882; vertical-align: top; }
  form { display: flex; gap: .4rem; flex-wrap: wrap; margin: .4rem 0; }
  input, select, textarea, button { font: inherit; padding: .3rem .5rem; }
  textarea { width: 100%; min-height: 6rem; }
  pre { white-space: pre-wrap; font-size: .85em; max-height: 18rem; overflow: auto; background: #8881; padding: .5rem; }
  #status { min-height: 1.4em; font-size: .9em; }
</style>
</head>
<body>
<h1>Company admin</h1>
<p id="status" role="status"></p>
<section id="members"><h2>Members and seats</h2><p id="seats"></p><table id="member-table"></table>
  <form id="invite"><input name="email" type="email" placeholder="email" required><select name="role"><option>member</option><option>admin</option></select><button>Invite</button></form>
  <form id="seats-form"><input name="seats" type="number" min="1" placeholder="seat limit"><button>Set seats</button></form></section>
<section id="roles"><h2>Roles</h2><form id="role-form"><input name="email" type="email" placeholder="member email" required><select name="role"><option>member</option><option>admin</option><option>owner</option></select><button>Set role</button></form></section>
<section id="policies"><h2>Policies</h2><table id="policy-table"></table>
  <form id="policy-form"><input name="actionKind" placeholder="action kind, e.g. books.read" required><input name="team" placeholder="team (optional)"><select name="role"><option value="">everyone</option><option>member</option><option>admin</option><option>owner</option></select><button>Deny</button></form></section>
<section id="budgets"><h2>Budgets and model tier</h2><p id="budget-now"></p>
  <form id="budget-form"><input name="personDailyDollars" type="number" min="0" step="0.01" placeholder="$ per person per day"><input name="tenantDailyDollars" type="number" min="0" step="0.01" placeholder="$ per company per day"><select name="modelTier"><option>standard</option><option>economy</option></select><button>Save</button></form></section>
<section id="agents"><h2>Agents: journal, ledger, disable</h2><form id="agent-form"><input name="email" type="email" placeholder="member email" required><button name="do" value="journal">Journal</button><button name="do" value="ledger">Ledger</button><button name="do" value="disable">Disable</button><button name="do" value="enable">Enable</button></form><pre id="agent-out"></pre></section>
<section id="connectors"><h2>Company connectors</h2><table id="connector-table"></table>
  <form id="connector-form"><input name="id" placeholder="id, e.g. github" required><input name="hosts" placeholder="hosts, comma separated" required><input name="value" type="password" placeholder="credential" autocomplete="off" required><button>Connect</button></form></section>
<section id="skills"><h2>Company skills</h2><table id="skill-table"></table>
  <form id="skill-form"><input name="name" placeholder="name" required><input name="description" placeholder="when to use it" required><textarea name="body" placeholder="the skill"></textarea><button>Save skill</button></form></section>
<section id="instructions"><h2>Company instructions</h2><form id="instructions-form"><textarea name="text" maxlength="8000"></textarea><button>Save a new version</button></form></section>
<section id="mirror"><h2>Workspace mirror</h2><table id="mirror-table"></table><form id="mirror-form"><button>Mirror now</button></form></section>
<section id="workspace"><h2>Workspace settings</h2><p id="workspace-now"></p>
  <form id="workspace-form"><label><input name="signupsEnabled" type="checkbox"> new accounts may sign up</label><label><input name="userSearchEnabled" type="checkbox"> people may search the directory</label>
  <input name="siteName" maxlength="40" placeholder="site name"><input name="announcement" maxlength="2000" placeholder="top-bar notice">
  <input name="bannerText" maxlength="2000" placeholder="banner"><select name="bannerColor"><option>info</option><option>neutral</option><option>success</option><option>warning</option><option>danger</option><option>brand</option></select>
  <input name="accentColor" placeholder="#3b82f6, or empty for the default"><button>Save to the workspace</button></form></section>
<script>
const $ = (id) => document.getElementById(id);
const say = (t) => { $("status").textContent = t; };
async function call(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = await r.json().catch(() => ({ code: "BAD_ANSWER" }));
  if (!r.ok) throw new Error(data.code || ("HTTP_" + r.status));
  return data;
}
function rows(table, head, list) {
  table.replaceChildren();
  const tr = document.createElement("tr");
  for (const h of head) { const th = document.createElement("th"); th.textContent = h; tr.append(th); }
  table.append(tr);
  for (const cells of list) {
    const r = document.createElement("tr");
    for (const c of cells) { const td = document.createElement("td"); td.textContent = String(c ?? ""); r.append(td); }
    table.append(r);
  }
}
async function load() {
  const o = await call("GET", "/admin/overview");
  $("seats").textContent = o.seats.used + " of " + (o.seats.limit ?? "unlimited") + " seats used";
  rows($("member-table"), ["email", "name", "role", "agent"], o.members.map((m) => [m.email, m.name, m.role, m.disabled ? "disabled" : "on"]));
  rows($("policy-table"), ["action kind", "applies to"], o.policies.map((p) => [p.actionKind, p.team ? "team " + p.team : p.role ?? "everyone"]));
  const cap = (k) => usd(o.settings.budgets[k]) + (o.settings.budgetsSet[k] === undefined ? " (default)" : "");
  $("budget-now").textContent = cap("personDailyMicros") + " per person, " + cap("tenantDailyMicros") + " per company, each day; tier " + o.settings.modelTier;
  rows($("connector-table"), ["id", "hosts", "connected by"], o.connectors.map((c) => [c.id, c.hosts.join(", "), c.connectedBy]));
  rows($("skill-table"), ["name", "description"], o.skills.map((s) => [s.name, s.description]));
  $("instructions-form").text.value = o.instructions ? o.instructions.text : "";
  rows($("mirror-table"), ["when", "by", "outcome"], o.mirror.map((m) => [new Date(m.at).toISOString(), m.by, m.ok ? m.documents + " documents" : m.code]));
}
const form = (id, f) => $(id).addEventListener("submit", async (e) => {
  e.preventDefault();
  try { say(await f(e.target, e.submitter) || "Saved."); await load(); } catch (err) { say("Refused: " + err.message); }
});
const num = (v) => (v === "" ? undefined : Number(v));
const usd = (m) => "$" + (m % 10000 === 0 ? (m / 1e6).toFixed(2) : String(m / 1e6));
const micros = (v) => (v === "" ? undefined : Math.round(Number(v) * 1e6));
form("invite", (f) => call("POST", "/admin/invites", { email: f.email.value, role: f.role.value }).then(() => "Invited."));
form("seats-form", (f) => call("PUT", "/admin/settings", { seats: num(f.seats.value) ?? null }));
form("role-form", (f) => call("POST", "/admin/roles", { email: f.email.value, role: f.role.value }));
form("policy-form", (f) => call("POST", "/admin/policies", { kind: "deny-action", actionKind: f.actionKind.value, ...(f.team.value ? { team: f.team.value } : {}), ...(f.role.value ? { role: f.role.value } : {}) }));
form("budget-form", (f) => call("PUT", "/admin/settings", { budgets: Object.fromEntries([["personDailyMicros", micros(f.personDailyDollars.value)], ["tenantDailyMicros", micros(f.tenantDailyDollars.value)]].filter(([, v]) => v !== undefined)), modelTier: f.modelTier.value }));
form("agent-form", async (f, b) => {
  const who = encodeURIComponent(f.email.value);
  if (b.value === "journal" || b.value === "ledger") { $("agent-out").textContent = JSON.stringify(await call("GET", "/admin/people/" + who + "/" + b.value), null, 2); return "Read."; }
  await call("POST", "/admin/people/" + who + "/agent", { disabled: b.value === "disable" });
});
form("connector-form", (f) => call("POST", "/admin/connectors", { id: f.id.value, hosts: f.hosts.value.split(",").map((h) => h.trim()).filter(Boolean), value: f.value.value }).then(() => { f.value.value = ""; return "Connected."; }));
form("skill-form", (f) => call("POST", "/admin/skills", { name: f.name.value, description: f.description.value, body: f.body.value }).then((r) => (r.mirror && !r.mirror.ok ? "Saved; mirror failed: " + r.mirror.code : "Saved.")));
form("instructions-form", (f) => call("PUT", "/admin/instructions", { text: f.text.value }).then((r) => (r.mirror && !r.mirror.ok ? "Saved; mirror failed: " + r.mirror.code : "Saved.")));
form("mirror-form", () => call("POST", "/admin/mirror").then((r) => (r.ok ? "Mirrored " + r.documents + " documents." : "Mirror failed: " + r.code)));
// The workspace's own settings: what it holds is shown, and a save shows what it holds afterwards.
function showWorkspace(w) {
  const f = $("workspace-form");
  f.signupsEnabled.checked = w.signupsEnabled; f.userSearchEnabled.checked = w.userSearchEnabled; f.siteName.value = w.siteName;
  f.announcement.value = w.announcement; f.bannerText.value = w.banner.text; f.bannerColor.value = w.banner.color; f.accentColor.value = w.accentColor;
  $("workspace-now").textContent = "The workspace holds: site name " + (w.siteName || "(default)") + ", signups " + (w.signupsEnabled ? "open" : "closed") + ", search " + (w.userSearchEnabled ? "on" : "off") + ".";
}
const loadWorkspace = () => call("GET", "/admin/workspace").then((r) => showWorkspace(r.settings)).catch((err) => { $("workspace-now").textContent = "Could not read the workspace: " + err.message; });
form("workspace-form", (f) => call("PUT", "/admin/workspace", { signupsEnabled: f.signupsEnabled.checked, userSearchEnabled: f.userSearchEnabled.checked, siteName: f.siteName.value, announcement: f.announcement.value, banner: { text: f.bannerText.value, color: f.bannerColor.value }, accentColor: f.accentColor.value }).then((r) => { showWorkspace(r.settings); return "Saved; the workspace now holds what is shown."; }));
load().catch((err) => say("Refused: " + err.message));
loadWorkspace();
</script>
</body>
</html>
`;
