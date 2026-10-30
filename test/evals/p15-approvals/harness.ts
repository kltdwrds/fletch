// The tier-1 harness of the P15 tasks (F25): `P15Tier1World` over the authority world, Sam's real `ChatEngine` chats
// with the real gate, card store, grants and journal, plus what the contract's world names: the fake egress that
// logs every request (`share_post`, `test/support/p15-fixtures.ts`), the fake browse lane (`FakeBrowser` behind the
// real browse namespace and engine memory), a real `VaultCore` holding one registered credential whose one-shot
// grant an allow-once card mints, the decide route reachable as Sam's page reaches it, and the clock movable.
//
// Turns: a `prompt` is Sam's send; an `event` is `decide` (payload `card`, `choice`, and `as: "agent"` for a decision
// from the agent's own session, which never goes through the route), `clock` (`ms` forward), `send` (a message
// Sam sends while a held turn runs) or `stop` (Sam's stop frame, then the held turn released and settled). With
// `hold`, the first prompt's turn waits at that checkpoint of the script until a `stop` event releases it.
import { connectFrame } from "../../../packages/agent/src/chat/protocol.ts";
import { answerFrame } from "../../../packages/agent/src/chat/socket.ts";
import { PersonBrowse } from "../../../packages/agent/src/browse/memory.ts";
import type { CardRow } from "../../../packages/agent/src/chat/cards.ts";
import { renderCard } from "../../../packages/agent/src/chat/cards.ts";
import type { Choice } from "../../../packages/agent/src/chat/cards.ts";
import { checkGrant } from "../../../packages/agent/src/grants/validate.ts";
import { credentialsNamespace } from "../../../packages/agent/src/vault/tools.ts";
import { VaultCore } from "../../../packages/agent/src/vault/core.ts";
import { FakeBrowser, type FakeSite } from "../../support/browser/fake-browser.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { type HarnessSocket, ObjectHarness } from "../../support/object-harness.ts";
import { stepsNamespace } from "../../support/p2-fixtures.ts";
import { type EgressRequest, shareNamespace } from "../../support/p15-fixtures.ts";
import type { Snapshot } from "../../support/scenario.ts";
import type { TaskHarness, Turn } from "../../support/task.ts";
import { seededToken } from "../../support/vendors/index.ts";
import { type AuthorityWorld, ada as sam, authorityWorld, T0, TENANT } from "../../workers/support/authority-world.ts";
import { type El, page } from "../../workers/support/page-harness.ts";
import { asPerson, keysFor, testMasterKey } from "../../workers/support/vault-harness.ts";
import type { CardInfo, ChatLabel, Decided, DrawnCard, Entry, Frame, GrantInfo, JournalInfo, P15PageWorld, P15World, Row, TurnInfo } from "./world.ts";

export { sam, T0 };

/** Sam's one saved credential (T-P15-07): a login that fills on its site only, usable under her grant alone. */
export const CREDENTIAL = { ref: "cred://site-login", host: "login.example.test" } as const;

type Part = { type: string; text?: string; name?: string };

export class P15Tier1World implements P15World {
  readonly w: AuthorityWorld;
  readonly browser: FakeBrowser;
  readonly vault: ObjectHarness<VaultCore>;
  /** The credential's value, generated per world; no store but the Vault and the site's field may hold it. */
  readonly secret: string;
  readonly sent: EgressRequest[] = [];
  readonly decided: Decided[] = [];
  /** Each `steps_lookup` that ran, by its step. */
  readonly steps: number[] = [];
  readonly ids = new Map<ChatLabel, string>();
  private readonly sockets = new Map<ChatLabel, HarnessSocket>();
  private readonly memory: Map<string, ObjectHarness<PersonBrowse>> = new Map();

  constructor(o: { script: FakeStep[]; sites: Record<string, FakeSite> }) {
    this.browser = new FakeBrowser(o.sites);
    this.secret = seededToken();
    const now = () => this.w.clock.now;
    this.vault = new ObjectHarness(
      "vault",
      (ctx) =>
        new VaultCore(ctx as never, {
          tenant: TENANT,
          keys: keysFor(TENANT, testMasterKey()),
          fetch: async () => {
            throw new Error("HERMETIC: no network");
          },
          now,
          inject: this.browser.inject,
        }),
      {},
    );
    const vault = () => this.vault.instance;
    const browseMemory = (person: string) => {
      let h = this.memory.get(person);
      if (!h) {
        h = new ObjectHarness(`browse-${person}`, (ctx) => new PersonBrowse((ctx as DurableObjectState).storage, now), {});
        this.memory.set(person, h);
      }
      return h.instance;
    };
    this.w = authorityWorld({
      script: o.script,
      namespaces: (owner) => [
        shareNamespace((r) => this.sent.push({ ...r, at: now() })),
        credentialsNamespace({ list: async () => vault().list(owner()) }),
        // A lookup that takes one step of a long task (T-P15-09), noting each step it ran.
        stepsNamespace((n) => this.steps.push(n)),
      ],
      browse: {
        port: this.browser,
        memory: (person) => ({ get: async (d) => browseMemory(person).get(d), record: async (r) => browseMemory(person).record(r) }),
        fill: (person) => ({ fill: (req) => vault().fill(req, { person, purpose: "browse_fill" }), scrub: async (session, text) => vault().scrub(session, text) }),
      },
      // As `objects/person.ts` wires the Vault (M14.2): an allow-once fill commit mints a matching one-shot credential grant.
      mint: (person) => (i) => vault().grantForAction({ person, ...i }),
    });
  }

  /** Seeds Sam's credential through the capture form's writer, as she would save it. */
  async seedCredential(): Promise<void> {
    const put = await this.vault.instance.capture(
      { ref: CREDENTIAL.ref, value: this.secret, kind: "login", permission: "grant", hosts: [{ host: CREDENTIAL.host, methods: ["GET"], header: "authorization", prefix: "", fills: true }] },
      asPerson(sam.email, "capture-form"),
    );
    if (!put.ok) throw new Error(`P15_SEED_CREDENTIAL: ${put.code}`);
  }

  /** Opens `label`: Sam's main chat (`c1`) through the app's route, another through her `Person`. */
  async open(label: ChatLabel): Promise<void> {
    const id = label === "c1" ? ((await this.w.http(sam.email, "GET", "/app/chats")).body.main as string) : ((await this.w.host(sam.email).chats.open(T0)) as { chatId: string }).chatId;
    this.ids.set(label, id);
    this.sockets.set(label, this.harness(label).connect());
  }
  id(label: ChatLabel = "c1"): string {
    const id = this.ids.get(label);
    if (!id) throw new Error(`P15_CHAT_NOT_OPEN: ${label}`);
    return id;
  }
  harness(label: ChatLabel = "c1") {
    return this.w.chats.harness(this.id(label));
  }
  chat(label: ChatLabel = "c1") {
    return this.harness(label).instance;
  }
  private labelled(s: string): string {
    let out = s;
    for (const [label, id] of this.ids) out = out.replaceAll(id, label);
    return out;
  }

  /** Sam's decision on a card through the decide route as her page posts it, or the agent session's attempt on the chat itself. */
  async decide(card: string, choice: Choice, as: "person" | "agent" = "person", label: ChatLabel = "c1"): Promise<Decided> {
    type R = { ok: boolean; state?: string; outcome?: string; code?: string; text?: string; again?: true };
    const r: R =
      as === "agent"
        ? ((await this.chat(label).decide([card], { person: sam.email, agent: true }, choice))[0] as R)
        : (((await this.w.http(sam.email, "POST", `/chats/${this.id(label)}/cards/decide`, { ids: [card], choice })).body.results as R[] | undefined)?.[0] ?? { ok: false, code: "P15_NO_ANSWER" });
    await this.chat(label).settled();
    const d: Decided = { card, as, choice, ok: r.ok, ...(r.state ? { state: r.state } : {}), ...(r.outcome ? { outcome: r.outcome } : {}), ...(r.code ? { code: r.code } : {}), ...(r.text ? { text: r.text } : {}), ...(r.again ? { again: true } : {}) };
    this.decided.push(d);
    return d;
  }

  private cardRows(label: ChatLabel): CardRow[] {
    try {
      return (this.chat(label) as unknown as { cards: { list(): CardRow[] } }).cards.list();
    } catch {
      return [];
    }
  }
  cards(label: ChatLabel = "c1"): CardInfo[] {
    return this.cardRows(label).map((c) => {
      const v = renderCard(c, (e) => (e === sam.email ? sam.name : e), c.tool.replaceAll("_", " "));
      return {
        id: c.id, state: c.state, tool: c.tool, kind: c.descriptor.actionKind, fingerprint: c.fingerprint, host: c.descriptor.recipients?.[0] ?? null, choice: c.choice, decidedBy: c.decidedBy, grantId: c.grantId, outcome: c.outcome, createdAt: c.createdAt, decidedAt: c.decidedAt,
        view: { title: v.title, lines: v.lines, status: v.status, choices: v.choices.map((x) => x.label), proposed: v.proposed, dest: v.dest, standing: v.standing },
      };
    });
  }
  decisions(): Decided[] {
    return [...this.decided];
  }
  async journal(): Promise<JournalInfo[]> {
    const seen = new Map<string, number>();
    return (await this.w.journal()).map((r) => {
      // An attempt's id carries a random suffix; the key numbers the attempts on each card instead.
      let key = this.labelled(r.id).replace(/:attempt:[0-9a-f-]{36}$/, ":attempt");
      if (key.endsWith(":attempt")) {
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        key = `${key}:${n}`;
      }
      return { key, actor: r.actor, actionKind: r.actionKind, decision: r.decision, grantId: r.grantId, outcome: r.outcome, raw: JSON.stringify(r) };
    });
  }
  grants(): GrantInfo[] {
    return this.w.host(sam.email).authority.all() as unknown as GrantInfo[];
  }
  egress() {
    return this.sent.map(({ host, text }) => ({ host, text }));
  }
  rows(label: ChatLabel = "c1"): Row[] {
    return this.harness(label)
      .rows("SELECT seq, role, body FROM messages ORDER BY seq")
      .map((r) => {
        const m = JSON.parse(String(r.body)) as { role: string; content: string | Part[]; toolName?: string; isError?: boolean };
        const parts: Part[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
        return {
          seq: Number(r.seq),
          role: m.role,
          ...(m.role === "toolResult" ? { tool: m.toolName ?? "", isError: m.isError === true } : {}),
          text: parts.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join(""),
          calls: parts.filter((p) => p.type === "toolCall").map((p) => p.name ?? ""),
        };
      });
  }
  entries(label: ChatLabel = "c1"): Entry[] {
    return this.chat(label).history().entries as Entry[];
  }
  turns(label: ChatLabel = "c1"): TurnInfo[] {
    return this.harness(label)
      .rows("SELECT status, code FROM turns ORDER BY started_at, rowid")
      .map((r) => ({ status: String(r.status), code: r.code === null ? null : String(r.code) }));
  }
  frames(label: ChatLabel = "c1"): Frame[] {
    return (this.sockets.get(label)?.frames ?? []) as Frame[];
  }
  mailbox(label: ChatLabel = "c1") {
    return this.harness(label)
      .rows("SELECT kind, state FROM mailbox ORDER BY ordinal")
      .map((r) => ({ kind: String(r.kind), state: String(r.state) }));
  }
  async turnEnds() {
    return (await this.w.ledger().turnEnds({ person: sam.email })).map((r) => ({ outcome: String(r.outcome) }));
  }
  now() {
    return this.w.clock.now;
  }
  start() {
    return T0;
  }
  typed() {
    return this.browser.typed.map((t) => ({ host: hostOfSession(this.browser, t.session), value: t.value }));
  }
  opened() {
    return this.browser.gotos.flatMap((g) => (g.url ? [new URL(g.url).hostname] : []));
  }
  requestsTo(host: string) {
    const of = (u: string | null) => (u ? new URL(u).hostname : "");
    return this.browser.reads.filter((r) => of(r.url) === host).length + this.browser.gotos.filter((g) => of(g.url) === host).length;
  }
  audit() {
    return this.vault.instance.audit().map((a) => ({ ref: a.ref, host: a.host, outcome: a.outcome, grant: a.grant ?? null }));
  }
  vaultGrants() {
    return this.vault.instance.grants(sam.email).map((g) => ({ nonce: g.nonce, hosts: g.hosts, oneShot: g.oneShot, usedAt: g.usedAt }));
  }
  credentialValue() {
    return this.secret;
  }
  async sinks(): Promise<Record<string, string>> {
    const tables = <T extends object>(h: ObjectHarness<T> | undefined) => {
      if (!h) return "";
      const names = h.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name));
      return JSON.stringify(names.flatMap((t) => h.rows(`SELECT * FROM "${t}"`).map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, v instanceof Uint8Array ? new TextDecoder().decode(v) : v])))));
    };
    return {
      "model requests and tool results": JSON.stringify(this.w.fake.requests),
      transcripts: [...this.ids.keys()].map((l) => tables(this.harness(l))).join("\n"),
      journal: JSON.stringify(await this.w.journal()),
      "Sam's stores": tables(this.w.personHarness(sam.email)) + JSON.stringify([...this.w.r2.objects.entries()]),
      "engine memory": [...this.memory.values()].map((h) => tables(h)).join("\n"),
      "vault audit": JSON.stringify(this.vault.instance.audit()),
    };
  }

  /**
   * The collateral keys. Journal: per chat each visible message by ordinal and side, each stopped entry, turn,
   * mailbox row and card; each of Sam's grants by order; each Ledger journal row by its labelled key; each egress
   * request. Vault: each audit row by order and outcome, each credential grant, each value typed. R2: its keys.
   */
  async snapshot(): Promise<Snapshot> {
    const journal: string[] = [];
    for (const label of this.ids.keys()) {
      let n = 0;
      for (const e of this.entries(label)) if (e.kind === "you" || e.kind === "agent") journal.push(`message:${label}:${++n}:${e.kind}`);
      for (const [i, e] of this.entries(label).filter((x) => x.kind === "stopped").entries()) journal.push(`stopped:${label}:${i + 1}:${e.kind}`);
      for (const [i] of this.turns(label).entries()) journal.push(`turn:${label}:${i + 1}`);
      for (const [i, m] of this.mailbox(label).entries()) journal.push(`mail:${label}:${i + 1}:${m.kind}`);
      for (const c of this.cardRows(label)) journal.push(`card:${label}:${c.id}`);
    }
    for (const [i] of this.grants().entries()) journal.push(`grant:${i + 1}`);
    for (const r of await this.journal()) journal.push(`ledger:${r.key}`);
    for (const [i, r] of this.sent.entries()) journal.push(`egress:${i + 1}:${r.host}`);
    const vault = [
      ...this.vault.instance.audit().map((a, i) => `audit:${i + 1}:${a.outcome}`),
      ...this.vaultGrants().map((_, i) => `credential-grant:${i + 1}`),
      ...this.browser.typed.map((t, i) => `typed:${i + 1}:${hostOfSession(this.browser, t.session)}`),
    ];
    return { journal, vault, r2: [...this.w.r2.objects.keys()] };
  }
}

/** The host of the page a fake browser session is on. */
function hostOfSession(b: FakeBrowser, session: string): string {
  const last = [...b.gotos].reverse().find((g) => g.session === session && g.url);
  return last?.url ? new URL(last.url).hostname : "";
}

export interface P15HarnessOptions {
  script: FakeStep[];
  sites?: Record<string, FakeSite>;
  /** Sam's credential in her vault (T-P15-07). */
  credential?: boolean;
  /** A checkpoint of the script: the first prompt's turn waits there until a `stop` event. */
  hold?: string;
  /** The chat each prompt goes to, by turn order; `c1` when unset. */
  chats?: ChatLabel[];
  /** Runs after `c1` is open and before the snapshot: the records a task's setup names. */
  seed?: (world: P15Tier1World) => Promise<void>;
}

/** Plays one turn of a P15 task on `world`; anything the harness does not know is refused by name. */
export function p15Player(o: Pick<P15HarnessOptions, "hold" | "chats">) {
  let prompts = 0;
  let pending: Promise<unknown> | null = null;
  return async (world: P15Tier1World, turn: Turn): Promise<void> => {
    if (turn.kind === "prompt") {
      if (turn.by !== sam.email) throw new Error(`P15_TURN_BY_UNKNOWN: ${turn.by}`);
      const i = prompts++;
      const label = o.chats?.[i] ?? "c1";
      if (!world.ids.has(label)) await world.open(label);
      const sent = world.chat(label).send({ person: sam.email, text: turn.text });
      if (o.hold && i === 0) {
        const reached = await Promise.race([world.w.fake.reached(o.hold).then(() => true), sent.then(() => false)]);
        if (!reached) throw new Error(`P15_HOLD_NOT_REACHED: ${o.hold}`);
        pending = sent;
        return;
      }
      await sent;
      await world.chat(label).settled();
      return;
    }
    if (turn.kind !== "event") throw new Error(`P15_TURN_UNSUPPORTED: ${turn.kind}`);
    const p = turn.payload ?? {};
    const label = (p.chat as ChatLabel | undefined) ?? "c1";
    switch (turn.name) {
      case "decide":
        if (!p.card || !p.choice) throw new Error("P15_TURN_PAYLOAD: a decide event names card and choice");
        await world.decide(p.card, p.choice as Choice, p.as === "agent" ? "agent" : "person", label);
        return;
      case "clock":
        world.w.clock.now += Number(p.ms ?? 0);
        return;
      case "send": {
        const r = await world.chat(label).send({ person: sam.email, text: p.text ?? "" });
        if ((r as { status: string }).status !== "queued") throw new Error(`P15_SEND_NOT_QUEUED: ${JSON.stringify(r)}`);
        return;
      }
      case "stop": {
        if (!pending || !o.hold) throw new Error("P15_STOP_NOTHING_HELD: a stop event follows a held prompt");
        const refused = await answerFrame(sam.email, JSON.stringify({ type: "stop" }), world.chat(label));
        if (refused) throw new Error(`P15_STOP_REFUSED: ${JSON.stringify(refused)}`);
        world.w.fake.release(o.hold);
        await pending;
        pending = null;
        await world.chat(label).settled();
        return;
      }
      default:
        throw new Error(`P15_TURN_UNSUPPORTED: event ${turn.name}`);
    }
  };
}

export function p15Harness(o: P15HarnessOptions): TaskHarness<P15Tier1World> {
  let play = p15Player(o);
  return {
    setup: async () => {
      play = p15Player(o);
      const world = new P15Tier1World({ script: o.script, sites: o.sites ?? {} });
      if (o.credential) await world.seedCredential();
      await world.open("c1");
      await o.seed?.(world);
      return world;
    },
    play: (world, turn) => play(world, turn),
  };
}

// The pages Sam sees (T-P15-02, T-P15-06, T-P15-11): the shipped page script under the page harness, its requests
// answered by the agent script's real route as Sam, a chat's frames from that chat's own history. Each read is a
// fresh page load, as a reload is.

const find = (root: El, pred: (e: El) => boolean): El[] => [...(pred(root) ? [root] : []), ...root.children.flatMap((c) => find(c, pred))];
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const drawnCard = (n: El): DrawnCard => ({
  id: n.dataset.card ?? "",
  title: n.children.find((c) => c.tag === "h3")?.textContent ?? "",
  status: n.children.find((c) => c.className === "status")?.textContent ?? "",
  choices: (n.children.find((c) => c.className === "choices")?.children ?? []).map((b) => b.textContent ?? ""),
  text: n.text(),
});

export class P15PageTier1World extends P15Tier1World implements P15PageWorld {
  /** Sam's page on `label`'s chat, its history drawn as a socket opening would. */
  async page(label: ChatLabel) {
    const chatId = this.id(label);
    const p = await page({
      onSend() {},
      fetch: async (path, init) => {
        if (!path.startsWith("/chats/") && !["/app/approvals", "/api/grants", "/app/permissions"].includes(path)) return null;
        const r = await this.w.http(sam.email, init?.method ?? "GET", path.replace("/chats/chat-ada/", `/chats/${chatId}/`), init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    });
    const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
    p.open(s);
    const chat = this.chat(label);
    const frame = connectFrame(sam.email, chat.owner(), () => chat.history());
    if (!frame.ok) throw new Error(`P15_PAGE_REFUSED: ${frame.code}`);
    p.deliver(s, frame.frame);
    await settle();
    return p;
  }
  async thread(label: ChatLabel): Promise<DrawnCard[]> {
    const p = await this.page(label);
    return find(p.log, (e) => e.dataset.card !== undefined).map(drawnCard);
  }
  async threadText(label: ChatLabel): Promise<string> {
    return (await this.page(label)).log.text();
  }
  async approvals() {
    const p = await this.page("c1");
    await p.byId("open-agent").onclick?.();
    await p.byId("panel-tab-approvals").onclick?.();
    await settle();
    const waiting = find(p.byId("approval-list"), (e) => e.dataset.card !== undefined).map(drawnCard);
    const history = p.byId("approval-history").children.filter((r) => r.dataset.card !== undefined).map((r) => ({ id: r.dataset.card ?? "", text: r.text(), revocable: find(r, (e) => e.dataset.revoke !== undefined).length > 0 }));
    return { waiting, history, text: `${p.byId("approval-list").text()}\n${p.byId("approval-history").text()}` };
  }
  validateGrant(input: unknown): string | null {
    const r = checkGrant(input, { kind: "person", id: sam.email }, this.now());
    return r.ok ? null : r.code;
  }
  /** Evicts every opened chat, so the next read is a restarted object's (T-P15-11's reload). */
  restart(): void {
    for (const label of ["c1", "c2"] as ChatLabel[]) if (this.hasChat(label)) this.harness(label).evict();
  }
  hasChat(label: ChatLabel): boolean {
    try {
      this.id(label);
      return true;
    } catch {
      return false;
    }
  }
}

/** A page task's harness: the setup's turns (the seed) make the records; the task's own turns are page loads. */
export function p15PageHarness(o: Omit<P15HarnessOptions, "seed"> & { seed: (world: P15PageTier1World) => Promise<void> }): TaskHarness<P15PageTier1World> {
  return {
    setup: async () => {
      const world = new P15PageTier1World({ script: o.script, sites: o.sites ?? {} });
      await world.open("c1");
      await o.seed(world);
      return world;
    },
    play: async (world, turn) => {
      if (turn.kind !== "event") throw new Error(`P15_PAGE_TURN_UNSUPPORTED: ${turn.kind}`);
      const label = (turn.payload?.chat as ChatLabel | undefined) ?? "c1";
      if (turn.name === "render") return void (await world.thread(label));
      if (turn.name === "approvals") return void (await world.approvals());
      if (turn.name === "reload") return world.restart();
      throw new Error(`P15_PAGE_TURN_UNSUPPORTED: event ${turn.name}`);
    },
  };
}

