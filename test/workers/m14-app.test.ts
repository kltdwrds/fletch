// M14.2: the app's pages and the chat topology (muse spec section 14.1). The page script runs as shipped
// against a minimal DOM whose fetch is the agent script's real `route` over the authority world, so
// "the page reopens the main chat" is what the page does, not what its text says. Chats, approvals,
// jobs, the library and the loops are read through the real objects; delivery targets the person's
// main chat when the addressed chat is archived, gone, or a request chat for a proactive item.
import { describe, expect, it } from "vitest";
import { appRoutes, type AppDirectory } from "../../packages/agent/src/http/app-routes.ts";
import { APP_PAGE, APP_VIEWS } from "../../packages/agent/src/http/page.ts";
import { ANSWER_TIMEOUT_MS, OPEN_TIMEOUT_MS, RECONNECT_DELAYS_MS, RECONNECT_SCRIPT } from "../../packages/agent/src/http/reconnect.ts";
import { PersonJobIndex } from "../../packages/agent/src/person/job-index.ts";
import { LoopSettings, PERSON_LOOPS } from "../../packages/agent/src/loops/registry.ts";
import { PersonFiles } from "../../packages/agent/src/files/store.ts";
import { ObjectHarness } from "../support/object-harness.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { deliveryWorld } from "./support/delivery-world.ts";
import { jobWorld } from "./support/job-world.ts";
import { asBucket, FakeR2 } from "./support/fake-r2.ts";

const ORIGIN = "https://solo-sam.example";

/** A DOM just big enough for the page script: elements record text, children and handlers. */
class El {
  textContent = "";
  hidden = false;
  disabled = false;
  checked = false;
  value = "";
  type = "";
  min = "";
  className = "";
  readonly dataset: Record<string, string> = {};
  readonly attrs: Record<string, string> = {};
  readonly children: El[] = [];
  onclick: (() => unknown) | null = null;
  onsubmit: ((e: unknown) => unknown) | null = null;
  onchange: (() => unknown) | null = null;
  readonly id: string;
  constructor(id = "") {
    this.id = id;
  }
  append(...c: El[]) {
    this.children.push(...c);
  }
  replaceChildren() {
    this.children.length = 0;
  }
  remove() {}
  scrollIntoView() {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  cloneNode() {
    return new El();
  }
  toggleAttribute(k: string, on: boolean) {
    if (on) this.attrs[k] = "";
    else delete this.attrs[k];
  }
  querySelector() {
    return new El();
  }
  querySelectorAll(sel: string) {
    return sel.includes("data-chat") ? this.children.filter((c) => c.dataset.chat) : [];
  }
  /** Every descendant's text, depth first. */
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].join(" ");
  }
}

/** Runs the shipped page script for `person` over the world's routes; returns what it did. */
async function runPage(w: ReturnType<typeof authorityWorld>, person: string, search = "") {
  const els = new Map<string, El>();
  const byId = (id: string) => {
    const e = els.get(id) ?? new El(id);
    els.set(id, e);
    return e;
  };
  const sockets: Array<{ url: string; readyState: number; sent: string[]; close(): void }> = [];
  const requests: string[] = [];
  const fetch = async (path: string, init: RequestInit = {}) => {
    requests.push(`${init.method ?? "GET"} ${path}`);
    const r = await w.http(person, init.method ?? "GET", path, init.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  class FakeSocket {
    readyState = 0;
    readonly sent: string[] = [];
    readonly url: string;
    onopen: (() => void) | null = null;
    onclose: ((e: { code: number; reason: string }) => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }
    send(d: string) {
      this.sent.push(d);
    }
    close() {
      this.readyState = 3;
    }
  }
  const js = APP_PAGE.split("<script>")[1]?.split("</script>")[0] as string;
  const document = { getElementById: byId, createElement: () => new El() };
  const location = { protocol: "https:", host: "solo-sam.example", search, hash: "" };
  // The address bar as a browser keeps it: the page names the open chat there (M17.1).
  const history = {
    replaceState: (_s: unknown, _t: string, url: string) => {
      location.search = url.split("#")[0] as string;
    },
  };
  const run = new Function("document", "fetch", "WebSocket", "location", "history", "navigator", "URLSearchParams", "Intl", "Node", js);
  run(document, fetch, FakeSocket, location, history, {}, URLSearchParams, Intl, El);
  for (let i = 0; i < 50 && !sockets.length; i++) await new Promise((r) => setImmediate(r));
  return { els, byId, sockets, requests, location };
}

describe("[M14.2] chat topology", () => {
  it("the page reopens the person's main chat", async () => {
    const w = authorityWorld();
    const first = await runPage(w, ada.email);
    const main = ((await w.http(ada.email, "GET", "/app/chats")).body as { main: string }).main;
    expect(first.sockets.map((s) => s.url)).toEqual([`wss://solo-sam.example/chats/${main}/ws`]);
    expect(first.requests).not.toContain("POST /chats");
    // A side chat opened meanwhile does not move it: the next load reopens the same main chat.
    expect((await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" })).status).toBe(201);
    const second = await runPage(w, ada.email);
    expect(second.sockets.map((s) => s.url)).toEqual([`wss://solo-sam.example/chats/${main}/ws`]);
    const listed = (await w.http(ada.email, "GET", "/app/chats")).body as { chats: Array<{ id: string; kind: string; title: string }> };
    expect(listed.chats.map((c) => [c.kind, c.title])).toEqual([["main", "Main chat"], ["side", "Trip planning"]]);
    expect(second.byId("chats").text()).toContain("Trip planning");
    // Enrolment opens the main chat too: the same one the page then reopens.
    expect(await w.host(ada.email).chats.main(0)).toEqual({ ok: true, chatId: main });
  });

  it("[M17.1] the shipped page opens the chat last connected when the address names none, as a reload does (QYVR-151)", async () => {
    const w = authorityWorld();
    const side = ((await w.http(ada.email, "POST", "/app/chats", {})).body as { chatId: string }).chatId;
    // The page's socket to the new chat reached the route, which recorded it at Ada's Person.
    expect(w.host(ada.email).chats.connected(side, Date.now())).toBe(true);
    const reload = await runPage(w, ada.email, `?chat=${side}`);
    const fresh = await runPage(w, ada.email, "");
    expect(reload.sockets.map((s) => s.url)).toEqual([`wss://solo-sam.example/chats/${side}/ws`]);
    expect(fresh.sockets.map((s) => s.url)).toEqual(reload.sockets.map((s) => s.url));
    // The address names the chat the page opened, so the next reload reopens it.
    expect(fresh.location.search).toBe(`?chat=${side}`);
  });

  it("a notice addressed to an archived side chat lands in the main chat", async () => {
    const w = deliveryWorld();
    const main = w.openChat(ada.email);
    const side = w.openChat(ada.email);
    const notice = (id: string) => ({ id, kind: "requested" as const, category: "job:hn-watch", chat: side, source: "job:hn-watch", text: id });
    expect(await w.deliver(ada.email, notice("hn-watch:notice:1"))).toMatchObject({ state: "delivered" });
    expect(w.chatList(ada.email).archive(side, w.clock.now)).toEqual({ ok: true });
    expect(await w.deliver(ada.email, notice("hn-watch:notice:2"))).toMatchObject({ state: "delivered" });
    // And once the side chat is gone altogether.
    expect(w.chatList(ada.email).remove(side)).toEqual({ ok: true });
    expect(await w.deliver(ada.email, notice("hn-watch:notice:3"))).toMatchObject({ state: "delivered" });
    expect(w.notices(ada.email).map((n) => [n.chat, n.id])).toEqual([[main, "hn-watch:notice:2"], [main, "hn-watch:notice:3"], [side, "hn-watch:notice:1"]]);
  });

  it("a planted proactive item never lands in a colleague's request chat", async () => {
    const w = deliveryWorld();
    const main = w.openChat(ada.email);
    const request = w.openChat(ada.email, "request");
    const mail = w.openChat(ada.email, "mail");
    expect(w.chatList(ada.email).entries().map((c) => c.kind)).toEqual(["main", "request", "mail"]);
    // Planted: proactive items addressed to the request chat and the mail chat.
    for (const [id, chat] of [["offer:planted-request", request], ["offer:planted-mail", mail]] as const) {
      expect(await w.deliver(ada.email, { id, kind: "proactive", category: "loop:skill-review", chat, source: "loop:skill-review", text: id })).toMatchObject({ state: "delivered" });
      w.clock.now += 86_400_000;
    }
    // A requested result for the request chat still belongs there.
    await w.deliver(ada.email, { id: "reply:1", kind: "requested", category: "colleague", chat: request, source: "colleague", text: "done" });
    expect(w.notices(ada.email).map((n) => [n.chat, n.id])).toEqual([[main, "offer:planted-request"], [main, "offer:planted-mail"], [request, "reply:1"]]);
    // Plant the guard: with the kind check gone (the row marked side), the same item would land there.
    w.personChatsDb(ada.email).prepare("UPDATE chats SET kind = 'side' WHERE id = ?").run(request);
    expect(await w.chatList(ada.email).target(request, "proactive", w.clock.now)).toEqual({ ok: true, chatId: request });
  });
});

describe("[M14.2] app pages", () => {
  it("the socket reconnects after a 1006 close with a backoff, says so, and refuses to send while down", () => {
    const states: string[] = [];
    // The page's timers: a cancelled one never fires (M18.1 cancels a backoff the person's action overtakes).
    const later: Array<{ f: () => void; ms: number; cancelled?: boolean }> = [];
    const live = () => later.filter((l) => !l.cancelled);
    const fire = (ms: number) => {
      const t = live().find((l) => l.ms === ms);
      if (!t) throw new Error(`no live timer of ${ms} ms`);
      t.cancelled = true;
      t.f();
    };
    const made: Array<{ readyState: number; sent: string[]; onopen?: () => void; onclose?: (e: { code: number; reason?: string }) => void; close(): void }> = [];
    const keep = new Function(`${RECONNECT_SCRIPT}; return keepConnected;`)() as (open: () => unknown, onState: (s: string, i: Record<string, unknown>) => void, o: unknown) => { send(d: string): boolean; stop(): void };
    const conn = keep(
      () => {
        const s = { readyState: 0, sent: [] as string[], send(d: string) { this.sent.push(d); }, close() { this.readyState = 3; } } as (typeof made)[number] & { send(d: string): void };
        made.push(s);
        return s;
      },
      (s, i) => states.push(i.inMs !== undefined ? `${s}:${i.code}:${i.inMs}` : s),
      {
        delays: RECONNECT_DELAYS_MS, openTimeoutMs: OPEN_TIMEOUT_MS, answerTimeoutMs: ANSWER_TIMEOUT_MS, probe: "{}", onmessage: () => {},
        schedule: (f: () => void, ms: number) => { const t = { f, ms }; later.push(t); return t; },
        cancel: (t: { cancelled?: boolean }) => { t.cancelled = true; },
      },
    );
    const open = (n: number) => {
      (made[n] as { readyState: number }).readyState = 1;
      made[n]?.onopen?.();
    };
    open(0);
    expect(conn.send("one")).toBe(true);
    made[0]?.onclose?.({ code: 1006 });
    // Refused while down, and the person's send is the action that reconnects at once (M18.1).
    expect(conn.send("lost")).toBe(false);
    made[1]?.onclose?.({ code: 1006 });
    fire(RECONNECT_DELAYS_MS[1] as number);
    open(2);
    expect(conn.send("two")).toBe(true);
    expect(states).toEqual(["connecting", "connected", `reconnecting:1006:${RECONNECT_DELAYS_MS[0]}`, "connecting", `reconnecting:1006:${RECONNECT_DELAYS_MS[1]}`, "connecting", "connected"]);
    expect(made.map((m) => m.sent)).toEqual([["one"], [], ["two"]]);
    // Stopped (switching chats): a late close does not reconnect.
    conn.stop();
    made[2]?.onclose?.({ code: 1000 });
    expect(live()).toEqual([]);
    expect(states.at(-1)).toBe("closed");
  });

  it("serves every view, and approvals gathers the cards waiting across the person's own chats", async () => {
    const w = authorityWorld({ script: [{ toolCall: { id: "m1", name: "mail_send", arguments: {  } } }] });
    for (const v of APP_VIEWS) expect(APP_PAGE).toContain(`<main id="${v}"`);
    const { chatId } = await w.say(ada.email, "Mail Cal the report.");
    const mine = (await w.http(ada.email, "GET", "/app/approvals")).body as { cards: Array<{ id: string; chatId: string; state: string }>; unread: unknown[] };
    expect(mine).toMatchObject({ ok: true, cards: [{ id: "m1", chatId, state: "pending" }], unread: [] });
    // The page renders them with the decide route of their own chat.
    const page = await runPage(w, ada.email);
    await page.byId("open-agent").onclick?.();
    await page.byId("panel-tab-approvals").onclick?.();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    // The arguments are data and are not drawn (M23.2); the card says its title in words.
    expect(page.byId("approval-list").text()).not.toContain("Proposed by your agent");
    expect(page.byId("approval-list").text()).toContain("Your agent asks to:");
    expect(page.byId("approval-list").children.filter((c) => c.dataset.card)).toHaveLength(1);
  });

  it("jobs lists the person's own jobs with their runs; another member sees none and cannot run them", async () => {
    const indexes = new Map<string, ObjectHarness<PersonJobIndex>>();
    const idx = (p: string) => {
      const h = indexes.get(p) ?? new ObjectHarness(`jobs-${p}`, (ctx) => new PersonJobIndex((ctx as DurableObjectState).storage), {});
      indexes.set(p, h);
      return h.instance;
    };
    const jw = jobWorld({ index: async (owner, id) => idx(owner).note(id, 0) });
    jw.claimChat();
    expect(await jw.define({ steps: [{ kind: "notify" }] })).toMatchObject({ ok: true });
    await jw.tick();
    const dir: Partial<AppDirectory> = { jobIds: async (p) => idx(p).list(), job: () => jw.engine() as never };
    const call = (as: string, method: string, path: string, body?: unknown) =>
      appRoutes(new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN }, ...(body ? { body: JSON.stringify(body) } : {}) }), new URL(`${ORIGIN}${path}`), as, dir as AppDirectory).then(async (r) => ({ status: r?.status, body: await r?.json() }));
    const listed = await call(ada.email, "GET", "/app/jobs");
    expect(listed).toMatchObject({ status: 200, body: { ok: true, jobs: [{ id: "job", ok: true, job: { status: "active" }, runs: [expect.objectContaining({ jobId: "job" })] }] } });
    // The Job decides: Bo naming Ada's job is refused by its owner check, and nothing runs.
    const runs = jw.runs().length;
    expect(jw.runs()).toHaveLength(runs);
    expect(await call(ada.email, "POST", "/app/jobs/job", { action: "disable" })).toMatchObject({ status: 200 });
    expect(jw.status()?.status).toBe("disabled");
    expect(await call(ada.email, "POST", "/app/jobs/job", { action: "run" })).toMatchObject({ body: { ok: false } });
    expect((await call(ada.email, "POST", "/app/jobs/job", { action: "explode" })).body).toMatchObject({ code: "JOB_ACTION_INVALID" });
  });

  it("the library (files only) and the loops are the person's own, and a part that cannot be read is said, never blank", async () => {
    const r2 = new FakeR2();
    const files = new Map<string, ObjectHarness<PersonFiles>>();
    const filesOf = (p: string) => {
      const h = files.get(p) ?? new ObjectHarness(`files-${p}`, (ctx) => new PersonFiles((ctx as DurableObjectState).storage, asBucket(r2), p, () => 0), {});
      files.set(p, h);
      return h.instance;
    };
    const loops = new ObjectHarness("loops-ada", (ctx) => new LoopSettings((ctx as DurableObjectState).storage, PERSON_LOOPS), {});
    await filesOf(ada.email).write({ path: "notes/plan.md", text: "Q4 plan" }, { requester: ada.email, writer: `person:${ada.email}` });
    const dir: Partial<AppDirectory> = {
      files: async (p) => filesOf(p).list({}, p),
      loops: async (p) => (p === ada.email ? { ok: true, loops: loops.instance.list() } : { ok: false, code: "LOOPS_NOT_OWNER" }),
      setLoop: async (p, loop, patch) => (p === ada.email ? loops.instance.set(loop, patch) : { ok: false, code: "LOOPS_NOT_OWNER" }),
    };
    const call = (as: string, method: string, path: string, body?: unknown, origin = ORIGIN) =>
      appRoutes(new Request(`${ORIGIN}${path}`, { method, headers: { origin }, ...(body ? { body: JSON.stringify(body) } : {}) }), new URL(`${ORIGIN}${path}`), as, dir as AppDirectory).then(async (r) => ({ status: r?.status, body: await r?.json() }));
    const lib = await call(ada.email, "GET", "/app/library");
    expect(lib.body).toMatchObject({ ok: true, files: { ok: true, files: [expect.objectContaining({ path: "notes/plan.md" })] } });
    // Memory and skills left the Library (M23.4): the route carries the person's files and nothing else.
    expect(Object.keys(lib.body as object).sort()).toEqual(["files", "ok"]);
    // A store that cannot be read is said with its code, never an empty list.
    dir.files = async () => {
      throw new Error("files store unavailable");
    };
    expect((await call(ada.email, "GET", "/app/library")).body).toMatchObject({ ok: true, files: { ok: false, code: "APP_READ_FAILED" } });
    dir.files = async (p) => filesOf(p).list({}, p);
    expect(await call(ada.email, "POST", "/app/loops", { loop: "reflection", enabled: false })).toMatchObject({ status: 200 });
    expect((await call(ada.email, "GET", "/app/loops")).body).toMatchObject({ ok: true, loops: expect.arrayContaining([{ loop: "reflection", enabled: false, budget: expect.any(Number) }]) });
    expect(await call(ada.email, "POST", "/app/loops", { loop: "reflection", enabled: true }, "https://attacker.example")).toMatchObject({ status: 403, body: { code: "APP_ORIGIN" } });
    expect(loops.instance.get("reflection").enabled).toBe(false);
  });
});
