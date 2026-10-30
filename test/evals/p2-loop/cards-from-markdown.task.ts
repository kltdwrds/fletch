// T-P2-10 (B-P2-10): a link in a reply is markdown in the stored body and nothing else: a URL is drawn as an anchor
// (no unfurl, Translation delta 5) and a link to a stored file (`files/<path>`) as a file card in the thread, both
// again after a reload. The file card is F24's; its page test lands with it.
import { defineTask } from "../../support/task.ts";
import type { LoopPageWorld } from "./page-world.ts";

export const URL = "https://example.com/p2-guide";
export const FILE = "p2-barrier.md";
export const BODIES = [`The guide is here: [P2 guide](${URL}).`, `Your note: [${FILE}](files/${FILE}).`];

export const task = defineTask<LoopPageWorld>({
  id: "T-P2-10",
  cluster: "P2",
  clauses: ["B-P2-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 10, records: ["page:chat:c1 with an agent message holding a URL link and one holding a link to a stored file"], files: [FILE], jobs: [] },
  turns: [
    { kind: "event", name: "render" },
    { kind: "event", name: "reload" },
  ],
  end_state: ["the URL is drawn as an anchor, not unfurled", "the file link is drawn as a file card with its name and kind", "the stored rows hold markdown only", "both are drawn again after the reload"],
  required_facts: [],
  minefields: ["card_row", "bare_path"],
  collateral: {},
  graders: [
    { name: "the URL is drawn as an anchor, not unfurled", kind: "end_state", check: (w) => w.anchors().some((a) => a.href === URL) },
    { name: "the file link is drawn as a file card with its name and kind", kind: "end_state", check: (w) => w.fileCards().some((c) => c.name === FILE && c.kind.length > 0) },
    { name: "the stored rows hold markdown only", kind: "end_state", check: (w) => BODIES.every((b) => w.stored().some((e) => e.kind === "agent" && e.text === b)) },
    { name: "both are drawn again after the reload", kind: "end_state", check: (w) => w.seen().length === 2 && w.seen().every((s) => s.anchors >= 1 && s.cards >= 1) },
    { name: "card_row", kind: "minefield", check: (w) => w.stored().some((e) => e.kind === "link" || e.kind === "file") },
    { name: "bare_path", kind: "minefield", check: (w) => w.fileCards().length === 0 && w.drawn().some((d) => d.text.includes(FILE)) },
  ],
  reference: "Muse steps 2 and 5 (`step-2-dom.md`, `step-5-dom.md`, `answers/step-2.md` 2, `answers/step-5.md` 2).",
});

export default task;
