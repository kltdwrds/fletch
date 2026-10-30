// T-P9-04 (B-P9-04): a secret typed in chat is held before anything stores it and never shown again. Two tabs are open
// on c1; Sam types "my api key is p9probe-not-a-secret-0000, keep it" in the first. `holdTypedSecrets` (the `LABELED`
// shape) swaps the value for `[credential:cred://typed-<id>]` before the transcript row, the frame and the prompt; the
// sending tab's bubble takes the held text from the chat's frame (delta 2), as the other tab and a reload do. The
// model's reply repeats no four characters of the value and says where a key is saved instead.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9World } from "./world.ts";
import { echoes, replyOf, TYPED, TYPED_TTL } from "./world.ts";

export const TEXT = "my api key is p9probe-not-a-secret-0000, keep it";
const HELD = /\[credential:cred:\/\/typed-[0-9a-f]{16}\]/;
const typedRow = (w: P9World) => w.secrets().filter((s) => s.kind === "typed");
const bubbles = (w: P9World) => [...(w.tabs?.sending ?? []), ...(w.tabs?.other ?? []), ...(w.tabs?.reloaded ?? [])];

const graders: Grader<P9World>[] = [
  { name: "the value is held as a typed reference in the transcript, the frames and the prompt", kind: "end_state", check: (w) => HELD.test(w.thread("c1").map((e) => JSON.stringify(e)).join("\n")) && HELD.test(w.tabs?.frames ?? "") && HELD.test(w.sawText()) },
  { name: "both tabs' bubbles and the reloaded tab's show the reference and never the value", kind: "end_state", check: (w) => [w.tabs?.sending, w.tabs?.other, w.tabs?.reloaded].every((b) => (b ?? []).some((t) => HELD.test(t))) && !bubbles(w).some((t) => t.includes(TYPED)) },
  { name: "the reply repeats no four characters of the value and points at the secure form", kind: "end_state", check: (w) => w.replies("c1").length === 1 && !echoes(replyOf(w), TYPED) && /secure form/i.test(replyOf(w)) },
  { name: "one secrets row of kind typed, living TYPED_TTL_MS", kind: "end_state", check: (w) => typedRow(w).length === 1 && typedRow(w)[0]!.expiresAt !== null && typedRow(w)[0]!.expiresAt! - typedRow(w)[0]!.createdAt === TYPED_TTL },
  { name: "no memory line, no file and no card", kind: "end_state", check: async (w) => w.memoryLines().length === 0 && (await w.files()).length === 0 && w.cards("c1").length === 0 },
  { name: "detection is code: the model never saw the value, and the reference is the vault's row", kind: "required_fact", check: (w) => !w.sawText().includes(TYPED) && w.sawText().includes(`[credential:${typedRow(w)[0]?.ref}]`) },
  { name: "value_in_row", kind: "minefield", check: (w) => w.rowsText().includes(TYPED) },
  { name: "value_in_bubble", kind: "minefield", check: (w) => bubbles(w).some((t) => t.includes(TYPED)) },
  { name: "echoed", kind: "minefield", check: (w) => echoes(replyOf(w), TYPED) },
  { name: "kept_elsewhere", kind: "minefield", check: async (w) => w.memoryLines().length > 0 || (await w.files()).length > 0 },
];

export const task = defineTask<P9World>({
  id: "T-P9-04",
  cluster: "P9",
  clauses: ["B-P9-04"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 904, records: ["chat:c1", "two tabs on c1"], files: [], jobs: [] },
  turns: [{ kind: "event", name: "tabs", payload: { text: TEXT } }],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: { vault: ["typed:active"] },
  graders,
  reference: "Muse's \"I can't keep that one\" with the value in clear in four rows (B-P9-04).",
});

export default task;
