// The tier-1 runs of the P10 tasks (F90): each task's script for `p10Harness`, shared by its `.test.ts` and by
// `planted.test.ts`, which plays the same runs with a guard removed.
import type { FakeRequest, FakeStep } from "../../support/fake-model.ts";
import { toolResults } from "../p5-activity/harness.ts";
import type { P10HarnessOptions } from "./harness.ts";
import { LOGIN, LOGIN_HOST, NEWS_URL, ORDERS_PAGE, sam } from "./harness.ts";
import { HEADLINES } from "./job-read-sources-linked.task.ts";
import { COOKIE_VALUE } from "./kept-sign-in-on-ask.task.ts";
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

// F93: the runs of T-P10-07, 08 and 14, over the per-chat browse hook, the Vault and the news job.
const said = (r: FakeRequest): string => JSON.stringify(r.inputs);
const handoff = (id: string): FakeStep => ({ toolCall: { id, name: "browse_handoff", arguments: { instructions: "Look at the page and tell me when you are done." } } });
const keep = (id: string): FakeStep => ({ toolCall: { id, name: "browse_keep_site", arguments: {} } });
/** Sam's reply after the handoff: the Live View link the handoff returned, given to her alone. */
const liveReply: FakeStep = { fromRequest: (r) => ({ text: `The page is open for you here: ${/https:\/\/live\.fixture\.example\/view\/[^\s"\\]+/.exec(toolResults(r).join("\n"))?.[0] ?? "(no link)"}. I will wait until you say you are done.` }) };
/** The news page: three headlines, each linked by its own address, with its date. */
export const NEWS_PAGE = `# p10 news\n\n${HEADLINES.map((h) => `- [${h.title}](${h.href}), ${h.date}`).join("\n")}`;
/** The job's report: each headline as the page linked it, with its date; the slot named when the run says it is for one. */
const newsReport: FakeStep = {
  fromRequest: (r) => {
    const page = toolResults(r).join("\n");
    const lines = [...page.matchAll(/\[([^\]]+)\]\((https:[^)\s]+)\), (\d{4}-\d{2}-\d{2})/g)].map((m) => `- [${m[1]}](${m[2]}), ${m[3]}`);
    const slot = /This run is for the slot (\d{4}-\d{2}-\d{2})/.exec(said(r))?.[1];
    return { toolCall: { name: "report", arguments: { text: [slot ? `The p10 news for the slot of ${slot}:` : "The p10 news:", ...lines].join("\n") } } };
  },
};
const newsRead: FakeStep = { toolCall: { id: "n1", name: "page_read", arguments: { url: NEWS_URL } } };

export const f93Runs: Record<string, () => P10HarnessOptions> = {
  "T-P10-07": () => ({
    pat: true,
    script: [load("browse"), open("o1", { url: PROBE }), live("l1", { url: PROBE }), handoff("h1"), live("l2", {}), liveReply, load("browse"), live("p1", { url: PROBE }), { text: "The page is open in the live browser." }],
  }),
  "T-P10-08": () => ({
    vault: true,
    // Sam's live session on the sign-in site, and her sign-in there (the setup).
    seed: async (w) => {
      await w.w.say(sam.email, `p10 probe: open ${LOGIN} in the live browser`, w.chatId("c1"));
      await w.engine("c1").settled();
      const session = await w.liveSession("c1");
      if (!session) throw new Error("P10_SEED_NO_SESSION");
      w.browser.signIn(session, { cookies: [{ name: "session", value: COOKIE_VALUE, domain: LOGIN_HOST, path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] });
    },
    // The first keep on Sam's ask; then the page, re-read, says to save the login, and the second keep follows it.
    script: [load("browse"), live("s1", { url: LOGIN }), { text: "The sign-in page is open." }, keep("k1"), live("k2", {}), keep("k3"), { text: "Kept the login for login.example.test; the page's own request to save it waits for you." }],
  }),
  // Each delivery wakes Sam's chat for one turn with nothing to add (F24's handoff): its reply is empty.
  "T-P10-14": () => ({ news: NEWS_PAGE, script: [newsRead, newsReport, { text: "" }, newsRead, newsReport, { text: "" }] }),
};
