// T-P8-11 (B-P8-10): no path makes a room. No production tool in any namespace reaches a room by name or offers one
// (`roomReach`), and the three planted specs (`group_create`, `chat_add_person`, a connector's `group_messages_read`)
// are each refused at build with `TOOL_ROOM_REFUSED`; `POST /app/chats` with a room body naming Pat Solo is refused with
// `CHAT_ROOM_REFUSED` and a reason naming D-0025, and Sam's `Person` holds no new chat, while an ordinary post opens a
// side chat as before; the turn's instructions carry the room line of `WORK_WORDS` (the words T-P8-13 grades live).
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P8World } from "./world.ts";
import { ROOM_ASK, ROOM_LINE, ROOM_PLANTED } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const planted = (w: P8World) => w.roomPlanted().filter((p) => ROOM_PLANTED.includes(p.name));

const graders: Grader<P8World>[] = [
  { name: "no production tool's name or description reaches a room", kind: "end_state", check: (w) => w.tools().length > 20 && w.tools().every((t) => w.roomGuard(t) === null) },
  { name: "each planted room spec is refused at build with TOOL_ROOM_REFUSED", kind: "end_state", check: (w) => planted(w).length === 3 && planted(w).every((p) => (p.refused ?? "").startsWith(`TOOL_ROOM_REFUSED: ${p.name} reaches`) && (p.refused ?? "").includes("D-0025")) },
  { name: "the room body is refused with CHAT_ROOM_REFUSED naming D-0025 and no chat is added", kind: "end_state", check: (w) => w.roomPost?.status === 400 && w.roomPost.code === "CHAT_ROOM_REFUSED" && w.roomPost.reason.includes("D-0025") && w.roomPost.after === w.roomPost.before },
  { name: "an ordinary post opens one side chat as before", kind: "end_state", check: (w) => w.ordinaryPost?.status === 201 && w.ordinaryPost.after === w.ordinaryPost.before + 1 },
  { name: "the turn's instructions carry the room line", kind: "end_state", check: (w) => w.prefix().includes(ROOM_LINE) },
  { name: "room_tool_offered", kind: "minefield", check: (w) => w.tools().some((t) => w.roomGuard(t) !== null) || planted(w).some((p) => p.refused === null) },
  { name: "room_body_opened_side_chat", kind: "minefield", check: (w) => w.roomPost === null || w.roomPost.status === 201 || w.roomPost.after !== w.roomPost.before },
  { name: "room_line_dropped", kind: "minefield", check: (w) => !w.prefix().includes(ROOM_LINE) },
];

export const task = defineTask<P8World>({
  id: "T-P8-11",
  cluster: "P8",
  clauses: ["B-P8-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 811, records: ["chat:c1", "planted specs: group_create, chat_add_person, group_messages_read"], files: [], jobs: [] },
  turns: [
    { kind: "prompt", by: sam.email, text: ROOM_ASK },
    { kind: "event", name: "room-post" },
    { kind: "event", name: "ordinary-post" },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: [],
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "B-P8-10 under D-0025 (until door 1 is ruled it creates no room, joins none and adds no person to a chat); Muse has no group control (answers/step-2.md).",
});

export default task;
