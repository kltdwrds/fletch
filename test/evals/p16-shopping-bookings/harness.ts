// The tier-1 harness of the P16 tasks (F80): P12's world (`P12Tier1World`: Sam's real chats over P9's Vault, jobs,
// sub-agents and Activity, the fixture `shop_buy`, the handoff and the one scripted fake model) composed with the browse
// fakes for P16's four hosts (delta 5). The fake browser answers by address here, not by host alone: the shop's bottle
// list, the fare and room searches with their sale window (a date past `WINDOW_END` answers "Requested date is too far in
// the future."), and `tix.example.com` behind a 403, so a blocked read is the production path's own stop
// (`browse/classify.ts`). A job's `page_read` reaches the watched seat and rate pages through the egress module.
// It counts what the turns left: the journal, memory, jobs and grants. Turns, beside P12's:
//   - `reprice`: the shop's option 1 is re-priced (`REPRICED`), as a merchant would between two turns (G5);
//   - `drop`: the watched seats and rate drop in price before the jobs run (T-P16-08).
import { browseNamespace } from "../../../packages/agent/src/browse/tools.ts";
import type { Namespace } from "../../../packages/agent/src/tools/registry.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { type P12HarnessOptions, P12Tier1World, sam } from "../p12-wallet/harness.ts";
import type { OrderView, P16World, ReadView } from "./world.ts";
import { BOTTLES, FARES, FARE_FIELDS, REPRICED, SHOP, SHOP_HOST, STAY_WATCH, TIX_WATCH, TOO_FAR, WINDOW_END } from "./world.ts";

export { sam };

export interface P16HarnessOptions extends Pick<P12HarnessOptions, "script" | "plant"> {
  seed?: (w: P16Tier1World) => Promise<void>;
}

/** The shop's bottle list as it stands: a cookie banner, the three bottles, the terms box and "Create account". */
export const shopPage = (first: string = BOTTLES[0].price) =>
  [
    "# Stainless bottles, 1 litre",
    "We use cookies. [Accept all](https://shop.example.com/cookies/accept)",
    ...BOTTLES.map((b, i) => `- ${b.label}, stainless steel, 1 L: ${i === 0 ? first : b.price}, in stock. [${b.label}](${b.url})`),
    "[ ] I agree to the terms of sale. [Create account](https://shop.example.com/account/new)",
  ].join("\n");

const farePage = (date: string) =>
  date > WINDOW_END
    ? `# Flights SFO to JFK on ${date}\n\n${TOO_FAR}`
    : [`# Flights SFO to JFK on ${date}`, ...FARES.map((f) => `- ${f.flight}, ${f.times}, fare ${f.fare}, ${f.bags}, ${f.terms}, total ${f.total}.`), `Traveller details this fare needs: ${FARE_FIELDS.join(", ")}.`].join("\n");
const roomPage = (date: string) => (date > WINDOW_END ? `# Rooms in Manhattan from ${date}\n\n${TOO_FAR}` : `# Rooms in Manhattan from ${date}\n\n- Harbor Inn, queen room, 2 nights, total $412.00, free cancellation until 2 days before.`);

/** The browse namespace's tools a child may not run (live, handoff, fill), as the chat holds them; never executed. */
const liveLane = (): Namespace => {
  const ns = browseNamespace({ port: {} as never, memory: { get: async () => null, record: async () => {} } as never, urls: {} as never, session: { get: () => null, set: () => {} }, now: () => 0 });
  return { ...ns, name: "browse_lane", deferral: "eager", tools: ns.tools.filter((t) => ["browse_live", "browse_handoff", "browse_fill"].includes(t.name)) };
};

export class P16Tier1World extends P12Tier1World implements P16World {
  private readonly reads_: ReadView[] = [];
  private turnNo = 0;
  private first: string = BOTTLES[0].price;
  private dropped = false;

  constructor(o: P16HarnessOptions) {
    const box: { w?: P16Tier1World } = {};
    super({
      script: o.script,
      ...(o.plant ? { plant: o.plant } : {}),
      // A child is offered the live lane's tools too, so its gate, not their absence, refuses them (G1).
      childTools: () => [liveLane()],
      childUrls: [SHOP],
      sites: { [SHOP_HOST]: { page: { title: "Bottles", text: shopPage() } }, "tix.example.com": { wall: "forbidden" } },
      jobFetch: async (url) => {
        const w = box.w as P16Tier1World;
        const page = url === TIX_WATCH ? `Two seats together, row F: ${w.dropped ? "$58.00" : "$95.00"} each.` : url === STAY_WATCH ? `Harbor Inn queen room: ${w.dropped ? "$161.00" : "$206.00"} a night.` : null;
        return page === null ? new Response("no", { status: 404 }) : new Response(page, { status: 200, headers: { "content-type": "text/plain" } });
      },
    });
    box.w = this;
    // The browse fake answers by address: each page by its path and query, as P16's world serves them.
    const b = this.browser;
    const byUrl = (url: string): string | null => {
      const u = new URL(url);
      if (u.hostname === SHOP_HOST) return shopPage(this.first);
      if (u.hostname === "fly.example.com") return farePage(u.searchParams.get("date") ?? "");
      if (u.hostname === "stay.example.com") return roomPage(u.searchParams.get("checkin") ?? "");
      return null;
    };
    const read = b.read.bind(b);
    b.read = async (url, engine) => {
      const page = byUrl(url);
      const r = page === null ? await read(url, engine) : (b.reads.push({ url, engine }), { ok: true as const, status: 200, markdown: page });
      this.reads_.push({ turn: this.turnNo, url, ok: r.ok && !/Just a moment/.test("markdown" in r ? r.markdown : ""), text: "markdown" in r ? r.markdown : "" });
      return r;
    };
    const goto = b.goto.bind(b);
    b.goto = async (session, url) => {
      const r = await goto(session, url);
      if (r.ok && byUrl(r.page.url) !== null) {
        const text = byUrl(r.page.url) as string;
        this.reads_.push({ turn: this.turnNo, url: r.page.url, ok: true, text });
        return { ok: true, page: { ...r.page, text } };
      }
      return r;
    };
  }

  async play(turn: Turn): Promise<void> {
    if (turn.kind === "prompt") this.turnNo++;
    if (turn.kind === "event" && turn.name === "reprice") {
      this.first = REPRICED;
      return;
    }
    if (turn.kind === "event" && turn.name === "drop") {
      this.dropped = true;
      return;
    }
    return super.play(turn);
  }

  readLog(): ReadView[] {
    return [...this.reads_];
  }

  order(chat: Parameters<P16World["order"]>[0] = "c1"): OrderView[] {
    return this.w.chats
      .harness(this.chatId(chat))
      .rows("SELECT body FROM messages ORDER BY seq")
      .map((r) => JSON.parse(String(r.body)) as { role: string; content?: unknown; toolName?: string })
      .map((m) => {
        const parts = Array.isArray(m.content) ? (m.content as Array<{ type: string; name?: string; text?: string }>) : [];
        const calls = parts.filter((c) => c.type === "toolCall").map((c) => String(c.name));
        const text = typeof m.content === "string" ? m.content : parts.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        return { role: m.role, bubble: m.role === "assistant" && calls.length === 0 && text.trim().length > 0, calls, result: m.role === "toolResult" ? String(m.toolName ?? "") : null };
      });
  }

  async memoryText(): Promise<string> {
    const person = this.w.personHarness(sam.email);
    if (!person) return "";
    return person
      .rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%daily%'")
      .flatMap((t) => person.rows(`SELECT * FROM "${String(t.name)}"`).map((r) => JSON.stringify(r)))
      .join("\n");
  }

  jobNotices(): string[] {
    return this.notices("c1");
  }

  signedIn(): boolean {
    return this.results("c1").some((r) => /Signed in with the login kept for/.test(r.text));
  }

  async childCalls() {
    const out: Array<{ tool: string; code: string | null }> = [];
    for (const c of this.children("c1")) {
      const msgs = await this.childMessages(c.id);
      for (const m of msgs.filter((x) => x.role === "toolResult")) out.push({ tool: /\b(browse_\w+)\b/.exec(m.text)?.[1] ?? "", code: /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/.exec(m.text)?.[1] ?? null });
    }
    return out;
  }
}

export function p16Harness(o: P16HarnessOptions): TaskHarness<P16World> {
  return {
    setup: async () => {
      const w = new P16Tier1World(o);
      await w.open();
      await o.seed?.(w);
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P16Tier1World).play(turn),
  };
}

/** The task's turns played through `p16Harness(o)`, and the world after them. */
export async function played(task: DefinedTask<P16World>, o: P16HarnessOptions, turns = task.turns): Promise<P16Tier1World> {
  const h = p16Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task)) as P16Tier1World;
  for (const t of turns) await h.play(world, t, rng);
  return world;
}

/** Each grader's verdict: true where an end state or fact holds and where a minefield was not stepped on. */
export async function graded(task: DefinedTask<P16World>, o: P16HarnessOptions): Promise<Record<string, boolean>> {
  const world = await played(task, o);
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}
