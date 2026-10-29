// T-P1-08 under vitest: the shipped page script under the page harness's DOM (no Chromium: the graders read roles
// and labels, which are DOM; the M29.4 Chromium suite covers geometry), one page per width, Sam's history of three
// messages delivered by hand. The task is known to fail against shipped code on one leg (Translation, delta 6): the
// phone sheet under Sam's own message offers reactions. The first test records that failure by its minefield's name,
// so the day the sheet is fixed it fails and asks to be turned into a plain `runTask`; the second holds every other
// grader to passing now.
import { describe, expect, it } from "vitest";
import { REACTIONS } from "../../../packages/agent/src/chat/reactions.ts";
import { MESSAGE_MARKUP, MESSAGE_TEXT } from "../../../packages/agent/src/http/app/message-actions.ts";
import { Seeded } from "../../support/seeded.ts";
import { executeTask, type TaskHarness, type Turn } from "../../support/task.ts";
import { type El, page } from "../../workers/support/page-harness.ts";
import type { PageWorld, Picker, Sheet } from "./page-world.ts";
import task, { HISTORY, SIX, WORDS } from "./surface-controls.task.ts";

type Page = Awaited<ReturnType<typeof page>>;

/** The sheet's static rows keep no text under the harness's DOM; their words are checked against the markup once. */
const ROWS: Array<[id: string, word: string]> = [
  ["msg-reply", WORDS.reply],
  ["msg-copy-row", WORDS.copy],
];
function checkWords() {
  const same = { react: MESSAGE_TEXT.react, reply: MESSAGE_TEXT.reply, copy: MESSAGE_TEXT.copy, reactions: MESSAGE_TEXT.reactions, reactWith: MESSAGE_TEXT.reactWith, moreReactions: MESSAGE_TEXT.moreReactions };
  if (JSON.stringify(same) !== JSON.stringify(WORDS)) throw new Error(`P1_WORDS_DRIFT: ${JSON.stringify({ page: same, task: WORDS })}`);
  const six = REACTIONS.map(([, label]) => MESSAGE_TEXT.reactWith + label);
  if (JSON.stringify(six) !== JSON.stringify(SIX)) throw new Error(`P1_REACTIONS_DRIFT: ${JSON.stringify({ page: six, task: SIX })}`);
  for (const [id, word] of ROWS) if (!MESSAGE_MARKUP.includes(`<button id="${id}" class="qf-srow"><span class="tx">${word}</span>`)) throw new Error(`P1_ROW_DRIFT: ${id} is not "${word}"`);
}

const label = (b: El) => b.attrs["aria-label"] ?? "";

class SurfaceWorld implements PageWorld {
  private readonly pickers = new Map<string, Picker>();
  private readonly sheets = new Map<string, Sheet>();
  private readonly desktop: Page;
  private readonly phone: Page;
  constructor(desktop: Page, phone: Page) {
    this.desktop = desktop;
    this.phone = phone;
  }
  static async open(): Promise<SurfaceWorld> {
    checkWords();
    const at = async (layout: { desktop?: boolean }) => {
      const p = await page({ onSend() {} }, layout);
      const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
      p.open(s);
      p.deliver(s, { type: "history", running: null, entries: HISTORY.map((h, i) => ({ ...h, id: h.kind === "you" ? `s${i}` : undefined, at: i + 1 })) });
      return p;
    };
    return new SurfaceWorld(await at({ desktop: true }), await at({}));
  }
  private node(p: Page, mid: string): El | undefined {
    return p.log.children.find((c) => c.dataset.mid === mid);
  }
  private row(mid: string): El | undefined {
    return this.node(this.desktop, mid)?.children.find((c) => c.className.startsWith("acts"))?.children[0];
  }
  hover(mid: string) {
    // The row is in the DOM; a hover reveals it (CSS, M29.4), which this DOM cannot show. Hovering a message not drawn is the fault it would be in a browser.
    if (!this.node(this.desktop, mid)) throw new Error(`P1_NO_MESSAGE: ${mid}`);
  }
  openPicker(mid: string) {
    const react = this.row(mid)?.children.find((b) => label(b) === WORDS.react);
    if (!react) throw new Error(`P1_NO_REACT_CONTROL: ${mid}`);
    react.onclick?.();
    const acts = this.node(this.desktop, mid)?.children.find((c) => c.className.startsWith("acts"));
    const box = acts?.children.find((c) => c.className === "qf-react");
    if (!box) throw new Error(`P1_NO_PICKER: ${mid}`);
    this.pickers.set(mid, { role: box.attrs.role ?? "", label: label(box), controls: box.children.map((b) => ({ label: label(b), disabled: b.disabled })) });
  }
  openMore(mid: string) {
    const p = this.phone;
    const more = this.node(p, mid)?.children.find((c) => c.className.includes("msg-more"));
    if (!more) throw new Error(`P1_NO_MORE_CONTROL: ${mid}`);
    more.onclick?.();
    const emojis = p.byId("msg-emos").children.map(label).filter((l) => l.startsWith(WORDS.reactWith));
    const rows = ROWS.filter(([id]) => p.document.getElementById(id) !== null).map(([, word]) => word);
    this.sheets.set(mid, { form: p.byId("msg-actions").dataset.form ?? "", emojis, rows });
    p.key("Escape");
  }
  hoverRow(mid: string) {
    const row = this.row(mid);
    return row ? row.children.map(label) : null;
  }
  picker(mid: string) {
    return this.pickers.get(mid) ?? null;
  }
  sheet(mid: string) {
    return this.sheets.get(mid) ?? null;
  }
  snapshot() {
    return { journal: [], vault: [], r2: [] };
  }
}

const widths: Record<string, "desktop" | "phone"> = { "1440": "desktop", "390": "phone" };

async function play(world: SurfaceWorld, turn: Turn) {
  if (turn.kind !== "event") throw new Error(`P1_TURN_UNSUPPORTED: ${turn.kind}`);
  const mid = turn.payload?.mid;
  const width = widths[turn.payload?.width ?? ""];
  if (!mid || !width) throw new Error(`P1_TURN_PAYLOAD: ${JSON.stringify(turn.payload)}`);
  if (turn.name === "hover" && width === "desktop") return world.hover(mid);
  if (turn.name === "open_picker" && width === "desktop") return world.openPicker(mid);
  if (turn.name === "open_more" && width === "phone") return world.openMore(mid);
  throw new Error(`P1_TURN_UNSUPPORTED: ${turn.name} at ${turn.payload?.width}`);
}

const harness: TaskHarness<SurfaceWorld> = { setup: () => SurfaceWorld.open(), play: (world, turn) => play(world, turn) };

describe("[F20] finding: a person can react to their own message at phone width (Translation delta 6, F21)", () => {
  it("T-P1-08 steps on react_on_own_message: the sheet under Sam's own message offers reactions", async () => {
    await expect(executeTask(task, harness)).rejects.toThrow(/react_on_own_message/);
  });

  it("every other grader of T-P1-08 passes on the shipped page", async () => {
    const world = await harness.setup(new Seeded(task.setup.seed), task);
    for (const turn of task.turns) await harness.play(world, turn, new Seeded(task.setup.seed));
    for (const g of task.graders) if (g.kind !== "minefield") expect(await g.check(world), g.name).toBe(true);
  });
});
