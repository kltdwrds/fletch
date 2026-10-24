// F8: a new chat is a drafted placeholder at `/chats/new`. The grammar (D-0009) gains the literal row; the server serves
// the page on it; the `+` pushes the address and creates nothing; the first send makes the chat (one `POST /app/chats`,
// titled from the prompt's own words), replaces the address with the assigned id and streams the reply into the same
// view; an unsent draft stays in the composer across the page session and is never sent or stored; leaving without
// sending leaves no `New chat` row. The page is the shipped script under the page harness over the authority world's
// real routes as Sam or Pat of solo-sam; the model is the scripted fake, and the chat's frames are scripted where the
// claim is the page's drawing. The `+`'s hover is its tooltip and the system's hover rule here, and by eye at UAT.
import { describe, expect, it } from "vitest";
import { passkeyIdentity, SESSION_COOKIE } from "@qyvr/host-cloudflare";
import { COMPOSER_TEXT } from "../../packages/agent/src/http/app/chat.ts";
import { CHATS_TEXT, promptTitle, TITLE_FROM_PROMPT } from "../../packages/agent/src/http/app/chats-list.ts";
import { ROUTER_TEXT } from "../../packages/agent/src/http/app/router.ts";
import { SHELL_TEXT } from "../../packages/agent/src/http/app/shell.ts";
import { APP_PAGE, PAGE_CSS } from "../../packages/agent/src/http/page.ts";
import { PAGES, pageOf } from "../../packages/agent/src/http/pages.ts";
import { serve } from "../../packages/agent/src/http/serve.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, person, TENANT } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const pat = person("pat-solo");
const NEW = "/chats/new";
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const world = (script: FakeStep[] = []) => authorityWorld({ script, seed: [ada, pat] });
type World = ReturnType<typeof world>;
type Page = Awaited<ReturnType<typeof page>>;
type Call = { method: string; path: string; body?: unknown };

/**
 * A person's page booted at `path`, its requests on the world's real routes as that person, every one recorded in
 * `calls`; `refuse` answers a request with that status instead, to plant a failure.
 */
async function pageAt(w: World, who: string, path: string, o: { plant?: (js: string) => string; refuse?: (c: Call) => number | undefined } = {}) {
  const calls: Call[] = [];
  const p = await page(
    {
      onSend() {},
      fetch: async (url, init) => {
        const c: Call = { method: init?.method ?? "GET", path: url, ...(init?.body ? { body: JSON.parse(init.body) } : {}) };
        calls.push(c);
        const refused = o.refuse?.(c);
        if (refused) return new Response(JSON.stringify({ ok: false, code: "PLANTED" }), { status: refused });
        const r = await w.http(who, c.method, url, c.body);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    { desktop: true, path },
    o.plant,
  );
  await settle();
  return Object.assign(p, { calls, creates: () => calls.filter((c) => c.method === "POST" && c.path === "/app/chats") });
}
type DraftPage = Awaited<ReturnType<typeof pageAt>>;
const address = (p: Page) => p.location.pathname + p.location.search + p.location.hash;
const lastSocket = (p: Page) => p.sockets.at(-1) as NonNullable<Page["sockets"][0]>;
const wsOf = (chat: string) => `wss://solo-sam.example/chats/${chat}/ws`;
const view = (p: Page) => p.byId("app").dataset.view;
const rowOf = (p: Page, chat: string) => p.byId("chats").children.find((r) => r.dataset.chat === chat) as El | undefined;
const titleOf = (p: Page, chat: string) => rowOf(p, chat)?.children[0]?.children[0]?.textContent;
const sideChats = (w: World, who: string) => w.host(who).chats.entries().filter((c) => c.kind === "side");
const input = (p: Page) => p.byId("t");
const typeDraft = async (p: Page, text: string) => {
  input(p).value = text;
  await input(p).oninput?.();
};
/** The page's placeholder: the chat view, no chat connected, the composer open and the title naming the action. */
const placeholder = (p: Page) => [view(p), input(p).disabled, input(p).placeholder, p.document.title];
const PLACEHOLDER = ["chat", false, COMPOSER_TEXT.live, `${SHELL_TEXT.newChat} · ${ROUTER_TEXT.app}`];
/** Connects the newest socket as the created chat's and draws its (empty) history, as the Chat sends it on open. */
function connectMade(w: World, p: Page, chat: string) {
  const s = lastSocket(p);
  expect(s.url).toBe(wsOf(chat));
  p.open(s);
  p.deliver(s, { type: "history", ...w.chats.harness(chat).instance.history() });
  return s;
}
/** The first send made from the placeholder: the one chat it created, with the message the socket carried. */
async function firstSend(w: World, p: DraftPage, who: string, text: string) {
  const before = new Set(sideChats(w, who).map((c) => c.id));
  const creates = p.creates().length;
  await p.type(text);
  await settle();
  const made = sideChats(w, who).filter((c) => !before.has(c.id));
  expect([p.creates().length - creates, made.length]).toEqual([1, 1]);
  const chat = (made[0] as { id: string }).id;
  // Until the send goes the words stay in the composer (closed while the chat connects), so none is lost without a word.
  expect([input(p).value, input(p).disabled]).toEqual([text, true]);
  const s = connectMade(w, p, chat);
  await settle();
  // The message as typed (the composer trims its ends, as it always has) went once the history was drawn.
  const sent = s.sent.map((d) => JSON.parse(d) as { type: string; text?: string; id?: string });
  expect([sent.filter((f) => f.type === "send").map((f) => f.text), input(p).value]).toEqual([[text.trim()], ""]);
  return { chat, s, sendId: sent.find((f) => f.type === "send")?.id as string };
}

/** Sam's and Pat's sessions on one world, and a `serve()` call as either, as `f4-pages` makes it. */
async function signedIn() {
  const w = world();
  const company = w.companyHarness().instance;
  const identity = passkeyIdentity({ call: async (c) => company.loginCall(c) as never, owner: ada.email, tenant: TENANT, now: () => w.clock.now });
  const env = { ...w.env, OWNER_EMAIL: ada.email, HOST: { identity } };
  const mint = async (email: string) => (await company.loginCall({ op: "mint", email, needsPasskey: false })) as string;
  const sessions = { sam: await mint(ada.email), pat: await mint(pat.email) };
  const get = (p: string, cookie: string | undefined) =>
    serve(new Request(`https://${TENANT}.example${p}`, { headers: { accept: "text/html,*/*;q=0.8", ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) } }), env as never, { tenant: TENANT }, { dir: w.dir, now: () => w.clock.now });
  return { sessions, get };
}

describe("[F8] a new chat is a drafted placeholder at /chats/new", () => {
  it("the grammar has the literal row before the uuid row, a chat view with no id; a reload at /chats/new serves the page (200)", async () => {
    expect(pageOf(NEW)).toEqual({ row: expect.objectContaining({ name: "new", view: "chat", example: NEW }), id: null });
    const names = PAGES.map((r) => r.name);
    expect(names.indexOf("new")).toBeLessThan(names.indexOf("chat"));
    // The uuid row never matches the literal, and nothing after it is a page.
    const chat = PAGES.find((r) => r.name === "chat") as { pattern: string };
    expect([new RegExp(chat.pattern).test(NEW), pageOf("/chats/new/"), pageOf("/chats/New"), pageOf("/chats/new/x")]).toEqual([false, null, null, null]);
    // The server: the page for Sam and for Pat with a session; signed out, sent to sign in as elsewhere.
    const { sessions, get } = await signedIn();
    for (const cookie of [sessions.sam, sessions.pat]) {
      const r = await get(NEW, cookie);
      expect([r.status, r.headers.get("content-type")]).toEqual([200, "text/html; charset=utf-8"]);
      expect(await r.text()).toBe(APP_PAGE);
    }
    expect((await get(NEW, undefined)).headers.get("location")).toBe("/login");
    expect((await get("/chats/new/", sessions.sam)).status).toBe(404);
  });

  it("booted at /chats/new the composer is the chat view with no id, and no POST /app/chats is recorded while the page opens or the person types", async () => {
    const w = world();
    await w.say(ada.email, "An earlier chat");
    const p = await pageAt(w, ada.email, NEW);
    expect([placeholder(p), address(p), p.history.entries, p.sockets.length]).toEqual([PLACEHOLDER, NEW, [NEW], 0]);
    await typeDraft(p, "Half a thought");
    await settle();
    expect([p.creates(), input(p).value, p.byId("send").hidden]).toEqual([[], "Half a thought", false]);
    // The list loaded beneath: no row is current, and the address stayed the placeholder's.
    expect([address(p), p.byId("chats").children.filter((r) => r.dataset.chat).length > 0, p.byId("chats").children.some((r) => r.children[0]?.attrs["aria-current"])]).toEqual([NEW, true, false]);
    expect(sideChats(w, ada.email).map((c) => c.title)).toEqual(["New chat"]);
    // Planted: the old click handler's create-on-open, run as the placeholder opens, records a create and fails this.
    const planted = (js: string) => {
      const at = "function openDraft() {";
      expect(js).toContain(at);
      return js.replace(at, `${at} post("/app/chats", {});`);
    };
    const broken = await pageAt(w, ada.email, NEW, { plant: planted });
    expect(broken.creates().length).toBe(1);
  });

  it("clicking #new-chat from an open chat pushes /chats/new, records no create, and focuses the composer", async () => {
    const w = world([{ text: "One." }]);
    const first = (await w.say(ada.email, "First chat")).chatId;
    const p = await pageAt(w, ada.email, `/chats/${first}`);
    expect([address(p), lastSocket(p).url]).toEqual([`/chats/${first}`, wsOf(first)]);
    let focused = 0;
    Object.assign(input(p), { focus: () => void focused++ });
    await p.byId("new-chat").onclick?.();
    await settle();
    expect([address(p), p.history.entries, p.creates(), focused]).toEqual([NEW, [`/chats/${first}`, NEW], [], 1]);
    expect([placeholder(p), lastSocket(p).closed?.reason, p.sockets.length]).toEqual([PLACEHOLDER, "switched", 1]);
    expect(rowOf(p, first)?.children[0]?.attrs["aria-current"]).toBeUndefined();
    expect(sideChats(w, ada.email)).toHaveLength(1);
    // Planted: the old handler, creating a chat on the click, records a create and fails this.
    const planted = (js: string) => {
      const at = 'NEW_CHAT.onclick = () => go("/chats/new");';
      expect(js).toContain(at);
      return js.replace(at, 'NEW_CHAT.onclick = async () => { const r = await post("/app/chats", {}); const b = await r.json(); await chats(b.chatId); go(chatPath(b.chatId)); };');
    };
    const broken = await pageAt(w, ada.email, `/chats/${first}`, { plant: planted });
    await broken.byId("new-chat").onclick?.();
    await settle();
    expect(broken.creates().length).toBe(1);
  });

  it("the first send records exactly one create, replaces the address with /chats/<id> (back never lands on the placeholder) and streams the reply in place", async () => {
    const w = world();
    const first = (await w.say(ada.email, "First chat")).chatId;
    const p = await pageAt(w, ada.email, `/chats/${first}`);
    await p.byId("new-chat").onclick?.();
    await settle();
    const text = "Plan the Lisbon trip for next spring";
    const { chat, s, sendId } = await firstSend(w, p, ada.email, text);
    expect(chat).not.toBe(first);
    // Replaced, not pushed: the entries are the first chat's and the new one's, and the row is current.
    expect([address(p), p.history.entries, p.history.index]).toEqual([`/chats/${chat}`, [`/chats/${first}`, `/chats/${chat}`], 1]);
    expect(rowOf(p, chat)?.children[0]?.attrs["aria-current"]).toBe("page");
    // The person's bubble was drawn at the send, faint, and is the same node once the chat takes it: no redraw.
    const you = p.log.children[0] as El;
    expect([p.bubbles(), input(p).value, p.log.children.length]).toEqual([[["m you pending", text]], "", 1]);
    p.deliver(s, { type: "turn_started", id: sendId, text, turn: "t1" });
    p.deliver(s, { type: "delta", text: "Spring it is.", turn: "t1" });
    p.deliver(s, { type: "turn_done", turn: "t1", chars: 13 });
    expect([p.log.children[0] === you, p.bubbles(), p.busy()]).toEqual([true, [["m you", text], ["m agent", "Spring it is."]], false]);
    // Back lands on the first chat, never on the placeholder.
    p.history.back();
    await settle();
    expect([address(p), p.history.index, lastSocket(p).url]).toEqual([`/chats/${first}`, 0, wsOf(first)]);
    // Two members: Pat's first send makes Pat's own chat, listed for Pat and never for Sam.
    const q = await pageAt(w, pat.email, NEW);
    const made = await firstSend(w, q, pat.email, "Pat's own question");
    expect([address(q), q.history.entries, sideChats(w, ada.email).map((c) => c.id).includes(made.chat)]).toEqual([`/chats/${made.chat}`, [`/chats/${made.chat}`], false]);
    expect(titleOf(q, made.chat)).toBe("Pat's own question");
  });

  it("after the send the list row and the document title show the prompt-derived name, not New chat; a rename always wins", async () => {
    const w = world();
    const p = await pageAt(w, ada.email, NEW);
    const text = "  Book the   harbour ferry\n for Thursday,  then lunch  ";
    const { chat } = await firstSend(w, p, ada.email, text);
    const title = "Book the harbour ferry for Thursday, then lunch";
    expect([titleOf(p, chat), p.document.title, promptTitle(text)]).toEqual([title, `${title} · ${ROUTER_TEXT.app}`, title]);
    expect(w.host(ada.email).chats.entries().find((c) => c.id === chat)?.title).toBe(title);
    // A long prompt is cut at a word within the cap, with an ellipsis; the page and the server agree on it.
    const long = "Could you put together a packing list for the Lisbon trip with the kids, the ferry and the museum day";
    const q = await pageAt(w, ada.email, NEW);
    const made = await firstSend(w, q, ada.email, long);
    const capped = promptTitle(long);
    expect([capped.length <= TITLE_FROM_PROMPT + 1, capped.endsWith("…"), capped.includes("  "), long.startsWith(capped.slice(0, -1))]).toEqual([true, true, false, true]);
    expect([titleOf(q, made.chat), w.host(ada.email).chats.entries().find((c) => c.id === made.chat)?.title]).toEqual([capped, capped]);
    // A rename wins after: the row's menu renames it, and the title follows the person's words.
    expect((await w.http(ada.email, "POST", `/app/chats/${chat}/rename`, { title: "Ferry day" })).status).toBe(200);
    const r = await pageAt(w, ada.email, `/chats/${chat}`);
    expect([titleOf(r, chat), r.document.title]).toEqual(["Ferry day", `Ferry day · ${ROUTER_TEXT.app}`]);
    // A rename wins before: a chat named before its first message keeps its name when the message lands, and a chat
    // made any other way with no message keeps New chat.
    const named = ((await w.http(ada.email, "POST", "/app/chats", { title: "Named first" })).body as { chatId: string }).chatId;
    const empty = ((await w.http(ada.email, "POST", "/app/chats", {})).body as { chatId: string }).chatId;
    const n = await pageAt(w, ada.email, `/chats/${named}`);
    const s = lastSocket(n);
    n.open(s);
    n.deliver(s, { type: "history", entries: [], running: null });
    await n.type("The first message here");
    await settle();
    expect([n.creates(), n.calls.filter((c) => c.path.endsWith("/rename"))]).toEqual([[], []]);
    expect(w.host(ada.email).chats.entries().filter((c) => c.id === named || c.id === empty).map((c) => c.title)).toEqual(["Named first", "New chat"]);
  });

  it("navigating from /chats/new to the main chat and back keeps the unsent text, records no create, and leaving creates nothing", async () => {
    const w = world();
    const main = ((await w.http(ada.email, "GET", "/app/chats")).body as { main: string }).main;
    const p = await pageAt(w, ada.email, NEW);
    await typeDraft(p, "Half a thought");
    // To the main chat from the list: the draft leaves the composer with the placeholder, and the chat connects.
    await rowOf(p, main)?.children[0]?.onclick?.();
    await settle();
    expect([address(p), lastSocket(p).url, input(p).value, p.document.title]).toEqual([`/chats/${main}`, wsOf(main), "", `${CHATS_TEXT.main} · ${ROUTER_TEXT.app}`]);
    // Back: the placeholder with its draft.
    p.history.back();
    await settle();
    expect([address(p), placeholder(p), input(p).value, p.sockets.length]).toEqual([NEW, PLACEHOLDER, "Half a thought", 1]);
    // Forward to the chat, then the + again: the same draft, a push each way.
    await rowOf(p, main)?.children[0]?.onclick?.();
    await settle();
    await p.byId("new-chat").onclick?.();
    await settle();
    expect([address(p), p.history.entries, input(p).value]).toEqual([NEW, [NEW, `/chats/${main}`, NEW], "Half a thought"]);
    // Another view and the Chat tab back: the placeholder is the open chat, the text still there.
    await p.byId("rail-feed").onclick?.();
    expect([address(p), view(p)]).toEqual(["/feed", "feed"]);
    await p.byId("to-chat").onclick?.();
    expect([address(p), view(p), input(p).value]).toEqual([NEW, "chat", "Half a thought"]);
    // Nothing was created, and the draft went nowhere: no request carried it and no socket frame did.
    expect([p.creates(), p.calls.filter((c) => JSON.stringify(c.body ?? "").includes("Half a thought")), p.sockets.flatMap((s) => s.sent).filter((d) => d.includes("Half a thought"))]).toEqual([[], [], []]);
    expect([sideChats(w, ada.email), p.byId("chats").children.filter((r) => r.dataset.chat).map((r) => r.dataset.chat)]).toEqual([[], [main]]);
    // Leaving for good, then a reload at home: no empty chat appears in the list, then or after the reload.
    await rowOf(p, main)?.children[0]?.onclick?.();
    await settle();
    const again = await pageAt(w, ada.email, "/");
    expect([sideChats(w, ada.email), again.byId("chats").children.filter((r) => r.dataset.chat).map((r) => r.dataset.chat), again.creates()]).toEqual([[], [main], []]);
  });

  it("leaving before the made chat's history is drawn sends nothing and keeps the words in the composer, never losing them without a word", async () => {
    const w = world();
    const main = ((await w.http(ada.email, "GET", "/app/chats")).body as { main: string }).main;
    const p = await pageAt(w, ada.email, NEW);
    await p.type("Sent too soon");
    await settle();
    expect([p.creates().length, address(p).startsWith("/chats/"), address(p) === NEW, input(p).value]).toEqual([1, true, false, "Sent too soon"]);
    // Away to the main chat before the new chat's socket answered: the held send never goes, and its words are the
    // placeholder's draft again, out of the main chat's composer.
    await rowOf(p, main)?.children[0]?.onclick?.();
    await settle();
    const s = lastSocket(p);
    p.open(s);
    p.deliver(s, { type: "history", entries: [], running: null });
    await settle();
    expect([address(p), input(p).value, p.sockets.flatMap((x) => x.sent).filter((d) => d.includes("Sent too soon")), p.bubbles()]).toEqual([`/chats/${main}`, "", [], []]);
    // The + again: the placeholder holds the same words, and nothing more was created.
    await p.byId("new-chat").onclick?.();
    await settle();
    expect([address(p), input(p).value, p.creates().length]).toEqual([NEW, "Sent too soon", 1]);
  });

  it("a create the Person refuses keeps the draft in the composer and says so with its code; nothing is sent", async () => {
    const w = world();
    const p = await pageAt(w, ada.email, NEW, { refuse: (c) => (c.method === "POST" && c.path === "/app/chats" ? 500 : undefined) });
    await p.type("Try this");
    await settle();
    expect([p.creates().length, address(p), input(p).value, p.bubbles(), p.sockets.length, sideChats(w, ada.email)]).toEqual([1, NEW, "Try this", [], 0, []]);
    expect([p.byId("conn").hidden, p.byId("conn").textContent, p.byId("conn").dataset.code]).toEqual([false, CHATS_TEXT.notOpened, "PLANTED"]);
  });

  it("the #new-chat button carries its tooltip and the system's icon-button hover treatment on hover and keyboard focus", () => {
    expect(APP_PAGE).toContain(`<button id="new-chat" class="qf-ibtn qf-ibtn--28" aria-label="${SHELL_TEXT.newChat}" title="${SHELL_TEXT.newChat}">`);
    // The system's own hover rule for icon buttons, and the class hook a script can set in its place.
    expect(PAGE_CSS).toMatch(/\.qf-ibtn:hover\{background:var\(--fill-secondary-elevated-hover\)\}/);
    expect(PAGE_CSS).toMatch(/\.qf-ibtn\.is-hover\{background:var\(--fill-secondary-elevated-hover\)\}/);
    // The button's own rule: the same fill on hover and on keyboard focus, the glyph at the primary text colour.
    const rule = /#new-chat:hover,\s*#new-chat:focus-visible,\s*#new-chat\.is-hover\s*\{([^}]*)\}/.exec(PAGE_CSS);
    expect(rule?.[1]).toContain("background: var(--fill-secondary-elevated-hover)");
    expect(rule?.[1]).toContain("color: var(--text-primary)");
  });
});
