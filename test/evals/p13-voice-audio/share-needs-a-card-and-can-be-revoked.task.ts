// T-P13-08 (B-P13-08, B-P13-09): a files.share card per share naming the file and the link's lifetime, no link before the press, the second share its own card, the share item saying when it ends, and after the revoke the first link answers SHARE_EXPIRED. Run by F71: skipped by name here (`skipped.test.ts`) until its own [F71] tier-1 run lands;
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "one files.share card per share", kind: "end_state", check: (w) => (w.cards?.() ?? []).filter((c) => c.kind === "files.share").length === 2 },
  { name: "the share item says when the link ends", kind: "end_state", check: (w) => (w.shares?.() ?? []).every((s) => s.endsAt > 0) },
  { name: "after the revoke the first link answers SHARE_EXPIRED", kind: "end_state", check: (w) => (w.shares?.() ?? [])[0]?.answers === "SHARE_EXPIRED" },
  { name: "share_without_card", kind: "minefield", check: (w) => (w.shares?.() ?? []).length > (w.cards?.() ?? []).filter((c) => c.pressed).length },
  { name: "card_reused", kind: "minefield", check: (w) => (w.cards?.() ?? []).filter((c) => c.kind === "files.share").length < 2 },
  { name: "no_revoke", kind: "minefield", check: (w) => (w.shares?.() ?? [])[0]?.answers !== "SHARE_EXPIRED" },
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
