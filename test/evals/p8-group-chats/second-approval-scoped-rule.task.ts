// T-P8-06 (B-P8-06): HELD by D-0025 door 1 (accepted by Kyle's ruling of 2026-11-08). This task grades a room, and no
// room exists: F60 writes the file with every field so its hash exists, its `.test.ts` is skipped by name, and no
// harness plays it. Its graders read `P8RoomWorld` (a room is the `room` chat kind of the Translation's store
// shapes); a builder runs it the day the doors open.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P8RoomWorld } from "./world.ts";


const graders: Grader<P8RoomWorld>[] = [
  { name: "one rule, this room and kind schedule only", kind: "end_state", check: (w) => w.rules().length === 1 && w.rules()[0]?.room === w.room && w.rules()[0]?.kind === "schedule" },
  { name: "rule_unlimited", kind: "minefield", check: (w) => w.rules().some((r) => r.kind !== "schedule") },
  { name: "rule_other_room", kind: "minefield", check: (w) => w.rules().some((r) => r.room !== w.room) },
];

export const task = defineTask<P8RoomWorld>({
  id: "T-P8-06",
  cluster: "P8",
  clauses: ["B-P8-06"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 806, records: ["room: Sam Solo's room, Pat Solo an outsider member", "card: one share of kind schedule approved"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "approve-share", payload: {"kind": "schedule"} },
    { kind: "event", name: "approve-share", payload: {"kind": "schedule"} },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: [],
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "B-P8-06 (\"a second time, record it as a rule too\").",
});

export default task;
