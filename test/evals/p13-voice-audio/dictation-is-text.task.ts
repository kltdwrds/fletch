// T-P13-04 (B-P13-04): dictation fills the composer with text the person sends as a plain message. The composer's mic is
// the browser's own (the page holds no recorder for dictation); what reaches the deploy is the box's text, so the turn
// is one typed message, no attachment row and no audio object. Tier 1, F70; the dictation is faked as the box's text.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";

export const DICTATED = "p13 probe: remind me that Sam Solo and Pat Solo are planning a picnic on Saturday";

const graders: Grader<P13World>[] = [
  { name: "one text message carries the dictated words", kind: "end_state", check: (w) => w.typed().length === 1 && w.typed()[0] === DICTATED },
  { name: "no attachment row", kind: "end_state", check: (w) => w.rows().length === 0 && w.uploads.length === 0 },
  { name: "no audio object in any bucket", kind: "end_state", check: async (w) => (await w.objects()).every((k) => !/\.(mp3|m4a|ogg|opus|wav|weba)$|\/user\//.test(k)) },
  { name: "the turn was answered as text", kind: "required_fact", check: (w) => w.replies().length === 1 },
  { name: "dictated_audio_kept", kind: "minefield", check: async (w) => w.rows().some((r) => r.cls === "audio") || (await w.objects()).some((k) => /\/user\//.test(k)) },
];

export const task = defineTask<P13World>({
  id: "T-P13-04",
  cluster: "P13",
  clauses: ["B-P13-04"],
  priority: "nice-to-have",
  tier: 1,
  setup: { seed: 1304, records: ["chat:c1", "the composer's box filled by the browser's dictation"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "dictate", payload: { text: DICTATED } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "voice.md: speaking a message with the composer mic becomes a text message (B-P13-04).",
});

export default task;
