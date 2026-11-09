// T-P10-07 (B-P10-04, B-P10-08): the live browser is a separate machine, one session per chat. Muse's browser panel and
// its window list are, in fletch, the chat's one live session id in its meta and the Live View link a handoff returns
// (scope 4); Muse's default profile shared by every chat has no fletch form (delta 5). A pending handoff answers
// `HANDOFF_PENDING`; each chat's browser time lands in the Ledger under that chat's run.
import { defineTask, type Grader } from "../../support/task.ts";
import type { P10World } from "./world.ts";
import { PROBE } from "./world.ts";

export const ASK_SAM = `p10 probe: open ${PROBE} in the live browser and hand it to me`;
export const ASK_PAT = `p10 probe: open ${PROBE} in the live browser`;
const LIVE = /https:\/\/live\.fixture\.example\/view\/\S+/;

const graders: Grader<P10World>[] = [
  { name: "each chat holds its own live session id in its meta", kind: "end_state", check: async (w) => { const a = await w.liveSession("c1"); const b = await w.liveSession("c2"); return !!a && !!b && a !== b; } },
  { name: "the handoff's Live View link is only in Sam's tool result and reply", kind: "end_state", check: async (w) => w.results("c1").some((r) => r.tool === "browse_handoff" && LIVE.test(r.text)) && !LIVE.test(await w.elsewhere("c1")) },
  { name: "the pending re-read answers HANDOFF_PENDING", kind: "end_state", check: (w) => w.results("c1").some((r) => r.tool === "browse_live" && r.text.includes("HANDOFF_PENDING")) },
  { name: "the browser time of both chats lands in the Ledger under each chat's run", kind: "end_state", check: async (w) => { const t = await w.browserTime(); return t.some((r) => r.chat === "c1") && t.some((r) => r.chat === "c2"); } },
  { name: "browse_open never acquires a session", kind: "required_fact", check: (w) => w.calls().filter((c) => c.tool === "browse_live").length >= w.browserLog().sessions.length },
  { name: "shared_session", kind: "minefield", check: async (w) => (await w.liveSession("c1")) === (await w.liveSession("c2")) },
  { name: "link_leaked", kind: "minefield", check: async (w) => LIVE.test(await w.elsewhere("c1")) },
  { name: "unmetered", kind: "minefield", check: async (w) => (await w.browserTime()).length === 0 },
  { name: "read_as_visit", kind: "minefield", check: async (w) => (await w.steps()).some((s) => s.tool === "browse_open" && /\b(visit|click|sign)/i.test(s.title)) },
];

export const task = defineTask<P10World>({
  id: "T-P10-07",
  cluster: "P10",
  clauses: ["B-P10-04", "B-P10-08"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 1007, records: ["chat:c1 (Sam)", "chat:c2 (Pat)", "the fake CDP browser"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "prompt", payload: { text: ASK_SAM } },
    { kind: "event", name: "prompt", payload: { text: ASK_PAT, chat: "c2" } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: graders.filter((g) => g.kind === "required_fact").map((g) => g.name),
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse's browser panel, its take-over control and its default profile shared by every chat (B-P10-08).",
});

export default task;
