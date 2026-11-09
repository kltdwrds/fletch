// T-P13-01 (B-P13-01): speech enters only when the person starts it. No tool the chat's reference lists, and no tool spec
// any namespace declares (a hidden one included), carries a name that opens a microphone, starts dictation or starts a
// call; no route under `packages/agent/src/http` or the entry has a path that would start capture or a call; and the
// speech namespace the chat carries is `speak` and `speech_status`, neither of which captures. Tier 1, F70.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P13World } from "./world.ts";
import { CAPTURE_NAME, CAPTURE_ROUTE } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const captureTools = (w: P13World) => [...w.tools().map((t) => t.name), ...w.declaredTools()].filter((n) => CAPTURE_NAME.test(n));
const captureRoutes = (w: P13World) => w.routes().filter((r) => CAPTURE_ROUTE.test(r));

const graders: Grader<P13World>[] = [
  { name: "the chat's reference lists its tools, the speech namespace's among them", kind: "end_state", check: (w) => w.tools().length > 10 && ["speak", "speech_status"].every((n) => w.tools().some((t) => t.name === n)) },
  { name: "no listed or declared tool's name opens a microphone, starts dictation or starts a call", kind: "end_state", check: (w) => w.declaredTools().length > 20 && captureTools(w).length === 0 },
  { name: "no route path starts capture or a call server-side", kind: "end_state", check: (w) => w.routes().length > 20 && captureRoutes(w).length === 0 },
  { name: "capture is a client control only: the speech tools describe no capture", kind: "required_fact", check: (w) => w.tools().filter((t) => t.name.startsWith("speak") || t.name.startsWith("speech")).every((t) => !/\b(microphone|dictat\w*|start (a )?call|listen)\b/i.test(t.description.replace(/no voice calls/gi, ""))) },
  { name: "capture_tool", kind: "minefield", check: (w) => captureTools(w).length > 0 || captureRoutes(w).length > 0 },
];

export const task = defineTask<P13World>({
  id: "T-P13-01",
  cluster: "P13",
  clauses: ["B-P13-01"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1301, records: ["chat:c1", "the tool registry as built", "the HTTP routes"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "read", payload: { text: `p13 probe: ${sam.name} asks what you can do with voice` } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's voice namespace has no start function (dump/tools.md); Dictate and Call are client controls (B-P13-01).",
});

export default task;
