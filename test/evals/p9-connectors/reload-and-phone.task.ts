// T-P9-17 (B-P9-13): tier 2 on a slot (`pnpm evals P9`, F37), after T-P9-13 and T-P9-14 with one credential captured:
// the chat reloaded at desktop and phone width, then `/settings/connectors` opened and reloaded at phone width. The
// capture item, the masked row and the Connected row are the same at both widths before and after each reload; the
// settings page draws after the reload (no "not found"); every request the pages made went to the slot's own origin.
// Read through `P9SlotWorld`, which F37's slot runner implements; it has no tier-1 run.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P9SlotWorld } from "./world.ts";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const graders: Grader<P9SlotWorld>[] = [
  { name: "the capture item, the masked row and the Connected row are the same at both widths, before and after", kind: "end_state", check: async (w) => {
    const r = await w.reloads();
    const view = (x: (typeof r)[0]) => [x.capture, x.masked, x.connected];
    return r.length === 4 && r.every((x) => same(view(x), view(r[0]!)));
  } },
  { name: "/settings/connectors draws after a reload at phone width", kind: "end_state", check: async (w) => (await w.settingsAtPhone()).drawn && !/not found/i.test((await w.settingsAtPhone()).heading) },
  { name: "every request on reload went to the slot's own origin", kind: "end_state", check: (w) => w.origins().length > 0 && w.origins().every((o) => o === w.origin) },
  { name: "the settings routes are the pages' own and the chain is rebuilt on draw", kind: "required_fact", check: async (w) => (await w.settingsAtPhone()).drawn },
  { name: "card_lost", kind: "minefield", check: async (w) => (await w.reloads()).some((x) => x.capture === null) },
  { name: "row_unmasked_after_reload", kind: "minefield", check: async (w) => (await w.reloads()).some((x) => x.masked !== null && !/\[credential:cred:\/\/typed-/.test(x.masked)) },
  { name: "settings_not_found_phone", kind: "minefield", check: async (w) => !(await w.settingsAtPhone()).drawn },
  { name: "third_party_request", kind: "minefield", check: (w) => w.origins().some((o) => o !== w.origin) },
];

export const task = defineTask<P9SlotWorld>({
  id: "T-P9-17",
  cluster: "P9",
  clauses: ["B-P9-13"],
  priority: "nice-to-have",
  tier: 2,
  setup: { seed: 917, records: ["the slot after T-P9-13 and T-P9-14", "one credential captured"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "reload", payload: { width: "desktop" } },
    { kind: "event", name: "reload", payload: { width: "phone" } },
    { kind: "event", name: "open", payload: { path: "/settings/connectors", width: "phone" } },
    { kind: "event", name: "reload", payload: { width: "phone" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's 120 s draw, \"Page not found\" at phone width and the four pixel frames (B-P9-13).",
});

export default task;
