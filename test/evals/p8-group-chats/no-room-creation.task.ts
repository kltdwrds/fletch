// T-P8-10 (B-P8-10): the owner's app has no "Add people", "New group" or invite control at either width, and the chat
// list holds only the kinds fletch makes (main, side, request, mail): a room appears only from a connected channel, and
// this deploy connects none (D-0025 door 1). Read in hermetic Chromium at 1280 and 390 (`harness-browser.ts`, Q60): the
// rendered DOM's controls, each menu the page offers opened, the kind of every chat row drawn (live and archived), and
// every kind in the chat list the page was answered with.
import people from "../../fixtures/people.json" with { type: "json" };
import { defineTask, type Grader } from "../../support/task.ts";
import type { P8World } from "./world.ts";
import { ROOM_CONTROL } from "./world.ts";

const sam = people.people.find((p) => p.id === "sam-solo")!;
const KINDS = ["mail", "main", "request", "side"];

const graders: Grader<P8World>[] = [
  { name: "the page was drawn at 1280 and 390 with its controls and its chat rows", kind: "end_state", check: (w) => w.pages.map((p) => p.width).join() === "1280,390" && w.pages.every((p) => p.controls.length > 0 && p.kinds.length > 0) },
  { name: "no control at either width adds people, makes a group or invites", kind: "end_state", check: (w) => w.pages.every((p) => !p.controls.some((c) => ROOM_CONTROL.test(c))) },
  { name: "the chat list holds only the kinds fletch makes, none a room", kind: "end_state", check: (w) => w.pages.every((p) => [...p.kinds, ...p.listed].every((k) => KINDS.includes(k))) },
  { name: "add_people_control", kind: "minefield", check: (w) => w.pages.some((p) => p.controls.some((c) => ROOM_CONTROL.test(c))) },
  { name: "agent_opened_room", kind: "minefield", check: (w) => w.pages.some((p) => [...p.kinds, ...p.listed].some((k) => !KINDS.includes(k))) },
];

export const task = defineTask<P8World>({
  id: "T-P8-10",
  cluster: "P8",
  clauses: ["B-P8-10"],
  priority: "must-have",
  tier: 1,
  setup: { seed: 810, records: ["chat:c1", "chat:c2"], files: [], jobs: [] },
  turns: [
    { kind: "event", name: "page", payload: { width: "1280", by: sam.email } },
    { kind: "event", name: "page", payload: { width: "390", by: sam.email } },
  ],
  end_state: graders.filter((g) => g.kind === "end_state").map((g) => g.name),
  required_facts: [],
  minefields: graders.filter((g) => g.kind === "minefield").map((g) => g.name),
  collateral: {},
  graders,
  reference: "Muse has no group control at all (B-P8-10; step-1-dom.md, step-8-dom.md).",
});

export default task;
