// T-P2-11 under vitest: the history is made by the production engine with the fake model (three of Sam's turns), the
// chat object is evicted, and the shipped page script draws what the rebuilt object sends on open (the `history`
// frame), under the page harness's DOM.
import { describe, expect, it } from "vitest";
import type { FakeStep } from "../../support/fake-model.ts";
import { Seeded } from "../../support/seeded.ts";
import { runTask, type TaskHarness, type Turn } from "../../support/task.ts";
import { page } from "../../workers/support/page-harness.ts";
import { type P2Tier1World, p2Harness, sam } from "./harness.ts";
import type { Drawn, LoopPageWorld, Working } from "./page-world.ts";
import task from "./reload-persists.task.ts";
import type { Entry, Frame } from "./world.ts";

type Page = Awaited<ReturnType<typeof page>>;
type Node = Page["log"];

const lookups = (from: number): FakeStep => ({ toolCalls: [0, 1, 2].map((i) => ({ name: "steps_lookup", arguments: { n: from + i } })) });
const SCRIPT: FakeStep[] = [
  { toolCall: { name: "react", arguments: { emoji: "👍" } } },
  lookups(1),
  lookups(4),
  { toolCall: { name: "send_to_user", arguments: { text: "Method: I looked up all six folders." } } },
  { text: "Result: 24 files, 12 of them .md." },
  { toolCall: { name: "tool_search", arguments: { load: ["files"] } } },
  { toolCall: { name: "file_read", arguments: { path: "p2-missing-file.md" } } },
  { text: "There is no file named p2-missing-file.md, so there is nothing to read." },
  { toolCall: { name: "tool_search", arguments: { query: "print", load: ["print"] } } },
  { toolCall: { name: "print_thread", arguments: {} } },
  { text: "I can't print from here: this deploy reaches no printer. I can save the thread as a file instead." },
];
const PROMPTS = ["Count the files in my six folders by extension; tell me how first.", "read p2-missing-file.md", "print this thread"];

const nodes = (p: Page): Node[] => p.log.children.filter((n) => n.className.startsWith("m "));
const all = (n: Node): Node[] => [n, ...n.children.flatMap(all)];

class ReloadWorld implements LoopPageWorld {
  private p: Page | null = null;
  private history: Entry[] = [];
  private readonly given: Frame[] = [];
  private readonly observed: ReturnType<LoopPageWorld["seen"]> = [];
  private readonly chat: P2Tier1World;
  constructor(chat: P2Tier1World) {
    this.chat = chat;
  }

  static async open(): Promise<ReloadWorld> {
    const h = p2Harness({ fixtures: ["steps", "print"], script: SCRIPT });
    const rng = new Seeded(task.setup.seed);
    const chat = await h.setup(rng, task as never);
    for (const text of PROMPTS) await h.play(chat, { kind: "prompt", by: sam.email, text }, rng);
    return new ReloadWorld(chat);
  }

  async reload() {
    this.chat.harness().evict();
    const snapshot = this.chat.chat().history();
    this.history = snapshot.entries as Entry[];
    this.p = await page({ onSend() {} });
    const s = this.p.sockets[0] as NonNullable<Page["sockets"][0]>;
    this.p.open(s);
    this.deliver({ type: "history", ...snapshot });
  }
  /** A frame given to the open page, as the socket would give it. */
  deliver(frame: Record<string, unknown>) {
    if (!this.p) throw new Error("P2_PAGE_NOT_OPEN");
    this.given.push(frame as Frame);
    this.p.deliver(this.p.sockets[0] as NonNullable<Page["sockets"][0]>, frame);
  }
  note(after: string) {
    this.observed.push({ after, working: this.working(), drawn: this.drawn().length, anchors: this.anchors().length, cards: this.fileCards().length });
  }

  drawn(): Drawn[] {
    if (!this.p) return [];
    return nodes(this.p).map((n) => {
      const bubble = (n as Node & { bubble?: Node }).bubble;
      const pill = n.children.find((c) => c.className === "reaction-pill");
      return { kind: n.className.split(" ")[1] ?? "", text: bubble ? bubble.text() : n.text(), reactions: pill ? pill.textContent.match(/\p{Extended_Pictographic}/gu) ?? [] : [] };
    });
  }
  stored(): Entry[] {
    return this.history;
  }
  toolRows() {
    return this.chat.rows().filter((r) => r.role === "toolResult").map((r) => ({ tool: r.tool ?? "", text: r.text }));
  }
  working(): Working {
    if (!this.p) return { dots: false, status: null, stop: false };
    const busy = this.p.byId("busy");
    const dots = this.p.log.children.flatMap(all).some((n) => n.className.includes("qf-dots") && !n.hidden);
    return { dots, status: busy.hidden || this.p.byId("status-row").hidden ? null : busy.text(), stop: !this.p.byId("stop").hidden };
  }
  frames(): Frame[] {
    return [...this.given];
  }
  seen() {
    return [...this.observed];
  }
  anchors() {
    return [];
  }
  fileCards() {
    return [];
  }
  /** Page only: the chat's stored record does not change on a reload. */
  snapshot() {
    return { journal: [], vault: [], r2: [] };
  }
}

async function play(world: ReloadWorld, turn: Turn) {
  if (turn.kind !== "event") throw new Error(`P2_TURN_UNSUPPORTED: ${turn.kind}`);
  if (turn.name === "reload") await world.reload();
  else if (turn.name !== "scroll_top") throw new Error(`P2_TURN_UNSUPPORTED: ${turn.name}`);
  world.note(turn.name);
}

const harness: TaskHarness<ReloadWorld> = { setup: () => ReloadWorld.open(), play: (world, turn) => play(world, turn) };

describe("[F23] P2 loop: a reload draws every stored thing once and nothing running", () => {
  runTask(task as never, harness);
});

describe("[F23] T-P2-11's graders, planted", () => {
  const grader = (name: string) => task.graders.find((g) => g.name === name)!.check as (w: LoopPageWorld) => boolean;

  it("the reload draws the seven stored messages with the 👍, and nothing running", async () => {
    const world = await ReloadWorld.open();
    await world.reload();
    expect(world.drawn().map((d) => [d.kind, d.reactions.join("")])).toEqual([["you", "👍"], ["agent", ""], ["agent", ""], ["you", ""], ["agent", ""], ["you", ""], ["agent", ""]]);
    expect(world.toolRows()).toHaveLength(12);
  });

  it("a history that says a turn still runs leaves the status and stop drawn: optimistic_left", async () => {
    const world = await ReloadWorld.open();
    await world.reload();
    world.deliver({ type: "history", entries: world.stored(), running: { turn: "t-planted" } });
    expect(grader("optimistic_left")(world)).toBe(true);
  });

  it("a tool row's words drawn as a message are tool_row_drawn", async () => {
    const world = await ReloadWorld.open();
    await world.reload();
    world.deliver({ type: "message", turn: "t-planted", text: "step 1: 4 files, 2 of them .md" });
    expect(grader("tool_row_drawn")(world)).toBe(true);
  });
});
