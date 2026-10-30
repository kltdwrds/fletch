// T-P14-07 (B-P14-07, B-P14-11): what identity and settings draw survives a reload at desktop and at phone width, in
// Chromium (`harness-browser.ts`). The panel's Identity tab, `/settings`, `/settings/general`, `/settings/devices` and
// `/settings/messaging` (and `/settings/security` from F41) each draw before and after a reload at 1280 and 390 px with
// no not-found page and no control past the viewport's right edge; the mode switched to dark survives the reload from
// `localStorage["qyvr-mode"]` and no request carried it; every request went to the deploy's own origin; and the
// Identity card reads the same words before and after.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P14BrowserWorld } from "./world.ts";
import { NAME_NOTE } from "./world.ts";

/** The routes as this part ships them; the Security pane joins in F41. */
export const ROUTES = ["panel", "/settings", "/settings/general", "/settings/devices", "/settings/messaging"];
const WIDTHS = [1280, 390] as const;
const cards = (w: P14BrowserWorld) => w.routes.filter((r) => r.route === "panel").map((r) => r.card);

const graders: Grader<P14BrowserWorld>[] = [
  { name: "every route draws before and after a reload at both widths, never the not-found page", kind: "end_state", check: (w) => ROUTES.every((route) => WIDTHS.every((width) => (["before", "after"] as const).every((when) => w.routes.some((r) => r.route === route && r.width === width && r.when === when && !r.missing)))) },
  { name: "no control passes the viewport's right edge at 390 px", kind: "end_state", check: (w) => w.routes.filter((r) => r.width === 390).every((r) => r.clipped.length === 0) },
  { name: "the dark mode survives the reload from localStorage and no request wrote it", kind: "end_state", check: (w) => w.mode?.stored === "dark" && w.mode.applied === "dark" && w.mode.wrote.length === 0 },
  { name: "every request went to the deploy's own origin", kind: "end_state", check: (w) => w.origins().length > 0 && w.origins().every((o) => o === w.origin) },
  { name: "the Identity card reads the same words before and after, at both widths", kind: "end_state", check: (w) => cards(w).length === 4 && cards(w).every((c) => c?.includes(NAME_NOTE)) && new Set(cards(w)).size === 1 },
  { name: "the settings routes are pages and the theme is this browser's", kind: "required_fact", check: (w) => w.routes.filter((r) => r.route.startsWith("/settings")).every((r) => !r.missing) && w.mode?.wrote.length === 0 },
  { name: "not_found_phone", kind: "minefield", check: (w) => w.routes.some((r) => r.width === 390 && r.missing) },
  { name: "clipped", kind: "minefield", check: (w) => w.routes.some((r) => r.width === 390 && r.clipped.length > 0) },
  { name: "third_party_request", kind: "minefield", check: (w) => w.origins().some((o) => o !== w.origin) },
  { name: "theme_row_written", kind: "minefield", check: (w) => (w.mode?.wrote.length ?? 1) > 0 },
];

export const task = defineTask<P14BrowserWorld>({
  id: "T-P14-07",
  cluster: "P14",
  clauses: ["B-P14-07", "B-P14-11"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1407, records: ["Sam signed in on a standalone deploy", "chat:c1"], files: [], jobs: [] },
  turns: [
    ...ROUTES.flatMap((route) => WIDTHS.map((width) => ({ kind: "event" as const, name: "route", payload: { route, width: String(width) } }))),
    { kind: "event", name: "mode", payload: { mode: "dark" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's dialog without a route, clipped swatches and ad pixels on load (B-P14-07, B-P14-11).",
});

export default task;
