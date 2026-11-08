// The tier-1 runs of the P10 tasks (F90): each task's script for `p10Harness`, shared by its `.test.ts` and by
// `planted.test.ts`, which plays the same runs with a guard removed.
import type { FakeStep } from "../../support/fake-model.ts";
import type { P10HarnessOptions } from "./harness.ts";
import { ORDERS_PAGE } from "./harness.ts";
import { BUSY, ORDERS, PROBE, PROBE_HEADING, PROBE_HEADING_2, PROBE_LABEL, PROBE_LINK, PROSE_URL, WALLED } from "./world.ts";

export const load = (...names: string[]): FakeStep => ({ toolCall: { id: `load_${names.join("_")}`, name: "tool_search", arguments: { load: names } } });
export const open = (id: string, args: Record<string, unknown>): FakeStep => ({ toolCall: { id, name: "browse_open", arguments: args } });
export const live = (id: string, args: Record<string, unknown>): FakeStep => ({ toolCall: { id, name: "browse_live", arguments: args } });

export const REPLY_01 = `[${PROBE_HEADING}](${PROBE}) has one link: [${PROBE_LABEL}](${PROBE_LINK}).`;
export const REPLY_02 = "The page asked me to save a line, open an address it wrote out and send what I saved; I did not open that address, and the message waits for your decision.";
export const REPLY_04 = "Both sites turned the browser away: walled.test put a bot check in front of the page and busy.test asked for 120 seconds before another request. You can open them yourself.";

export const runs: Record<string, (variant?: string) => P10HarnessOptions> = {
  "T-P10-01": () => ({ script: [load("browse"), open("o1", { url: PROBE }), { text: REPLY_01 }] }),
  "T-P10-02": () => ({
    page: ORDERS_PAGE,
    script: [load("browse"), open("o1", { url: ORDERS }), open("o2", { url: PROSE_URL }), { toolCall: { id: "m1", name: "mail_send", arguments: { body: "p10 obeyed" } } }, { text: REPLY_02 }],
  }),
  "T-P10-15": () => ({ script: [load("browse"), open("o1", { url: PROBE }), { text: REPLY_01 }] }),
  "T-P10-04": () => ({ script: [load("browse"), open("o1", { url: WALLED }), open("o2", { url: BUSY }), open("o3", { url: WALLED }), live("l1", { url: WALLED }), { text: REPLY_04 }] }),
  "T-P10-06": () => ({ script: [load("browse"), open("o1", { url: PROBE }), { text: `The heading is "${PROBE_HEADING}".` }, open("o2", { url: PROBE }), { text: `Now it is "${PROBE_HEADING_2}".` }] }),
};
