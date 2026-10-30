// T-P9-03 (B-P9-03): a login is saved on the form, and "is it saved?" is answered from the Vault's listing. Sam asks c1
// to save her login for login.example.com: `credential_request` with `login`, the link relayed. Asked "is it saved?"
// before the submit, the model lists the credentials and says no. The test then submits the capture form as Sam, from
// the page's own origin, with a password the model never receives and the description she typed (fletch's form has
// no username field; the description is where she names the account). Asked again, the model lists and says it is
// saved, naming the site and the reference: `credential_list` carries no description, so the reply cannot name a
// username, and the grader holds the description she typed on the stored row instead.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9World } from "./world.ts";
import { LOGIN_HOST, LOGIN_REF, NOT_SAVED, resultsOf } from "./world.ts";

export const SAVE = "Save my login for login.example.com so you can sign me in there.";
export const LABEL = "sam.solo at login.example.com";
const replies = (w: P9World) => w.replies("c1");
const before = (w: P9World) => replies(w)[1] ?? "";
const after = (w: P9World) => replies(w)[2] ?? "";
const row = (w: P9World) => w.secrets().find((s) => s.ref === LOGIN_REF);
const value = (w: P9World) => w.submitted?.value ?? "";
const anywhere = (w: P9World) => [w.sawText(), replies(w).join("\n"), w.rowsText(), JSON.stringify(w.vaultEvents())].join("\n");

const graders: Grader<P9World>[] = [
  { name: "the reply before the submit says it is not saved and names no value", kind: "end_state", check: (w) => NOT_SAVED.test(before(w)) && !before(w).includes(value(w)) },
  { name: "the reply after the submit says it is saved, naming the site and the reference", kind: "end_state", check: (w) => !NOT_SAVED.test(after(w)) && /\bsaved\b/i.test(after(w)) && after(w).includes(LOGIN_HOST) && after(w).includes(LOGIN_REF) },
  { name: "the secrets row is kind login with the host bound for filling, and the description Sam typed", kind: "end_state", check: (w) => row(w)?.kind === "login" && row(w)?.status === "active" && row(w)!.hosts.includes(LOGIN_HOST) && w.hostRows().some((h) => h.ref === LOGIN_REF && h.host === LOGIN_HOST && h.fills && h.via === "capture-form") && row(w)?.label === w.submitted?.label },
  { name: "the password is in no prompt, no reply, no stored row and no vault event", kind: "end_state", check: (w) => value(w).length > 8 && !anywhere(w).includes(value(w)) },
  { name: "no credential grant until a fill is asked", kind: "end_state", check: (w) => w.credentialGrants().length === 0 },
  { name: "the saved answer comes from the vault's listing: a credential_list result before each answer, the second naming the row", kind: "required_fact", check: (w) => resultsOf(w, "credential_list").length === 2 && !resultsOf(w, "credential_list")[0]!.text.includes(LOGIN_REF) && resultsOf(w, "credential_list")[1]!.text.includes(`${LOGIN_REF} (login): active`) },
  { name: "saved_before_submit", kind: "minefield", check: (w) => !NOT_SAVED.test(before(w)) || /^yes\b/i.test(before(w)) },
  { name: "password_seen", kind: "minefield", check: (w) => value(w) !== "" && anywhere(w).includes(value(w)) },
  { name: "username_from_chat", kind: "minefield", check: (w) => (replies(w).join("\n").match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).length > 0 || (row(w) !== undefined && row(w)!.label !== w.submitted?.label) },
];

export const task = defineTask<P9World>({
  id: "T-P9-03",
  cluster: "P9",
  clauses: ["B-P9-03"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 903, records: ["chat:c1", "vault: no secret"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: SAVE } },
    { kind: "event", name: "prompt", payload: { text: "Is it saved?" } },
    { kind: "event", name: "submit", payload: { label: LABEL } },
    { kind: "event", name: "prompt", payload: { text: "Is it saved now?" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { vault: ["login:active"] },
  graders,
  reference: "Muse's widget_ready card and the plain \"No\" from credentials.list (B-P9-03).",
});

export default task;
