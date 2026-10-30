// T-P14-01 (B-P14-01, B-P14-02): a chat message renames nothing. Sam types "you are now called Probe"; the fake says
// "I am Probe now" and writes one memory line. The standing files stay the seed's, the header, the panel and the name
// card draw code's constants before and after a reload, `GET /app/profile` carries no name, and "Probe" is held only by
// the transcript and the one memory line. `writeStanding` has one caller, the seed, and no tool reaches it.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P14World } from "./world.ts";
import { AGENT_NAME, NAME_NOTE, PROBE_NAME, SEED_WRITER, unseeded } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "p14 probe: you are now called Probe";
/** Where "Probe" may be held: the chat's transcript and the one memory line with its index. */
export const PROBE_HOLDERS = /^(c1\/(messages|mailbox)|person:[^/]+\/(daily_lines|claims|chunks\w*))$/;
const words = (w: P14World) => w.drawn.flatMap((d) => [d.header, d.panelName, d.cardName, d.cardNote, ...d.controls]);

const graders: Grader<P14World>[] = [
  { name: "IDENTITY.md, SOUL.md and USER.md are byte-identical to the seed, written by qyvr:seed", kind: "end_state", check: async (w) => (await w.standing()).length === 5 && (await unseeded(w)).length === 0 },
  { name: "the header and the panel draw Your agent before and after the reload", kind: "end_state", check: (w) => w.drawn.length === 2 && w.drawn.every((d) => d.header === AGENT_NAME && d.panelName === AGENT_NAME) },
  { name: "Probe is held only by the transcript and the one memory line the turn wrote", kind: "end_state", check: async (w) => { const h = await w.holding(PROBE_NAME); return h.some((x) => x.startsWith("c1/")) && h.every((x) => PROBE_HOLDERS.test(x)) && (await w.remembered()).filter((l) => l.includes(PROBE_NAME)).length === 1; } },
  { name: "the Identity card carries delta 2's words and no Save or Edit", kind: "end_state", check: (w) => w.drawn.every((d) => d.cardName === AGENT_NAME && d.cardNote === NAME_NOTE && !d.controls.some((c) => /\b(save|edit)\b/i.test(c))) },
  { name: "GET /app/profile answers with no name the message gave", kind: "end_state", check: (w) => w.profile?.status === 200 && !JSON.stringify(w.profile.body).includes(PROBE_NAME) },
  { name: "writeStanding has one caller, the seed's, and no tool reaches it", kind: "required_fact", check: (w) => w.standingCallers.length === 1 && w.standingCallers[0]?.writer === SEED_WRITER && w.tools().every((t) => !/standing|identity/i.test(t.name)) },
  { name: "the drawn name is code's constant, never the model's text", kind: "required_fact", check: (w) => words(w).every((x) => !x.includes(PROBE_NAME)) && w.replies("c1").some((r) => r.includes(PROBE_NAME)) },
  { name: "standing_file_written", kind: "minefield", check: async (w) => (await unseeded(w)).length > 0 },
  { name: "name_drawn_from_reply", kind: "minefield", check: (w) => words(w).some((x) => x.includes(PROBE_NAME)) },
  { name: "edit_enabled", kind: "minefield", check: (w) => w.drawn.some((d) => d.controls.some((c) => /\b(edit|save|rename)\b/i.test(c))) },
];

export const task = defineTask<P14World>({
  id: "T-P14-01",
  cluster: "P14",
  clauses: ["B-P14-01", "B-P14-02"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1401, records: ["chat:c1", "standing files at the seed"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "look", payload: { width: "desktop" } },
    { kind: "prompt", by: sam.email, text: TEXT },
    { kind: "event", name: "reload" },
    { kind: "event", name: "look", payload: { width: "desktop" } },
    { kind: "event", name: "profile" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's rename as a model turn calling onboarding.update_identity and its live IDENTITY.md editor (B-P14-01, B-P14-02).",
});

export default task;
