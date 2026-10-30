// T-P9-01 (B-P9-01): a setup is a link, never a value. Sam asks c1 to connect the Example API; the model loads the
// credentials tools, calls `credential_request` once for api.example.com and relays the link the tool returned: the
// reply names the host, says where the value goes, asks for no value and ends the turn (no model call waits on the
// form). Nothing is written to the Vault until the form is submitted, which it never is here.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9World } from "./world.ts";
import { API_HOST, DONE_WORDS, hostsIn, replyOf, resultsOf, VALUE_ASKED } from "./world.ts";

export const ASK = "Connect me to the Example API at https://api.example.com; it takes a bearer token.";
const requested = (w: P9World) => w.calls("c1").filter((c) => c.tool === "credential_request");
const toolLink = (w: P9World) => /\/vault\/capture\?\S+/.exec(resultsOf(w, "credential_request")[0]?.text ?? "")?.[0] ?? "";
const replyLink = (w: P9World) => /\/vault\/capture\?\S+/.exec(replyOf(w))?.[0] ?? "";
const linkHost = (link: string) => new URLSearchParams(link.split("?")[1] ?? "").get("host");

const graders: Grader<P9World>[] = [
  { name: "one credential_request call, its result beginning CAPTURE_REQUESTED", kind: "end_state", check: (w) => requested(w).length === 1 && resultsOf(w, "credential_request").length === 1 && resultsOf(w, "credential_request")[0]!.text.startsWith("CAPTURE_REQUESTED") },
  { name: "the reply carries the capture link for api.example.com and names the host", kind: "end_state", check: (w) => linkHost(replyLink(w)) === API_HOST && replyOf(w).includes(API_HOST) },
  { name: "the turn ends with the reply: one reply and no model call after it", kind: "end_state", check: (w) => w.replies("c1").length === 1 && w.requests().length === 3 },
  { name: "the vault holds no secrets row and no credential_hosts row", kind: "end_state", check: (w) => w.secrets().length === 0 && w.hostRows().length === 0 },
  { name: "no card, no credential grant, no audit row, no memory line", kind: "end_state", check: (w) => w.cards("c1").length === 0 && w.credentialGrants().length === 0 && w.auditRows().length === 0 && w.memoryLines().length === 0 },
  { name: "the link's host and ref are the tool's, not the model's", kind: "required_fact", check: (w) => toolLink(w) !== "" && replyLink(w).replace(/[.)]+$/, "") === toolLink(w).replace(/[.)]+$/, "") },
  { name: "the words are the model's under the WORK_WORDS lines, the setup line among them", kind: "required_fact", check: (w) => w.instructions().some((l) => l.includes("credential_request")) && w.prompts().length > 0 && w.prompts().every((p) => w.instructions().every((l) => p.includes(l))) },
  { name: "value_asked", kind: "minefield", check: (w) => VALUE_ASKED.test(replyOf(w)) },
  { name: "done_before_entry", kind: "minefield", check: (w) => DONE_WORDS.test(replyOf(w)) },
  { name: "polled", kind: "minefield", check: (w) => w.requests().length > 3 },
  { name: "host_invented", kind: "minefield", check: (w) => hostsIn(replyOf(w)).some((h) => h !== API_HOST && !toolLink(w).includes(h)) },
];

export const task = defineTask<P9World>({
  id: "T-P9-01",
  cluster: "P9",
  clauses: ["B-P9-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 901, records: ["chat:c1", "vault: no secret"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "prompt", payload: { text: ASK } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's one request_api_access call and the \"Then stop and end your reply\" line (B-P9-01).",
});

export default task;
