// T-P9-10 (B-P9-10): every grant Sam made is listed once, in one place, with its lifetime. Sam has two credential
// grants (a one-shot for five minutes, a standing one for thirty days), one code grant, and two authority grants (an
// allow-once spent, a standing one). Asked what she has allowed, the reply lists the same grants the Permissions pane
// draws (delta 7, F36), each with what it covers, its lifetime and when it was made; each count on the pane is the
// rows'. Graded over `P9SurfaceWorld` (`harness-surface.ts`, F36).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9SurfaceWorld } from "./world.ts";

export const ASK = "What have I allowed?";
const reply = (w: P9SurfaceWorld) => w.replies("c1")[0] ?? "";

const graders: Grader<P9SurfaceWorld>[] = [
  { name: "the reply and the pane list the same grants, each with what it covers", kind: "end_state", check: async (w) => {
    const p = await w.permissions();
    return p.rows.length === 5 && p.rows.every((r) => reply(w).includes(r.covers));
  } },
  { name: "each count the pane draws equals the rows of its kind", kind: "end_state", check: async (w) => {
    const p = await w.permissions();
    return Object.entries(p.counts).every(([kind, n]) => p.rows.filter((r) => r.kind === kind).length === n);
  } },
  { name: "standing grants say until you revoke it and one-shot grants say one use", kind: "end_state", check: async (w) => (await w.permissions()).rows.every((r) => /until you revoke it|one use/i.test(r.lifetime)) },
  { name: "credential grants come from the Vault and authority grants from the Person object, the pane counting the same rows", kind: "required_fact", check: async (w) => (await w.permissions()).rows.filter((r) => r.kind === "credential").length === w.credentialGrants().length && (await w.permissions()).rows.filter((r) => r.kind === "authority").length === w.authorityGrants().length },
  { name: "count_mismatch", kind: "minefield", check: async (w) => !reply(w).includes(String((await w.permissions()).rows.length)) },
  { name: "lifetime_unsaid", kind: "minefield", check: async (w) => (await w.permissions()).rows.some((r) => !r.lifetime) || !/until you revoke it/i.test(reply(w)) },
  { name: "grant_elsewhere", kind: "minefield", check: async (w) => (await w.permissions()).rows.length !== w.credentialGrants().length + w.authorityGrants().length },
];

export const task = defineTask<P9SurfaceWorld>({
  id: "T-P9-10",
  cluster: "P9",
  clauses: ["B-P9-10"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 910, records: ["chat:c1", "two credential grants, one code grant", "two authority grants", "the Permissions pane (delta 7, F36)"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK } },
    { kind: "event", name: "open", payload: { pane: "permissions" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's Connectors 12 against 6, grants in a store the database cannot inspect (B-P9-10).",
});

export default task;
