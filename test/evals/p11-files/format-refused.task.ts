// T-P11-02 (B-P11-02): a format this deploy cannot make is refused by its code before anything is saved, in two worlds:
// a Renderer that answers docx, odt and html, asked for pdf (`RENDER_FORMAT_REFUSED`, refused before the port is
// called), and the self-host default host, whose every render is `HOST_RENDER_UNAVAILABLE` (no Renderer call at all).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import { named, type P11World } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
export const TEXT = "make p11 memo as a PDF";
const world = (w: P11World, name: string) => w.renders.find((r) => r.world === name);
/** The refusals' words name the formats that can be made (`RENDER_WORDS`). */
// F101 adds pptx to the Renderer's formats (delta 3), so the refusal names four.
const FORMATS = "only docx, odt, html, pptx can be made";

const graders: Grader<P11World>[] = [
  { name: "no file row in either world", kind: "end_state", check: (w) => w.renders.length === 2 && w.renders.every((r) => r.files.length === 0) },
  { name: "the Renderer world's result carries RENDER_FORMAT_REFUSED with the sentence naming the formats", kind: "end_state", check: (w) => (world(w, "renderer")?.results ?? []).some((t) => t.startsWith("RENDER_FORMAT_REFUSED:") && t.includes(FORMATS)) },
  { name: "the default host's result carries HOST_RENDER_UNAVAILABLE", kind: "end_state", check: (w) => (world(w, "default")?.results ?? []).some((t) => t.startsWith("HOST_RENDER_UNAVAILABLE:")) },
  { name: "the refusal code is the first token of the tool result", kind: "required_fact", check: (w) => w.renders.every((r) => r.results.length === 1 && /^[A-Z_]+:/.test(r.results[0] as string)) },
  { name: "no Renderer call in the default world, and none for pdf", kind: "required_fact", check: (w) => (world(w, "default")?.asked.length ?? 1) === 0 && !(world(w, "renderer")?.asked ?? []).includes("pdf") },
  { name: "faked_extension", kind: "minefield", check: (w) => w.renders.some((r) => r.files.some((f) => f.path.endsWith(".pdf"))) },
  { name: "saved_on_refusal", kind: "minefield", check: (w) => w.renders.some((r) => r.files.length > 0 || r.results.some((t) => t.startsWith("SAVED:"))) },
];

export const task = defineTask<P11World>({
  id: "T-P11-02",
  cluster: "P11",
  clauses: ["B-P11-02"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 2, records: ["chat:c1", "a Renderer that answers docx, odt and html", "the self-host default host"], files: [], jobs: [] },
  turns: [{ kind: "prompt", by: sam.email, text: TEXT }],
  ...named(graders),
  collateral: {},
  graders,
  reference: "The contract requires it (D-0001); Muse's builder made the PDF its kind names (B-P11-02).",
});

export default task;
