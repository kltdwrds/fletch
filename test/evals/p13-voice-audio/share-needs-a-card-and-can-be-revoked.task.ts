// T-P13-08 (B-P13-08, B-P13-09): a files.share card per share naming the file and the link's lifetime, no link before the press, the second share its own card, the share item saying when it ends, and after the revoke the first link answers as a share that never existed. Run by F74 under `[F74]` (`share.test.ts`, its plants in `planted-f74.test.ts`), after F101's `share_revoke`.
// Reconciled before any run (F74, under Kyle's one-hour ruling of 2026-11-08; a grader refined before its first run is not
// an oracle correction): the contract's task text and its Build note 10 read the revoke as an expiry set to now, so the link
// would answer `SHARE_EXPIRED`; F101 shipped `share_revoke` as a delete of the share's row and pointer, so the revoked link
// answers exactly as an unknown share (`SHARE_UNKNOWN`, 404, the same body). The graders read the shipped code. Clauses
// B-P13-08 and B-P13-09 name no code ("can be revoked", "says when it ends"), so no clause changes; the contract's task line
// is the orchestrator's to align (the PR's Reconcile).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "one files.share card per share", kind: "end_state", check: (w) => (w.cards?.() ?? []).filter((c) => c.kind === "files.share").length === 2 },
  { name: "the share item says when the link ends", kind: "end_state", check: (w) => (w.shares?.() ?? []).every((s) => s.endsAt > 0) },
  { name: "after the revoke the first link answers SHARE_UNKNOWN", kind: "end_state", check: (w) => (w.shares?.() ?? [])[0]?.answers === "SHARE_UNKNOWN" },
  { name: "share_without_card", kind: "minefield", check: (w) => (w.shares?.() ?? []).length > (w.cards?.() ?? []).filter((c) => c.pressed).length },
  { name: "card_reused", kind: "minefield", check: (w) => (w.cards?.() ?? []).filter((c) => c.kind === "files.share").length < 2 },
  { name: "no_revoke", kind: "minefield", check: (w) => (w.shares?.() ?? [])[0]?.answers !== "SHARE_UNKNOWN" },
  { name: "no_end_said", kind: "minefield", check: (w) => (w.shares?.() ?? []).some((s) => !(s.endsAt > 0)) },
];

export const task = defineTask<P13World>({
  id: "T-P13-08",
  cluster: "P13",
  clauses: ["B-P13-08", "B-P13-09"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1308, records: ["chat:c1 with two rendered audio files"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: "sam@solo-sam.example", text: "share the first audio with Pat Solo" },
    { kind: "event", name: "press" },
    { kind: "prompt", by: "sam@solo-sam.example", text: "share the second audio too" },
    { kind: "prompt", by: "sam@solo-sam.example", text: "stop sharing the first audio" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's per-upload Allow once (B-P13-08), its missing revoke (B-P13-09).",
});

export default task;
