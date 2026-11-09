// T-P13-10 (B-P13-11): one audio record of kind episode with script, topics, duration and file, shown in the Library's Audio section; the publish ask refused PODCAST_FEED_UNAVAILABLE with its reason; no feed route answers. Run by F72: skipped by name here (`skipped.test.ts`) until its own [F72] tier-1 run lands;
// the graders read what that part adds to the world (`world.ts`, the optional members), and the part refines them before
// its first run (no run has graded them, so a change then is not an oracle correction).
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";

const graders: Grader<P13World>[] = [
  { name: "one episode record with script, topics, duration and file", kind: "end_state", check: (w) => (w.audio?.() ?? []).filter((a) => a.kind === "episode" && !!a.source && (a.topics ?? []).length > 0 && a.durationMs > 0 && !!a.path).length === 1 },
  { name: "the publish ask refused PODCAST_FEED_UNAVAILABLE", kind: "end_state", check: (w) => (w.refusals?.() ?? []).includes("PODCAST_FEED_UNAVAILABLE") },
  { name: "published_on_generation", kind: "minefield", check: (w) => (w.feedRoutes?.() ?? []).length > 0 },
  { name: "feed_route", kind: "minefield", check: (w) => (w.feedRoutes?.() ?? []).length > 0 },
  { name: "silent_refusal", kind: "minefield", check: (w) => !w.replies().some((r) => r.includes("PODCAST_FEED_UNAVAILABLE")) },
];

export const task = defineTask<P13World>({
  id: "T-P13-10",
  cluster: "P13",
  clauses: ["B-P13-11"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 1310, records: ["chat:c1", "a fixture text naming Sam Solo and Pat Solo"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: "sam@solo-sam.example", text: "make a two-voice episode about Sam Solo and Pat Solo's picnic" },
    { kind: "prompt", by: "sam@solo-sam.example", text: "publish it to a feed" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "podcasts.episodes, publishing.md (B-P13-11); the feed's refusal is D-0026's (delta 8).",
});

export default task;
