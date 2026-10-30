// T-P9-06 (B-P9-06): an action asks unless the person's own grant covers it. The fixture connector (`harness.ts`) has
// one observation, `fixture_count`, and one action, `fixture_create` (kind `fixture.create`); no method carries a
// default of its own. Sam's mode is the world's `ask`. In c1 the count runs with no card and its reply says 657 and
// that the connector has no view by day; the create raises one card and nothing is sent. Then Sam signs a standing
// grant for `fixture.create` (`auto`), and in c2 the same ask runs under it: the gate queues it under the grant's id,
// it is performed after the step commits, and the reply names that grant. Each call that carried Sam's key wrote one
// `egress_audit` row.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9World } from "./world.ts";
import { API_HOST, COUNT, resultsOf } from "./world.ts";

export const COUNT_ASK = "How many items are in my fixture library?";
export const CREATE_ASK = "Create a fixture item named p9 probe.";
const posts = (w: P9World, from = 0, to = Number.POSITIVE_INFINITY) => w.sent().slice(from, to).filter((s) => s.method === "POST" && s.url.endsWith("/p9-probe/items"));
const cardsOf = (w: P9World, tool: string) => [...w.cards("c1"), ...w.cards("c2")].filter((c) => c.tool === tool);
const grantId = (w: P9World) => /under grant (\S+);/.exec(resultsOf(w, "fixture_create", "c2")[0]?.text ?? "")?.[1] ?? "";

const graders: Grader<P9World>[] = [
  { name: "the count runs with no card and the reply says 657 and that there is no view by day", kind: "end_state", check: (w) => resultsOf(w, "fixture_count")[0]?.isError === false && cardsOf(w, "fixture_count").length === 0 && (w.replies("c1")[0] ?? "").includes(String(COUNT)) && /no view by day/i.test(w.replies("c1")[0] ?? "") },
  { name: "the create under ask raises one card and nothing is sent until it is pressed", kind: "end_state", check: (w) => w.cards("c1").filter((c) => c.tool === "fixture_create").length === 1 && w.cards("c1").find((c) => c.tool === "fixture_create")!.state === "pending" && posts(w, 0, w.marks.grant).length === 0 && resultsOf(w, "fixture_create")[0]!.text.startsWith("AWAITING_DECISION") },
  { name: "under Sam's standing grant the create runs with no card and its reply names the grant", kind: "end_state", check: (w) => w.cards("c2").length === 0 && posts(w, w.marks.grant).length === 1 && grantId(w) !== "" && (w.replies("c2")[0] ?? "").includes(grantId(w)) },
  { name: "one resolved egress_audit row per call that carried the key: the count and the create", kind: "end_state", check: (w) => w.auditRows().length === 2 && w.auditRows().every((a) => a.host === API_HOST && a.outcome === "resolved") && w.auditRows().map((a) => `${a.method} ${a.path}`).join(",") === "GET /p9-probe/count,POST /p9-probe/items" },
  { name: "the gate decides every action: the card under ask, the queue under the grant", kind: "required_fact", check: (w) => resultsOf(w, "fixture_create")[0]!.text.startsWith("AWAITING_DECISION") && /^queued as \S+ under grant \S+;/.test(resultsOf(w, "fixture_create", "c2")[0]?.text ?? "") },
  { name: "redirects are manual on every request sent", kind: "required_fact", check: (w) => w.sent().length === 2 && w.sent().every((s) => s.redirect === "manual") },
  { name: "write_without_card", kind: "minefield", check: (w) => posts(w, 0, w.marks.grant).length > 0 },
  { name: "card_for_read", kind: "minefield", check: (w) => cardsOf(w, "fixture_count").length > 0 },
  { name: "grant_unnamed", kind: "minefield", check: (w) => grantId(w) === "" || !(w.replies("c2")[0] ?? "").includes(grantId(w)) },
];

export const task = defineTask<P9World>({
  id: "T-P9-06",
  cluster: "P9",
  clauses: ["B-P9-06"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 906, records: ["chat:c1", "chat:c2", "cred://example-api for api.example.com", "the fixture connector"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: COUNT_ASK } },
    { kind: "event", name: "prompt", payload: { text: CREATE_ASK } },
    { kind: "event", name: "grant", payload: { kind: "fixture.create" } },
    { kind: "event", name: "prompt", payload: { text: CREATE_ASK, chat: "c2" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { journal: ["fixture.create:PENDING", "fixture.create:DONE"], vault: ["audit:api.example.com:resolved"] },
  graders,
  reference: "Muse's playlist created with no card under library.manage: default: allow (B-P9-06).",
});

export default task;
