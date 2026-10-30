// T-P9-02 (B-P9-02): an unfinished setup is a state Sam can see and end. After T-P9-01's link, the form never
// submitted, the chat draws a capture item (P9 delta 1, F36) naming the host, the kind and "not entered yet", with
// Dismiss. Sam reloads, dismisses it, and reloads again: the item says dismissed and the link is void
// (`VAULT_REF_INVALID`); the Connected pane never shows a row for it and the Vault never holds one. Graded over
// `P9SurfaceWorld`, which F36's harness implements: skipped by name until F36.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9SurfaceWorld } from "./world.ts";
import { API_HOST, API_REF } from "./world.ts";

export const ASK = "Connect me to the Example API at https://api.example.com; it takes a bearer token.";

const graders: Grader<P9SurfaceWorld>[] = [
  { name: "after the dismiss the item says dismissed and has no Dismiss control", kind: "end_state", check: async (w) => {
    const item = await w.captureItem("c1");
    return item !== null && item.host === API_HOST && /dismissed/i.test(item.state) && !item.dismiss;
  } },
  { name: "the dismissed link is void: its GET answers VAULT_REF_INVALID", kind: "end_state", check: async (w) => (await w.captureLink(API_REF)).code === "VAULT_REF_INVALID" },
  { name: "the Connected pane shows no row and the Vault holds no secrets or host row for it", kind: "end_state", check: async (w) => !(await w.connected()).includes(API_HOST) && w.secrets().length === 0 && w.hostRows().length === 0 },
  { name: "no credential grant and no audit row", kind: "end_state", check: (w) => w.credentialGrants().length === 0 && w.auditRows().length === 0 },
  { name: "pending is the chat item's state, not a vault row: the link was given and nothing was stored", kind: "required_fact", check: (w) => w.results("c1").some((r) => r.tool === "credential_request" && r.text.includes("CAPTURE_REQUESTED")) && w.secrets().length === 0 },
  { name: "pending_row", kind: "minefield", check: (w) => w.secrets().length > 0 || w.hostRows().length > 0 },
  { name: "pane_row", kind: "minefield", check: async (w) => (await w.connected()).includes(API_HOST) },
  { name: "silent_lapse", kind: "minefield", check: async (w) => !/dismissed/i.test((await w.captureItem("c1"))?.state ?? "") },
];

export const task = defineTask<P9SurfaceWorld>({
  id: "T-P9-02",
  cluster: "P9",
  clauses: ["B-P9-02"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 902, records: ["chat:c1", "vault: no secret", "the capture item (delta 1, F36)"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "reload" },
    { kind: "event", name: "dismiss", payload: { ref: API_REF } },
    { kind: "event", name: "reload" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's cards with no Cancel and no pane row, the abandoned authd sessions (B-P9-02).",
});

export default task;
