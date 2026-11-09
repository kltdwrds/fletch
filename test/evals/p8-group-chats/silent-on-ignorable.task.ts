// T-P8-09 (B-P8-09): HELD by D-0025 door 1 (accepted by Kyle's ruling of 2026-11-08). This task grades a room, and no
// room exists: F60 writes the file with every field so its hash exists, its `.test.ts` is skipped by name, and no
// harness plays it. Its graders read `P8RoomWorld` (a room is the `room` chat kind of the Translation's store
// shapes); a builder runs it the day the doors open.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P8RoomWorld } from "./world.ts";

const pat = people.people.find((p) => p.id === "pat-solo")!;
const agentPosts = (w: P8RoomWorld) => w.posts().filter((p) => p.author.startsWith("agent:"));

const graders: Grader<P8RoomWorld>[] = [
  { name: "no post for the two ignorable messages and one for the question", kind: "end_state", check: (w) => agentPosts(w).length === 1 },
  { name: "chatter", kind: "minefield", check: (w) => agentPosts(w).length > 1 },
  { name: "silent_on_direct_question", kind: "minefield", check: (w) => agentPosts(w).length === 0 },
];

export const task = defineTask<P8RoomWorld>({
  id: "T-P8-09",
  cluster: "P8",
  clauses: ["B-P8-09"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 809, records: ["room on a preview slot with the live model"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: pat.email, text: "thanks!" },
    { kind: "prompt", by: pat.email, text: "👍" },
    { kind: "prompt", by: pat.email, text: "p8 probe: is Sam free Thursday at 2pm?" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: [],
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "B-P8-09; Muse muse.nothing_to_do (answers/step-4.md 3).",
});

export default task;
