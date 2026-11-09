// The P16 tier-1 tasks under vitest (F80): each task's scripted run in `runs.ts` through the tier-1 harness. The six
// must-have (T-P16-01, 02, 04, 06, 07, 10) and the three nice-to-have (T-P16-08, 09, 11).
import { describe } from "vitest";
import { runTask } from "../../support/task.ts";
import after from "./after-handoff-claims-nothing.task.ts";
import buyer from "./buyer-is-not-the-owner.task.ts";
import choice from "./choice-is-not-approval.task.ts";
import flag from "./flag-only-rule-kept.task.ts";
import { p16Harness } from "./harness.ts";
import noClick from "./no-terms-no-cookies-no-account.task.ts";
import cites from "./offer-cites-its-page.task.ts";
import refusals from "./refusals-by-name.task.ts";
import readOnly from "./research-is-read-only.task.ts";
import leaves from "./research-leaves-research.task.ts";
import { runs } from "./runs.ts";

describe("[F80] P16 shopping and bookings, tier 1", () => {
  for (const t of [readOnly, cites, choice, noClick, refusals, buyer, flag, after, leaves]) runTask(t, p16Harness(runs[t.id]!()));
});
