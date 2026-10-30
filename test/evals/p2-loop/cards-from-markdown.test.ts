// T-P2-10 under vitest (F24): two of Sam's turns on the production engine with the scripted fake leave two agent
// messages in c1, one with a link to a URL and one with a link to her stored file; the shipped page script draws the
// chat's history, and again after the chat object is evicted and rebuilt. The page reads a card's preview through the
// app's own `/app/file` route, as Sam's browser would.
import { describe, expect, it } from "vitest";
import type { FakeStep } from "../../support/fake-model.ts";
import { runTask, type TaskHarness, type Turn } from "../../support/task.ts";
import task, { BODIES, FILE, URL } from "./cards-from-markdown.task.ts";
import { anchorsOf, drawn, fileCardsOf, type P2Tier1World, type Page, p2Harness, sam, settledReads } from "./harness.ts";
import type { Drawn, LoopPageWorld, Working } from "./page-world.ts";
import type { Entry, Frame } from "./world.ts";

const CONTENT = "Step 5 barrier line.\nThe barrier holds.\nline 3\nline 4\nline 5\n";
const SCRIPT: FakeStep[] = BODIES.map((text) => ({ text }));
const PROMPTS = ["Where is the P2 guide?", `Show me ${FILE}.`];

type Plant = (js: string) => string;

class CardsWorld implements LoopPageWorld {
  readonly chat: P2Tier1World;
  p: Page | null = null;
  private history: Entry[] = [];
  private readonly observed: ReturnType<LoopPageWorld["seen"]> = [];
  private readonly plant?: Plant;
  constructor(chat: P2Tier1World, plant?: Plant) {
    this.chat = chat;
    this.plant = plant;
  }

  static async open(o: { plant?: Plant; script?: FakeStep[] } = {}): Promise<CardsWorld> {
    const h = p2Harness({
      script: o.script ?? SCRIPT,
      seed: async (w) => {
        const r = await w.w.host(sam.email).files.write({ path: FILE, text: CONTENT }, { requester: sam.email, writer: `person:${sam.email}` });
        if (!r.ok) throw new Error(`P2_FILE_NOT_WRITTEN: ${r.code}`);
      },
    });
    const chat = await h.setup(null as never, task as never);
    for (const text of PROMPTS) await h.play(chat, { kind: "prompt", by: sam.email, text }, null as never);
    return new CardsWorld(chat, o.plant);
  }

  /** The page's reads go to the app's routes as Sam (the card's preview, `GET /app/file`). */
  private readonly fetch = async (path: string) => {
    if (!path.startsWith("/app/file?")) return null;
    const r = await this.chat.w.http(sam.email, "GET", path);
    return new Response(JSON.stringify(r.body), { status: r.status });
  };

  async render() {
    const snapshot = this.chat.chat("c1").history();
    this.history = snapshot.entries as Entry[];
    this.p = await drawn({ ...snapshot }, this.fetch, this.plant);
    await settledReads();
  }
  async reload() {
    this.chat.harness("c1").evict();
    await this.render();
  }
  note(after: string) {
    this.observed.push({ after, working: this.working(), drawn: this.drawn().length, anchors: this.anchors().length, cards: this.fileCards().length });
  }

  drawn(): Drawn[] {
    if (!this.p) return [];
    return this.p.log.children
      .filter((n) => n.className.startsWith("m "))
      .map((n) => ({ kind: n.className.split(" ")[1] ?? "", text: (n as typeof n & { bubble?: typeof n }).bubble?.text() ?? n.text(), reactions: [] }));
  }
  stored(): Entry[] {
    return this.history;
  }
  toolRows() {
    return this.chat.rows().filter((r) => r.role === "toolResult").map((r) => ({ tool: r.tool ?? "", text: r.text }));
  }
  working(): Working {
    return { dots: false, status: null, stop: this.p ? !this.p.byId("stop").hidden : false };
  }
  frames(): Frame[] {
    return [];
  }
  seen() {
    return [...this.observed];
  }
  anchors() {
    return this.p ? anchorsOf(this.p) : [];
  }
  fileCards() {
    return this.p ? fileCardsOf(this.p) : [];
  }
  /** Page only: drawing the thread changes nothing the chat stores. */
  snapshot() {
    return { journal: [], vault: [], r2: [] };
  }
}

async function play(world: CardsWorld, turn: Turn) {
  if (turn.kind !== "event") throw new Error(`P2_TURN_UNSUPPORTED: ${turn.kind}`);
  if (turn.name === "render") await world.render();
  else if (turn.name === "reload") await world.reload();
  else throw new Error(`P2_TURN_UNSUPPORTED: ${turn.name}`);
  world.note(turn.name);
}

const harness: TaskHarness<CardsWorld> = { setup: () => CardsWorld.open(), play: (world, turn) => play(world, turn) };

describe("[F24] P2 loop: a URL is a link and a stored file a card, drawn from the stored markdown", () => {
  runTask(task as never, harness);
});

describe("[F24] T-P2-10's links and cards, planted", () => {
  const grader = (name: string) => task.graders.find((g) => g.name === name)!.check as (w: LoopPageWorld) => boolean;

  it("the card opens the Library's viewer at the file and previews its first four lines; the link opens a new tab", async () => {
    const w = await CardsWorld.open();
    await w.render();
    expect(w.fileCards()).toEqual([{ name: FILE, kind: "md", href: `/library/files/${FILE}`, preview: CONTENT.split("\n").slice(0, 4).join("\n"), path: FILE }]);
    expect(w.anchors()).toEqual([{ href: URL, text: "P2 guide" }]);
    const card = (w.p as Page).log.children[3]?.children[0]?.children.find((n) => n.className.includes("qf-fcard")) as Page["log"] & { onclick: (e: unknown) => void };
    card.onclick({ preventDefault() {} });
    expect((w.p as Page).location.pathname).toBe(`/library/files/${FILE}`);
  });

  it("a page that draws the file link as its words leaves a bare path: bare_path", async () => {
    const w = await CardsWorld.open({ plant: (js) => js.replace("if (file) b.append(fileCard(file));", "if (file) b.append(m[0]);") });
    for (const t of task.turns) await play(w, t);
    expect(grader("bare_path")(w)).toBe(true);
    expect(grader("the file link is drawn as a file card with its name and kind")(w)).toBe(false);
  });

  it("a file the page cannot read keeps its card and glyph with no preview, and the code on the card", async () => {
    const w = await CardsWorld.open({ script: [{ text: "Gone: [old.md](files/old.md)." }, { text: "ok" }] });
    await w.render();
    expect(w.fileCards()).toEqual([expect.objectContaining({ name: "old.md", kind: "md", preview: null })]);
    const card = (w.p as Page).log.children.flatMap((n) => [n, ...n.children]).flatMap((n) => [n, ...n.children]).find((n) => n.className.includes("qf-fcard"));
    expect(card?.dataset.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });

  it("only an http(s) link is an anchor and only a clean store path a card; anything else stays as written", async () => {
    const odd = ["[x](javascript:alert(1))", "[y](files/../secrets.md)", "[z](files/a//b.md)", "[w](/library/files/%E0%A4%A)"];
    const w = await CardsWorld.open({ script: [{ text: odd.join(" ") }, { text: "ok" }] });
    await w.render();
    expect(w.anchors()).toEqual([]);
    expect(w.fileCards()).toEqual([]);
    // The harness DOM joins a bubble text nodes with a space.
    expect(w.drawn()[1]?.text.replace(/\s+/g, "")).toBe(odd.join("").replace(/\s+/g, ""));
  });
});
