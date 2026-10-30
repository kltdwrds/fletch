// The tier-1 harness of the P12 tasks (F38): P9's world (`P9Tier1World`: Sam's real `ChatEngine` chats `c1` and `c2`,
// the real gate, cards, grants, journal and Ledger, the real jobs, sub-agents and Activity routes, Sam's real Vault with
// the hold for a secret typed in chat, the fake browser and the one scripted fake model) composed with what P15, P7 and
// P3 bring to a purchase (delta 4): the authority world's fixture `shop_buy` (a purchase with an amount, EUR unless the
// call names a currency), the decide route as Sam's page posts it, `/api/grants` as Sam, a job whose model step the
// runner holds to its read tools, and a sub-agent offered `shop_buy` for its gate to refuse. The fake browser serves a
// checkout page at `shop.example.com`; `shop.example.invalid` is absent, so a read of it is `BROWSE_UNREACHABLE`.
// Turns, beside P9's, P3's and P5's:
//   - `look`: Sam reads the chat's cards and the Approvals tab; the world keeps what she saw;
//   - `card` (payload `choice`): Sam decides the chat's newest card with `choice` through the decide route;
//   - `post-grant`: Sam posts a standing purchase grant (auto, $20) to `/api/grants`;
//   - `commit-again`: the first purchase effect that ran is committed again under its own effect id, and under a new
//     one, through Sam's real `PersonAuthority`, as a retried or a second effect would be.
import type { CardRow } from "../../../packages/agent/src/chat/cards.ts";
import { renderCard } from "../../../packages/agent/src/chat/cards.ts";
import type { Descriptor } from "../../../packages/agent/src/grants/types.ts";
import type { Namespace } from "../../../packages/agent/src/tools/registry.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { type P9HarnessOptions, P9Tier1World, pat, sam } from "../p9-connectors/harness.ts";
import type { CardWords, ChatLabel, Commit, Decided, GrantRow, JournalView, P12World, StepRow } from "./world.ts";
import { SHOP } from "./world.ts";

export { pat, sam };

export interface P12HarnessOptions {
  script: FakeStep[];
  /** Runs before the snapshot, after `c1` and `c2` are open: the task's setup records. */
  seed?: (w: P12Tier1World) => Promise<void>;
  /** Rewrites the shipped page script before the tabs run it (`planted.test.ts`). */
  plant?: P9HarnessOptions["plant"];
}

/** What a child was offered for its gate to refuse: the same purchase as the chat's fixture. Records a run, which none may have. */
const childShop = (ran: string[]): Namespace => ({
  name: "shop",
  description: "the shop fixture, offered to a child",
  deferral: "eager",
  tools: [
    {
      name: "shop_buy",
      kind: "action",
      label: "buy",
      description: "Fixture: buy something.",
      parameters: { type: "object", properties: {} } as never,
      actionKind: "purchase",
      purchase: true,
      subject: () => ({ scope: "personal", connector: "shop" }),
      amount: (a: Record<string, unknown>) => ({ value: Number(a.amount ?? 0), currency: typeof a.currency === "string" ? a.currency : "EUR" }),
      execute: async () => {
        ran.push("shop_buy");
        return { content: [{ type: "text" as const, text: "bought" }], details: {} };
      },
    },
  ],
});

const asText = (v: unknown) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : v);
const rowsOf = (h: { rows: (q: string) => Record<string, unknown>[] }) =>
  h.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").flatMap((t) => h.rows(`SELECT * FROM "${String(t.name)}"`).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, asText(v)]))));

export class P12Tier1World extends P9Tier1World implements P12World {
  postedGrant: P12World["postedGrant"] = null;
  looked: P12World["looked"] = null;
  private readonly decided: Decided[] = [];
  private readonly committed: Commit[] = [];
  private readonly proposed: ReturnType<P12World["proposals"]> = [];
  private readonly descriptors: Descriptor[] = [];
  /** What a child's `shop_buy` ran: nothing, while its gate holds. */
  readonly childRan: string[] = [];

  constructor(o: P12HarnessOptions) {
    const ran: string[] = [];
    super({ script: o.script, ...(o.plant ? { plant: o.plant } : {}), sites: { "shop.example.com": { page: { title: "Checkout", text: `Your cart: one ${"p12 probe"} at 12.00 USD. Card number, expiry and security code below. Pay now.` } } }, childTools: () => [childShop(ran)] });
    this.childRan = ran;
    // Every descriptor the gate commits, so an effect can be committed again as it was (T-P12-03).
    this.w.hooks.beforeCommit = (d) => void this.descriptors.push(d);
  }

  async play(turn: Turn): Promise<void> {
    const before = new Set(this.cardWords().map((c) => c.id));
    await this.step(turn);
    // The gate's answer for each purchase card this turn raised, resolved again now, before anything else changes.
    for (const c of (this.engine("c1") as unknown as { cards: { list(): CardRow[] } }).cards.list()) {
      if (before.has(c.id) || c.descriptor.actionKind !== "purchase") continue;
      const r = await this.w.host(sam.email).authority.decide(c.descriptor);
      this.proposed.push({ card: c.id, amount: `${c.descriptor.amount?.value} ${c.descriptor.amount?.currency}`, decision: r.decision, code: "code" in r ? (r.code ?? null) : null });
    }
  }

  private async step(turn: Turn): Promise<void> {
    if (turn.kind !== "event") return super.play(turn);
    const p = (turn.payload ?? {}) as Record<string, string>;
    const chat = (p.chat as ChatLabel | undefined) ?? "c1";
    if (turn.name === "look") {
      this.looked = { chat: this.cardWords(chat), tab: await this.approvalsTab(), effects: this.ranEffects().length };
    } else if (turn.name === "card") {
      const card = this.cardWords(chat).at(-1)?.id;
      if (!card) throw new Error("P12_NO_CARD: the chat has no card to decide");
      await this.decide(card, p.choice as string, chat);
    } else if (turn.name === "post-grant") {
      const r = await this.w.http(sam.email, "POST", "/api/grants", { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "purchase" }, mode: "auto", constraints: { max_amount: { value: 20, currency: "USD" } }, created_from: "chat-confirmation" });
      this.postedGrant = { status: r.status, code: typeof r.body.code === "string" ? r.body.code : null };
    } else if (turn.name === "return") {
      // Sam finishes in the Live View and hands the page back (the fake's `completeHandoff`).
      for (const h of this.browser.handoffs) this.browser.completeHandoff(h.session);
    } else if (turn.name === "commit-again") {
      const done = (await this.ledgerJournal()).find((r) => r.actionKind === "purchase" && r.outcome === "DONE");
      const d = this.descriptors.find((x) => x.actionKind === "purchase");
      if (!done || !d) throw new Error("P12_NOTHING_COMMITTED: no purchase effect ran");
      const authority = this.w.host(sam.email).authority;
      for (const effect of [done.id, `${this.chatId(chat)}:p12-second-effect`]) {
        const r = await authority.commit({ ...d, at: this.w.clock.now }, effect);
        this.committed.push({ effect: effect === done.id ? "first" : "new", decision: r.decision, code: "code" in r ? (r.code ?? null) : null });
      }
    } else return super.play(turn);
  }

  /** Sam's decision on a card through the decide route as her page posts it. */
  async decide(card: string, choice: string, chat: ChatLabel = "c1"): Promise<Decided> {
    type R = { ok: boolean; outcome?: string; code?: string; text?: string; again?: true };
    const r = ((await this.w.http(sam.email, "POST", `/chats/${this.chatId(chat)}/cards/decide`, { ids: [card], choice })).body.results as R[] | undefined)?.[0] ?? { ok: false, code: "P12_NO_ANSWER" };
    await this.engine(chat).settled();
    const d: Decided = { card, choice, ok: r.ok, ...(r.code ? { code: r.code } : {}), ...(r.text ? { text: r.text } : {}), ...(r.outcome ? { outcome: r.outcome } : {}), ...(r.again ? { again: true } : {}) };
    this.decided.push(d);
    return d;
  }

  cardWords(chat: ChatLabel = "c1"): CardWords[] {
    const rows = (this.engine(chat) as unknown as { cards: { list(): CardRow[] } }).cards.list();
    return rows.map((c) => {
      const v = renderCard(c, (e) => (e === sam.email ? sam.name : e), c.tool.replaceAll("_", " "));
      return { id: c.id, tool: c.tool, kind: c.descriptor.actionKind, state: c.state, outcome: c.outcome, grantId: c.grantId, lines: v.lines, choices: v.choices.map((x) => x.label), proposed: v.proposed, decidedAt: c.decidedAt };
    });
  }

  async approvalsTab() {
    const r = await this.w.http(sam.email, "GET", "/app/approvals");
    const cards = (r.body.cards ?? []) as Array<{ id: string; lines?: string[]; choices?: Array<{ label: string }> }>;
    return cards.map((c) => ({ id: c.id, lines: c.lines ?? [], choices: (c.choices ?? []).map((x) => x.label) }));
  }

  decisions(): Decided[] {
    return [...this.decided];
  }

  grantRows(): GrantRow[] {
    return this.w
      .host(sam.email)
      .authority.all()
      .map((g) => ({ id: g.id, subject: `${g.subject.kind}:${g.subject.ref}`, mode: g.mode, oneShot: g.one_shot === true, usedAt: g.used_at ?? null, createdFrom: g.created_from, maxAmount: g.constraints.max_amount ?? null }));
  }

  ranEffects() {
    return this.w.performed.map((e) => {
      const [, tool, ...rest] = e.split(":");
      return { tool: tool as string, args: JSON.parse(rest.join(":")) as Record<string, unknown> };
    });
  }

  async ledgerJournal(): Promise<JournalView[]> {
    return (await this.w.journal()).map((r) => ({ id: r.id, actionKind: r.actionKind, decision: r.decision, outcome: r.outcome, grantId: r.grantId, fields: Object.keys(r), raw: JSON.stringify(r) }));
  }

  commits(): Commit[] {
    return [...this.committed];
  }

  proposals() {
    return [...this.proposed];
  }

  jobCalls() {
    return this.w.jobIds(sam.email).flatMap((id) => this.w.jobOf(sam.email, id).rows("SELECT tool, ok, code FROM tool_calls ORDER BY run_id, step, n").map((r) => ({ tool: String(r.tool), ok: Number(r.ok) === 1, code: r.code === null ? null : String(r.code) })));
  }

  async steps(chat: ChatLabel = "c1"): Promise<StepRow[]> {
    const out: StepRow[] = [];
    for (const t of (await this.activity()).tasks.filter((x) => x.chat === chat)) {
      for (const s of (await this.task(chat, t.id)).steps.filter((x) => x.kind !== "summary")) out.push({ task: t.id, tool: s.tool, title: s.title, state: s.state, code: s.code });
    }
    return out;
  }

  handoffs() {
    return this.browser.handoffs.map((h) => ({ ...h, link: `https://live.fixture.example/view/${h.session}-token` }));
  }

  async storesText(): Promise<string> {
    const person = this.w.personHarness(sam.email);
    const files = await Promise.all([...this.w.r2.objects.keys()].map(async (k) => `${k}\n${(await (await this.w.r2.get(k))?.text()) ?? ""}`));
    return JSON.stringify(person ? rowsOf(person) : []) + files.join("\n");
  }
}

export function p12Harness(o: P12HarnessOptions): TaskHarness<P12World> {
  return {
    setup: async () => {
      const w = new P12Tier1World(o);
      await w.open();
      await o.seed?.(w);
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P12Tier1World).play(turn),
  };
}

/** The task's turns played through `p12Harness(o)`, and the world after them. */
export async function played(task: DefinedTask<P12World>, o: P12HarnessOptions, turns = task.turns): Promise<P12Tier1World> {
  const h = p12Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task)) as P12Tier1World;
  for (const t of turns) await h.play(world, t, rng);
  return world;
}

/** Each grader's verdict on the task's turns: true where an end state or fact holds and where a minefield was not stepped on. */
export async function graded(task: DefinedTask<P12World>, o: P12HarnessOptions): Promise<Record<string, boolean>> {
  const world = await played(task, o);
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}

/** The checkout page Sam asks the agent to pay on (T-P12-07). */
export { SHOP };
