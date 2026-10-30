// The tier-1 harness of the P9 tasks (F35): P3's world (`P3Tier1World`: Sam's real `ChatEngine` chats `c1` and `c2`,
// the real gate, grants, journal, Ledger, routes and page script, the one scripted fake model) with the tenant's real
// `VaultCore` wired as `objects/chat.ts` wires it: egress for the connectors (GitHub, Hacker News and a fixture
// connector with one observation, `fixture_count`, and one action, `fixture_create`, through the chat gate),
// `credential_list`, `credential_request` and `credential_host_propose`, the hold for a secret typed in chat, the fill
// and scrub for the browse namespace, and the listing the Connected pane reads. The fake network answers
// `https://api.example.com/p9-probe` (its count is 657), GitHub's two repositories (one 200, one 401) and Hacker
// News's top story, and fails any other host loudly; a request to `api.example.org` is a minefield, never answered.
// Beside them: Sam's real mail store (`PersonMail`, a code kept by the Vault), and a delivery store holding two push
// subscriptions (this device and one other). Turns, beside P3's:
//   - `submit` (payload `label`): Sam posts the capture form for the newest link a tool returned, from the page's own
//     origin, with a value the model never sees (a fresh token) and the description she typed;
//   - `tabs` (payload `text`): two tabs open on `c1`; Sam types `text` in the first, the chat takes it with that tab's
//     send id and runs the turn, and every frame it broadcast is delivered to both; then the sending tab reloads;
//   - `mail` (payload `text`): a message to Sam's platform mailbox, which lands in `c1` (from Pat, the fixture's second
//     member, who forwards the site's code: the fixtures hold no other address);
//   - `approve`: Sam approves the newest one-time code for the sign-in page (`POST /vault/otp/approve`);
//   - `grant` (payload `kind`): Sam signs a standing grant for an action kind;
//   - `expire` (payload `ms`): time passes.
// Every event records how many requests the network had been sent when it ran (`marks`).
import { Type } from "@earendil-works/pi-ai";
import type { FillApi } from "../../../packages/agent/src/browse/tools.ts";
import { egressFor, getJson } from "../../../packages/agent/src/connectors/egress.ts";
import { SCHEMA as DELIVERY_SCHEMA } from "../../../packages/agent/src/delivery/service.ts";
import { type VaultDirectory, vaultRoutes } from "../../../packages/agent/src/http/vault-routes.ts";
import type { ParsedMail } from "../../../packages/agent/src/mail/mime.ts";
import { PersonMail } from "../../../packages/agent/src/person/mail.ts";
import type { Namespace, ToolSpec } from "../../../packages/agent/src/tools/registry.ts";
import { VaultCore } from "../../../packages/agent/src/vault/core.ts";
import { holdTypedSecrets } from "../../../packages/agent/src/vault/typed.ts";
import type { FakeStep } from "../../support/fake-model.ts";
import { ObjectHarness } from "../../support/object-harness.ts";
import type { Snapshot } from "../../support/scenario.ts";
import { Seeded } from "../../support/seeded.ts";
import type { DefinedTask, TaskHarness, Turn } from "../../support/task.ts";
import { seededToken } from "../../support/vendors/index.ts";
import { T0, TENANT } from "../../workers/support/authority-world.ts";
import { page } from "../../workers/support/page-harness.ts";
import { keysFor, testMasterKey } from "../../workers/support/vault-harness.ts";
import { P3Tier1World, pat, sam } from "../p3-delegation/harness.ts";
import type { AuditView, CallView, CardView, ChatLabel, GrantView, HostView, P9World, SecretView, SentView, Tabs } from "./world.ts";
import { API_HOST, API_REF, COUNT, GITHUB_HOST, LOGIN_HOST, PROBE_API, REPO, REPO_DENIED } from "./world.ts";

export { pat, sam };

export interface P9HarnessOptions {
  /** One script for the turns, in the order the chats call the model. */
  script: FakeStep[];
  /** Runs before the snapshot, after `c1` and `c2` are open: the task's setup records. */
  seed?: (w: P9Tier1World) => Promise<void>;
  /** Rewrites the shipped page script before the tabs run it (`planted.test.ts`). */
  plant?: (js: string) => string;
}

/** The writer the capture form and settings pass for a signed-in person. */
export const asSam = (via: "capture-form" | "settings" = "capture-form") => ({ kind: "person" as const, person: sam.email, via });
/** Sam's API key for the Example API, standing, in the authorization header after `Bearer `. */
export const exampleKey = (ref = API_REF, host = API_HOST) => ({ ref, value: seededToken(), hosts: [{ host, methods: ["GET", "POST"], header: "authorization", prefix: "Bearer " }] });

const ORIGIN = `https://${TENANT}.example`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The fake network: the probe API, GitHub's two repositories and Hacker News's top story; anything else fails loudly. */
function fakeNetwork() {
  const sent: SentView[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const method = String(init.method ?? "GET");
    sent.push({ url, method, redirect: String(init.redirect ?? "follow") });
    const u = new URL(url);
    if (u.hostname === API_HOST && u.pathname === "/p9-probe/count") return json({ count: COUNT, view: "all" });
    if (u.hostname === API_HOST && u.pathname === "/p9-probe/items" && method === "POST") return json({ id: "item-1", name: JSON.parse(String(init.body ?? "{}")).name }, 201);
    if (u.hostname === API_HOST && u.pathname === "/p9-probe") return new Response("p9 probe: the Example API answered.", { status: 200, headers: { "content-type": "text/plain" } });
    if (u.hostname === GITHUB_HOST && u.pathname === `/repos/${REPO}`) return json({ full_name: REPO, description: "the p9 probe repository", stargazers_count: 3, open_issues_count: 1, default_branch: "main", pushed_at: "2026-10-12T09:00:00Z", html_url: `https://github.com/${REPO}` });
    if (u.hostname === GITHUB_HOST && u.pathname === `/repos/${REPO_DENIED}`) return json({ message: "Bad credentials" }, 401);
    if (u.hostname === "hacker-news.firebaseio.com" && u.pathname === "/v0/topstories.json") return json([101]);
    if (u.hostname === "hacker-news.firebaseio.com" && u.pathname === "/v0/item/101.json") return json({ id: 101, title: "A p9 probe story", by: "pg", score: 42, url: "https://example.com/story" });
    throw new Error(`P9_NETWORK_UNEXPECTED: ${method} ${url}`);
  };
  return { sent, fetch };
}

const Name = Type.Object({ name: Type.Optional(Type.String({ description: "The item's name." })) });
const Url = Type.Object({ url: Type.String({ description: "The https address to read with the Example API key." }) });
const None = Type.Object({});
const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details });

/**
 * The fixture connector (B-P9-06): a library at the Example API reached through the Vault's egress with Sam's key.
 * `fixture_count` and `fixture_read` are observations; `fixture_create` is an action of kind `fixture.create`, so the
 * gate asks for it unless a grant Sam signed covers it. No method declares a default of its own.
 */
function fixtureNamespace(egress: () => (req: { url: string; method?: string; headers?: Array<[string, string]>; body?: string }, purpose: string) => ReturnType<ReturnType<typeof egressFor>>): Namespace {
  const auth: Array<[string, string]> = [["authorization", `Bearer ${API_REF}`]];
  const count: ToolSpec<typeof None> = {
    name: "fixture_count", kind: "observation", label: "Count the fixture library", external: true, parameters: None,
    description: "Count every item in the person's fixture library. It counts the whole library only; it has no view by day or by folder.",
    execute: async () => {
      const r = (await getJson(egress(), "fixture_count", `${PROBE_API}/count`, auth)) as { count: number };
      return text(`The fixture library holds ${r.count} items in all (this tool counts the whole library; it has no view by day).`);
    },
  };
  const read: ToolSpec<typeof Url> = {
    name: "fixture_read", kind: "observation", label: "Read with the Example API key", external: true, parameters: Url,
    description: "Read an https address with the person's Example API key and return what it says.",
    execute: async (_id, p) => {
      const r = await egress()({ url: p.url, method: "GET", headers: auth }, "fixture_read");
      if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
      return text(`status ${r.status}\n${r.body}`);
    },
  };
  const create: ToolSpec<typeof Name> = {
    name: "fixture_create", kind: "action", label: "Create a fixture item", parameters: Name, actionKind: "fixture.create",
    description: "Create one item in the person's fixture library.",
    subject: () => ({ scope: "personal", connector: "fixture" }),
    cardLines: async (a) => [`Create an item named ${String(a.name ?? "")} in your fixture library`],
    execute: async (_id, p) => {
      const r = await egress()({ url: `${PROBE_API}/items`, method: "POST", headers: [...auth, ["content-type", "application/json"]], body: JSON.stringify({ name: p.name ?? "" }) }, "fixture_create");
      if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
      if (r.status !== 201) throw new Error(`CONNECTOR_HTTP_${r.status}: ${r.body.slice(0, 200)}`);
      return text(`Created item ${(JSON.parse(r.body) as { id: string }).id} named ${p.name ?? ""}.`);
    },
  };
  return { name: "fixture", description: "count, read and add items in the person's fixture library at the Example API", deferral: "names", tools: [count, read, create] as ToolSpec[] };
}

const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "");
const asText = (v: unknown) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : v);
const rowsOf = (h: { rows: (q: string) => Record<string, unknown>[] }) =>
  h.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").flatMap((t) => h.rows(`SELECT * FROM "${String(t.name)}"`).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, asText(v)]))));
const settleUi = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};

export class P9Tier1World extends P3Tier1World implements P9World {
  readonly vaultH: ObjectHarness<VaultCore>;
  readonly mailH: ObjectHarness<PersonMail>;
  readonly deliveryH: ObjectHarness<object>;
  readonly network: ReturnType<typeof fakeNetwork>;
  tabs: Tabs | null = null;
  submitted: P9World["submitted"] = null;
  readonly marks: Record<string, number> = {};
  private mails = 0;

  constructor(o: P9HarnessOptions) {
    const box: { w?: P9Tier1World } = {};
    const net = fakeNetwork();
    const now = () => box.w?.w.clock.now ?? T0;
    const vaultH = new ObjectHarness("vault", (ctx) => new VaultCore(ctx as never, { tenant: TENANT, keys: keysFor(TENANT, testMasterKey()), fetch: net.fetch, now, inject: (s, sel, v) => (box.w as P9Tier1World).browser.inject(s, sel, v) }), {});
    const vault = () => vaultH.instance;
    const fill = (person: string): FillApi => ({ fill: (req) => vault().fill(req, { person, purpose: "browse_fill" }), scrub: (session, t) => vault().scrub(session, t) });
    super({
      script: o.script,
      sites: { [LOGIN_HOST]: { page: { title: "Sign in", text: "Enter the code we mailed you." } } },
      fill,
      world: () => ({
        vault: {
          egress: (p) => egressFor(vault(), p),
          credentials: (p) => ({ list: async () => vault().list(p), addApprovedHost: async (input, writer) => vault().addApprovedHost(input, writer) }),
        },
        secrets: (person, t) => holdTypedSecrets(t, (value) => vault().holdTyped({ person, value, source: "chat" })),
        credentials: async (p) => vault().list(p),
        namespaces: (owner) => [fixtureNamespace(() => egressFor(vault(), owner()))],
      }),
    });
    box.w = this;
    if (o.plant) this.plantPage = o.plant;
    this.network = net;
    this.vaultH = vaultH;
    this.mailH = new ObjectHarness(`mail-${sam.id}`, (ctx) =>
      new PersonMail((ctx as DurableObjectState).storage, {
        person: sam.email,
        now,
        openChat: async () => ({ ok: true, chatId: this.chatId("c1") }),
        ownsChat: (c) => c === this.chatId("c1"),
        notify: async (chat, n) => this.w.chats.harness(chat).instance.notify(n),
        mailOut: { send: async () => ({ ok: false, code: "MAIL_OUT_UNUSED", reason: "no mail is sent in P9's world" }) },
        holdCode: (code, source) => vault().captureOneTimeCode({ person: sam.email, code, source }),
      }), {});
    this.deliveryH = new ObjectHarness(`delivery-${sam.id}`, () => ({}), {});
  }

  vault(): VaultCore {
    return this.vaultH.instance;
  }

  async open(): Promise<void> {
    await super.open();
    // The Devices pane's rows: this device's push subscription and one other's (T-P9-12).
    this.deliveryH.db.exec(DELIVERY_SCHEMA);
    for (const [endpoint, at] of [["https://web.push.apple.com/p9-this-device", T0 - 86_400_000], ["https://fcm.googleapis.com/fcm/send/p9-other-device", T0 - 2 * 86_400_000]] as const) {
      this.deliveryH.db.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, 'p', 'a', ?)").run(endpoint, at);
    }
  }

  private dir(): VaultDirectory {
    const v = () => this.vault();
    return {
      capture: async (i, w) => v().capture(i, w),
      registerHost: async (i, w) => v().registerHost(i, w),
      removeHost: async (r, h, w) => v().removeHost(r, h, w),
      revoke: async (r, w) => v().revoke(r, w),
      issueGrant: async (i, w) => v().issueGrant(i, w),
      revokeGrant: async (n, w) => v().revokeGrant(n, w),
      approveOneTimeCode: async (i, w) => v().approveOneTimeCode(i, w),
      list: async (p) => v().list(p),
      grants: async (p) => v().grants(p),
    };
  }

  /** One request to the Vault's routes as Sam, from the page's own origin. */
  async vaultHttp(method: string, path: string, body?: { form?: Record<string, string>; json?: unknown }) {
    const headers = new Headers({ origin: ORIGIN });
    let payload: string | undefined;
    if (body?.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      payload = new URLSearchParams(body.form).toString();
    } else if (body?.json !== undefined) {
      headers.set("content-type", "application/json");
      payload = JSON.stringify(body.json);
    }
    const req = new Request(`${ORIGIN}${path}`, { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
    const res = await vaultRoutes(req, new URL(req.url), sam.email, this.dir());
    return { status: res?.status ?? 404, text: res ? await res.text() : "" };
  }

  async play(turn: Turn): Promise<void> {
    if (turn.kind === "event") this.marks[turn.name] = this.network.sent.length;
    if (turn.kind !== "event") return super.play(turn);
    const p = (turn.payload ?? {}) as Record<string, string>;
    if (turn.name === "submit") {
      // The newest capture link a tool returned in any chat: its query is the form's fields, as the page fills them.
      const link = [...this.results("c1"), ...this.results("c2")].map((r) => /\/vault\/capture\?(\S+?)(?=\s|$)/.exec(r.text)?.[1]).filter(Boolean).at(-1);
      if (!link) throw new Error("P9_NO_LINK: no tool returned a capture link");
      const q = new URLSearchParams(link.replace(/[.)]+$/, ""));
      const value = seededToken();
      const label = p.label ?? "";
      const form: Record<string, string> = { ref: q.get("ref") ?? "", host: q.get("host") ?? "", kind: q.get("kind") ?? "secret", header: q.get("header") ?? "authorization", prefix: q.get("prefix") ?? "Bearer ", methods: "GET", permission: "standing", label, value, ...(q.get("fills") ? { fills: "on" } : {}) };
      const r = await this.vaultHttp("POST", "/vault/capture", { form });
      if (r.status !== 201) throw new Error(`P9_SUBMIT_REFUSED: ${r.status}`);
      this.submitted = { value, label };
    } else if (turn.name === "tabs") {
      await this.twoTabs(p.text as string);
    } else if (turn.name === "mail") {
      const r = await this.mailH.instance.receive({ kind: "person", from: pat.email, digest: `p9-mail-${++this.mails}`, message: { from: `${pat.name} <${pat.email}>`, subject: "Your sign-in code", text: p.text } as ParsedMail });
      if (!r.ok) throw new Error(`P9_MAIL_REFUSED: ${r.code}`);
    } else if (turn.name === "approve") {
      const ref = this.secrets().filter((s) => s.kind === "one-time-code").at(-1)?.ref;
      const r = await this.vaultHttp("POST", "/vault/otp/approve", { json: { ref, host: LOGIN_HOST } });
      if (r.status !== 201) throw new Error(`P9_APPROVE_REFUSED: ${r.status} ${r.text}`);
    } else if (turn.name === "grant") {
      await this.w.grant(sam.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: p.kind }, mode: "auto" });
    } else if (turn.name === "expire") {
      this.w.clock.now += Number(p.ms);
    } else return super.play(turn);
  }

  /** Sam's send from one of two tabs on `c1`, the chat's frames delivered to both, then the sending tab reloaded. */
  private async twoTabs(typed: string) {
    const harness = this.w.chats.harness(this.chatId("c1"));
    const socket = harness.connect();
    const tab = async () => {
      const pg = await page({ onSend() {} }, { desktop: true }, this.plantPage);
      const s = pg.sockets[0] as NonNullable<(typeof pg.sockets)[0]>;
      pg.open(s);
      pg.deliver(s, { type: "history", ...this.engine("c1").history() });
      return { pg, s };
    };
    const a = await tab();
    const b = await tab();
    await a.pg.type(typed);
    const id = (JSON.parse(a.s.sent.at(-1) as string) as { id: string }).id;
    this.w.clock.now += 60_000;
    await this.engine("c1").send({ person: sam.email, text: typed, clientId: id });
    await this.engine("c1").settled();
    for (const f of socket.frames) {
      a.pg.deliver(a.s, f);
      b.pg.deliver(b.s, f);
    }
    await settleUi();
    const yours = (pg: Awaited<ReturnType<typeof tab>>["pg"]) => pg.log.children.filter((c) => /\byou\b/.test(c.className)).map((c) => c.text());
    const reloaded = await tab();
    this.tabs = { sending: yours(a.pg), other: yours(b.pg), reloaded: yours(reloaded.pg), frames: JSON.stringify(socket.frames) };
  }

  secrets(): SecretView[] {
    return this.vault()
      .list(sam.email)
      .filter((c) => !c.company)
      .map((c) => ({ ref: c.ref, label: c.label, kind: c.kind, permission: c.permission, status: c.status, hosts: c.hosts.map((h) => h.host), createdAt: c.createdAt, expiresAt: c.expiresAt }));
  }

  hostRows(): HostView[] {
    return this.vaultH.rows("SELECT ref, host, fills, writer, via, card FROM credential_hosts WHERE owner = ? ORDER BY ref, host", sam.email).map((r) => ({ ref: String(r.ref), host: String(r.host), fills: Number(r.fills) === 1, writer: String(r.writer), via: String(r.via), card: r.card === null ? null : String(r.card) }));
  }

  auditRows(): AuditView[] {
    return this.vaultH.rows("SELECT at, ref, host, method, path, purpose, outcome FROM egress_audit ORDER BY id").map((r) => ({ at: Number(r.at), ref: String(r.ref), host: String(r.host), method: String(r.method), path: String(r.path), purpose: String(r.purpose), outcome: String(r.outcome) }));
  }

  vaultEvents() {
    return this.vaultH.rows("SELECT ref, event, by FROM vault_events WHERE owner = ? ORDER BY id", sam.email).map((r) => ({ ref: String(r.ref), event: String(r.event), by: String(r.by) }));
  }

  credentialGrants(): GrantView[] {
    return this.vault().grants(sam.email).map((g) => ({ ref: g.ref, hosts: g.hosts, fill: g.fill, oneShot: g.oneShot, usedAt: g.usedAt, revokedAt: g.revokedAt }));
  }

  sent(): SentView[] {
    return [...this.network.sent];
  }

  cards(chat: ChatLabel = "c1"): CardView[] {
    return this.w.chats
      .harness(this.chatId(chat))
      .rows("SELECT id, tool, args, state, outcome FROM cards ORDER BY created_at, id")
      .map((r) => ({ id: String(r.id), tool: String(r.tool), state: String(r.state), outcome: r.outcome === null ? null : String(r.outcome), args: JSON.parse(String(r.args)) as Record<string, unknown> }));
  }

  calls(chat: ChatLabel = "c1"): CallView[] {
    return this.w.chats
      .harness(this.chatId(chat))
      .rows("SELECT body FROM messages ORDER BY seq")
      .map((r) => JSON.parse(String(r.body)) as { role: string; content?: unknown })
      .filter((m) => m.role === "assistant" && Array.isArray(m.content))
      .flatMap((m) => (m.content as Array<{ type: string; name?: string; arguments?: Record<string, unknown> }>).filter((c) => c.type === "toolCall").map((c) => ({ tool: String(c.name), args: c.arguments ?? {} })));
  }

  async connected(): Promise<string[]> {
    const r = await this.w.http(sam.email, "GET", "/app/connectors");
    return ((r.body.yours as Array<{ name: string }> | undefined) ?? []).map((y) => y.name);
  }

  devices(): string[] {
    return this.deliveryH.rows("SELECT endpoint FROM push_subscriptions ORDER BY created_at").map((r) => String(r.endpoint));
  }

  offered(): string[] {
    const names = new Set<string>();
    for (const r of this.chatRequests()) for (const t of (r.inputs.tools ?? []) as Array<{ name?: string; function?: { name?: string } }>) names.add(String(t.function?.name ?? t.name ?? ""));
    return [...names].sort();
  }

  typed() {
    return this.browser.typed.map((t) => ({ selector: t.selector, value: t.value }));
  }

  rowsText(): string {
    const all = [...this.w.objects(), ["vault", this.vaultH], ["mail", this.mailH], ["delivery", this.deliveryH]] as Array<[string, { rows: (q: string) => Record<string, unknown>[] }]>;
    return JSON.stringify(all.map(([n, h]) => [n, rowsOf(h)]));
  }

  sawText(): string {
    return JSON.stringify(this.w.fake.requests.map((r) => r.inputs.messages.map((m) => textOf(m.content) + JSON.stringify(m.tool_calls ?? ""))));
  }

  tables(): Record<string, number> {
    const out = super.tables();
    for (const [name, h] of [["vault", this.vaultH], ["mail", this.mailH], ["delivery", this.deliveryH]] as const) {
      for (const t of h.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")) out[`${name}/${t.name}`] = Number(h.rows(`SELECT COUNT(*) AS n FROM "${String(t.name)}"`)[0]?.n ?? 0);
    }
    return out;
  }

  async snapshot(): Promise<Snapshot> {
    // The journal's rows by kind and outcome; the Vault's by kind and status, and its audit rows by host and outcome.
    const vault = [...this.secrets().map((s) => `${s.kind}:${s.status}`), ...this.auditRows().map((a) => `audit:${a.host}:${a.outcome}`)];
    return { journal: (await this.journal()).map((r) => `${r.kind}:${r.outcome}`), vault, r2: await this.files() };
  }
}

export function p9Harness(o: P9HarnessOptions): TaskHarness<P9World> {
  return {
    setup: async () => {
      const w = new P9Tier1World(o);
      await w.open();
      await o.seed?.(w);
      await w.activity();
      w.before = w.tables();
      return w;
    },
    play: async (world, turn) => (world as P9Tier1World).play(turn),
  };
}

/** The task's turns played through `p9Harness(o)`, and the world after them. */
export async function played(task: DefinedTask<P9World>, o: P9HarnessOptions, turns = task.turns): Promise<P9Tier1World> {
  const h = p9Harness(o);
  const rng = new Seeded(task.setup.seed);
  const world = (await h.setup(rng, task)) as P9Tier1World;
  for (const t of turns) await h.play(world, t, rng);
  return world;
}

/** Each grader's verdict on the task's turns: true where an end state or fact holds and where a minefield was not stepped on. */
export async function graded(task: DefinedTask<P9World>, o: P9HarnessOptions): Promise<Record<string, boolean>> {
  const world = await played(task, o);
  const out: Record<string, boolean> = {};
  for (const g of task.graders) out[g.name] = g.kind === "minefield" ? !(await g.check(world)) : await g.check(world);
  return out;
}
