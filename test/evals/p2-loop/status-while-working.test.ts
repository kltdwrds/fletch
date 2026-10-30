// T-P2-04 under vitest (F24): Sam's turn runs on the production engine with the scripted fake; its one tool, the
// test-host `web_search`, holds until the test lets it go, so the shipped page script is read while the tool runs. The
// page is given exactly the frames Sam's socket received, in order; the status line is the page's, from `status`
// frames worded by its own table (`http/app/thread-work.ts`). As the task's turns are only the tool's status and the
// turn's end, the scripted model ends the turn with no words.
import { describe, expect, it } from "vitest";
import { STEP_WORDS } from "../../../packages/agent/src/chat/activity-steps.ts";
import { STATUS_WORDS } from "../../../packages/agent/src/http/app/thread-work.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { webNamespace } from "../../support/p2-fixtures.ts";
import { runTask, type TaskHarness, type Turn } from "../../support/task.ts";
import { page } from "../../workers/support/page-harness.ts";
import { authorityWorld } from "../../workers/support/authority-world.ts";
import { anchorsOf, fileCardsOf, P2Tier1World, type Page, sam, statusOf } from "./harness.ts";
import type { Drawn, LoopPageWorld, Working } from "./page-world.ts";
import task, { TOOL } from "./status-while-working.task.ts";
import type { Entry, Frame } from "./world.ts";

const PROMPT = "Search the web for the Cloudflare docs page about Durable Object alarms and give me the link.";
const SCRIPT: FakeStep[] = [{ toolCall: { name: TOOL, arguments: { query: "durable object alarms" } } }, { text: "" }];

type Plant = (js: string) => string;

class StatusWorld implements LoopPageWorld {
  readonly chat: P2Tier1World;
  readonly p: Page;
  private relayed = 0;
  private readonly given: Frame[] = [];
  private readonly observed: ReturnType<LoopPageWorld["seen"]> = [];
  /** Settles when the tool starts running; `release` lets it return. */
  readonly running: Promise<void>;
  release: () => void = () => {};
  private sent: Promise<unknown> | null = null;
  private readonly keep: (f: Frame) => boolean;

  private constructor(chat: P2Tier1World, p: Page, running: Promise<void>, keep: (f: Frame) => boolean) {
    this.chat = chat;
    this.p = p;
    this.running = running;
    this.keep = keep;
  }

  /** `plant` rewrites the shipped page script; `keep` drops frames on the way to the page. */
  static async open(o: { plant?: Plant; keep?: (f: Frame) => boolean } = {}): Promise<StatusWorld> {
    let started: () => void = () => {};
    const running = new Promise<void>((r) => {
      started = r;
    });
    let world: StatusWorld | null = null;
    const during = () => {
      started();
      return new Promise<void>((r) => {
        if (world) world.release = r;
      });
    };
    const chat = new P2Tier1World(authorityWorld({ script: SCRIPT, stores: true, namespaces: () => [webNamespace(during)] }));
    await chat.open("c1");
    await chat.w.host(sam.email).memory.standingFiles();
    const p = await page({ onSend() {} }, {}, o.plant);
    const s = p.sockets[0] as NonNullable<Page["sockets"][0]>;
    p.open(s);
    p.deliver(s, { type: "history", ...chat.chat("c1").history() });
    world = new StatusWorld(chat, p, running, o.keep ?? (() => true));
    return world;
  }

  /** Gives the page every frame Sam's socket received since the last relay. */
  relay() {
    const all = this.chat.frames("c1");
    for (const f of all.slice(this.relayed)) {
      if (!this.keep(f)) continue;
      this.given.push(f);
      this.p.deliver(this.p.sockets[0] as NonNullable<Page["sockets"][0]>, f);
    }
    this.relayed = all.length;
  }
  /** Sam sends; the turn runs until its tool is running. */
  async start() {
    this.sent = this.chat.chat("c1").send({ person: sam.email, text: PROMPT });
    await this.running;
    this.relay();
  }
  /** The tool returns and the turn ends. */
  async finish() {
    this.release();
    await this.sent;
    await this.chat.chat("c1").settled();
    this.relay();
  }
  note(after: string) {
    this.observed.push({ after, working: this.working(), drawn: this.drawn().length, anchors: this.anchors().length, cards: this.fileCards().length });
  }

  drawn(): Drawn[] {
    return this.p.log.children
      .filter((n) => n.className.startsWith("m "))
      .map((n) => ({ kind: n.className.split(" ")[1] ?? "", text: (n as typeof n & { bubble?: typeof n }).bubble?.text() ?? n.text(), reactions: [] }));
  }
  stored(): Entry[] {
    return this.chat.chat("c1").history().entries as Entry[];
  }
  toolRows() {
    return this.chat.rows().filter((r) => r.role === "toolResult").map((r) => ({ tool: r.tool ?? "", text: r.text }));
  }
  working(): Working {
    return { dots: statusOf(this.p) !== null, status: statusOf(this.p), stop: !this.p.byId("stop").hidden };
  }
  frames(): Frame[] {
    return [...this.given];
  }
  seen() {
    return [...this.observed];
  }
  anchors() {
    return anchorsOf(this.p);
  }
  fileCards() {
    return fileCardsOf(this.p);
  }
  /** Page only: the chat's record is graded by the P2 world's tasks. */
  snapshot() {
    return { journal: [], vault: [], r2: [] };
  }
}

async function play(world: StatusWorld, turn: Turn) {
  if (turn.kind !== "event") throw new Error(`P2_TURN_UNSUPPORTED: ${turn.kind}`);
  if (turn.name === "status") await world.start();
  else if (turn.name === "turn_done") await world.finish();
  else throw new Error(`P2_TURN_UNSUPPORTED: ${turn.name}`);
  world.note(turn.name);
}

const harness: TaskHarness<StatusWorld> = { setup: () => StatusWorld.open(), play: (world, turn) => play(world, turn) };

describe("[F24] P2 loop: a status names the running tool's work in words and goes when the turn ends", () => {
  runTask(task as never, harness);
});

describe("[F24] T-P2-04's status line, planted", () => {
  const grader = (name: string) => task.graders.find((g) => g.name === name)!.check as (w: LoopPageWorld) => boolean;
  const both = async (o: Parameters<typeof StatusWorld.open>[0]) => {
    const w = await StatusWorld.open(o);
    for (const t of task.turns) await play(w, t);
    return w;
  };

  it("the line is the table's words for the tool, sent as the tool started, and it goes when the tool returns", async () => {
    const w = await StatusWorld.open();
    await play(w, task.turns[0] as Turn);
    expect(w.working().status).toBe(STATUS_WORDS[TOOL]);
    expect(w.frames().filter((f) => f.type === "status")).toEqual([expect.objectContaining({ tool: TOOL })]);
    await play(w, task.turns[1] as Turn);
    expect(w.frames().filter((f) => f.type === "status").map((f) => f.tool)).toEqual([TOOL, null]);
    expect(w.drawn().map((d) => d.kind)).toEqual(["you"]);
    expect(w.working().status).toBeNull();
  });

  it("a page that words the line by the tool's identifier fails the status grader", async () => {
    const w = await both({ plant: (js) => js.replace("STATUS[tool] : STATUS_OTHER", "tool : tool") });
    expect(w.seen()[0]?.working.status).toBe(TOOL);
    expect(grader("while the tool runs a status names the activity in words and no bubble is drawn")(w)).toBe(false);
  });

  it("with no status frames the page draws no line while the tool runs: the turn looks dead", async () => {
    const w = await both({ keep: (f) => f.type !== "status" });
    expect(grader("while the tool runs a status names the activity in words and no bubble is drawn")(w)).toBe(false);
  });

  it("a line kept outside the thinking slot outlives the turn: status_outlives_turn", async () => {
    const w = await both({ plant: (js) => js.replace('thinking = add("shimmer working", "");', 'const kept = add("shimmer working", "");').replace("thinking.append(line);", "kept.append(line);") });
    expect(grader("status_outlives_turn")(w)).toBe(true);
  });

  it("a tool the table does not name is \"Working\", and the harness's own send_to_user draws no line", async () => {
    const w = await StatusWorld.open();
    const s = w.p.sockets[0] as NonNullable<Page["sockets"][0]>;
    w.p.deliver(s, { type: "status", turn: "t", tool: "constructor" });
    expect(w.working().status).toBe("Working");
    w.p.deliver(s, { type: "status", turn: "t", tool: "send_to_user" });
    expect(w.working().status).toBeNull();
  });

  it("every tool the activity steps word has a status line in words, never an identifier", () => {
    expect(Object.keys(STEP_WORDS).filter((t) => !(t in STATUS_WORDS))).toEqual([]);
    expect(Object.entries(STATUS_WORDS).filter(([, words]) => /[_.]/.test(words) || !/^[A-Z]/.test(words))).toEqual([]);
  });
});
