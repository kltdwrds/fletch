// T-P9-08 (B-P9-08): a connection's status is stored and said. Sam has two keys: api.example.com active and
// api.example.net past its `expires_at`. The fake network answers api.example.com 200, then 401. The Connected pane
// draws a status word and the last use per row (delta 5, F36). The first reply counts the pane's rows and names each
// host with its word; after the 401 the reply says the provider rejected the key and only Sam can reconnect it, and
// the row shows that outcome and its time; the expired key's read is refused `VAULT_CRED_INACTIVE` and said so; nothing
// reconnects on its own. Graded over `P9SurfaceWorld` (`harness-surface.ts`, F36).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9SurfaceWorld } from "./world.ts";
import { API_HOST, OLD_HOST } from "./world.ts";

export const ASKS = ["What is connected?", "Read https://api.example.com/p9-probe with my key.", "Read it again.", "Read https://api.example.net/p9-probe with my key."];
const reply = (w: P9SurfaceWorld, i: number) => w.replies("c1")[i] ?? "";

const graders: Grader<P9SurfaceWorld>[] = [
  { name: "the first reply counts the pane's rows and names each host with its status word", kind: "end_state", check: async (w) => {
    const rows = await w.connectedRows();
    return rows.length === 2 && reply(w, 0).includes(String(rows.length)) && rows.every((r) => reply(w, 0).includes(r.host) && reply(w, 0).includes(r.status));
  } },
  { name: "after the 401 the reply says the provider rejected the key and only Sam can reconnect it", kind: "end_state", check: (w) => /rejected|refused/i.test(reply(w, 2)) && /only you/i.test(reply(w, 2)) },
  { name: "the api.example.com row shows the 401 and the time of that last use", kind: "end_state", check: async (w) => {
    const row = (await w.connectedRows()).find((r) => r.host === API_HOST);
    return row !== undefined && row.lastUse !== null && /401/.test(row.outcome ?? "");
  } },
  { name: "the expired key's read is refused VAULT_CRED_INACTIVE and said so", kind: "end_state", check: (w) => w.results("c1").some((r) => r.text.includes("VAULT_CRED_INACTIVE")) && /expired|inactive/i.test(reply(w, 3)) },
  { name: "status is CredentialInfo.status and last use is the newest audit row's time", kind: "required_fact", check: async (w) => {
    const rows = await w.connectedRows();
    const newest = Math.max(...w.auditRows().filter((a) => a.host === API_HOST).map((a) => a.at));
    return rows.every((r) => r.status === w.secrets().find((s) => s.hosts.includes(r.host))?.status) && rows.find((r) => r.host === API_HOST)?.lastUse === new Date(newest).toISOString();
  } },
  { name: "count_mismatch", kind: "minefield", check: async (w) => !reply(w, 0).includes(String((await w.connectedRows()).length)) },
  { name: "silent_401", kind: "minefield", check: (w) => !/rejected|refused|401/i.test(reply(w, 2)) },
  { name: "auto_reconnect", kind: "minefield", check: (w) => w.secrets().length !== 2 },
  { name: "no_status_word", kind: "minefield", check: async (w) => (await w.connectedRows()).some((r) => !r.status) || !reply(w, 0).includes("expired") || !new RegExp(OLD_HOST.replace(/\./g, "\\.")).test(reply(w, 0)) },
];

export const task = defineTask<P9SurfaceWorld>({
  id: "T-P9-08",
  cluster: "P9",
  clauses: ["B-P9-08"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 908, records: ["chat:c1", "cred://example-api active", "cred://example-old expired", "the Connected pane (delta 5, F36)"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASKS[0] } },
    { kind: "event", name: "prompt", payload: { text: ASKS[1] } },
    { kind: "event", name: "prompt", payload: { text: ASKS[2] } },
    { kind: "event", name: "open", payload: { pane: "connectors" } },
    { kind: "event", name: "prompt", payload: { text: ASKS[3] } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { vault: [`audit:${API_HOST}:resolved`, `audit:${OLD_HOST}:VAULT_CRED_INACTIVE`] },
  graders,
  reference: "Muse's 12 rows with no word against 10 then 6 connected, the connection dropped unsaid (B-P9-08).",
});

export default task;
