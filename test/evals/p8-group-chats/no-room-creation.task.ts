// T-P8-10 (B-P8-10): the owner's app has no "Add people", "New group" or invite control at either width, and the chat
// list holds only the kinds fletch makes (main, side, request, mail): a room appears only from a connected channel, and
// this deploy connects none (D-0025 door 1). Read from the page as served to Sam and from `GET /app/chats`.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P8World } from "./world.ts";
import { ROOM_CONTROL } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const KINDS = ["mail", "main", "request", "side"];

const graders: Grader<P8World>[] = [
  { name: "the page was read at desktop and phone width", kind: "end_state", check: (w) => w.pages.map((p) => p.width).join() === "desktop,phone" && w.pages.every((p) => p.controls.length > 0) },
  { name: "no control at either width adds people, makes a group or invites", kind: "end_state", check: (w) => w.pages.every((p) => !p.controls.some((c) => ROOM_CONTROL.test(c))) },
  { name: "the chat list holds only the kinds fletch makes, none a room", kind: "end_state", check: (w) => w.pages.every((p) => p.kinds.every((k) => KINDS.includes(k))) },
  { name: "add_people_control", kind: "minefield", check: (w) => w.pages.some((p) => p.controls.some((c) => ROOM_CONTROL.test(c))) },
  { name: "agent_opened_room", kind: "minefield", check: (w) => w.pages.some((p) => p.kinds.some((k) => !KINDS.includes(k))) },
];

export const task = defineTask<P8World>({
  id: "T-P8-10",
  cluster: "P8",
  clauses: ["B-P8-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 810, records: ["chat:c1", "chat:c2"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "page", payload: { width: "desktop", by: sam.email } },
    { kind: "event", name: "page", payload: { width: "phone", by: sam.email } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: [],
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse has no group control at all (B-P8-10; step-1-dom.md, step-8-dom.md).",
});

export default task;
