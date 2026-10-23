// F4: the router in the page harness (D-0009). The shipped page script runs over the authority world's real routes
// as Sam or Pat of solo-sam, with the harness's address bar and session history: a push, a replace and `back()` (which
// fires `popstate`) move `location` as a browser does. The address is the page the person asked for: a chat at
// `/chats/<id>`, a found message at `/chats/<id>#<mid>`, home replaced by the last chat's address, the tabs at their
// paths, and nothing the page does in the background writes it. The model is the scripted fake.
import { afterEach, describe, expect, it } from "vitest";
import { ROUTER_TEXT } from "../../packages/agent/src/http/app/router.ts";
import { TAB_TEXT } from "../../packages/agent/src/http/app/shell.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, person } from "./support/authority-world.ts";
import { El, page } from "./support/page-harness.ts";

const pat = person("pat-solo");
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const world = (script: FakeStep[] = []) => authorityWorld({ script, seed: [ada, pat] });
type World = ReturnType<typeof world>;
type Page = Awaited<ReturnType<typeof page>>;

/** A person's page booted at `path`, its requests on the world's real routes as that person. */
async function pageAt(w: World, who: string, path: string, plant?: (js: string) => string, hold?: (path: string) => Promise<void> | undefined) {
  const p = await page(
    {
      onSend() {},
      fetch: async (url, init) => {
        await hold?.(url);
        const r = await w.http(who, init?.method ?? "GET", url, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    { desktop: true, path },
    plant,
  );
  await settle();
  return p;
}
const address = (p: Page) => p.location.pathname + p.location.search + p.location.hash;
const lastSocket = (p: Page) => p.sockets.at(-1) as NonNullable<Page["sockets"][0]>;
const wsOf = (chat: string) => `wss://solo-sam.example/chats/${chat}/ws`;
/** The chat the page's newest socket is connected to. */
const socketChat = (p: Page) => /\/chats\/([^/]+)\/ws$/.exec(lastSocket(p).url ?? "")?.[1] ?? "";
/** Connects the page's newest socket and draws the chat's history into it, as the Chat sends it. */
function drawHistory(w: World, p: Page, chat: string) {
  const s = lastSocket(p);
  p.open(s);
  p.deliver(s, { type: "history", ...w.chats.harness(chat).instance.history() });
}
const midOf = (w: World, chat: string, text: string) => {
  const e = w.chats.harness(chat).instance.history().entries.find((x) => (x.kind === "agent" || x.kind === "you") && x.text.includes(text));
  return e && (e.kind === "agent" || e.kind === "you") ? e.mid : undefined;
};
const view = (p: Page) => p.byId("app").dataset.view;
const rowOf = (p: Page, chat: string) => p.byId("chats").children.find((r) => r.dataset.chat === chat) as El;
const scrolled: El[] = [];
El.prototype.scrollIntoView = function (this: El) {
  scrolled.push(this);
};
afterEach(() => {
  scrolled.length = 0;
});

describe("[F4] the router and the chat's address", () => {
  it("booted at /chats/<id> the page connects to that chat, not the last one, and the title names it", async () => {
    const w = world([{ text: "One." }, { text: "Two." }]);
    const first = (await w.say(ada.email, "First chat")).chatId;
    await w.http(ada.email, "POST", `/app/chats/${first}/rename`, { title: "Lisbon plans" });
    const second = (await w.say(ada.email, "Second chat")).chatId;
    expect(second).not.toBe(first);
    const p = await pageAt(w, ada.email, `/chats/${first}`);
    expect(p.sockets.map((s) => s.url)).toEqual([wsOf(first)]);
    expect([address(p), p.history.entries.length, view(p)]).toEqual([`/chats/${first}`, 1, "chat"]);
    expect(p.document.title).toBe(`Lisbon plans · ${ROUTER_TEXT.app}`);
  });

  it("booted at /chats/<id>#<mid> the page scrolls to the bubble with that mid once the history is drawn", async () => {
    const w = world([{ text: "The harbour opens at nine." }, { text: "Then lunch." }, { text: "Fine." }]);
    const { chatId } = await w.say(ada.email, "When does the harbour open?");
    await w.say(ada.email, "And after that?", chatId);
    await w.say(ada.email, "Thanks", chatId);
    const mid = midOf(w, chatId, "nine") as string;
    expect(mid).toBeTruthy();
    const p = await pageAt(w, ada.email, `/chats/${chatId}#${mid}`);
    expect(p.sockets.map((s) => s.url)).toEqual([wsOf(chatId)]);
    drawHistory(w, p, chatId);
    const last = scrolled.at(-1) as El;
    expect([last.dataset.mid, last.className.split(" ").includes("is-found")]).toEqual([mid, true]);
    expect(p.log.children.indexOf(last)).toBeLessThan(p.log.children.length - 1);
    expect(address(p)).toBe(`/chats/${chatId}#${mid}`);
  });

  it("at / the address becomes /chats/<last> by replaceState and no entry is pushed; Pat's home is Pat's own chat", async () => {
    const w = world([{ text: "One." }, { text: "Two." }]);
    await w.say(ada.email, "Old chat");
    await w.say(ada.email, "Newest chat");
    // The chat the person last had open, as their Person records it (M17.1).
    const last = ((await w.http(ada.email, "GET", "/app/chats")).body as { last: string }).last;
    const p = await pageAt(w, ada.email, "/");
    expect(p.sockets.map((s) => s.url)).toEqual([wsOf(last)]);
    expect([address(p), p.history.entries, p.history.index]).toEqual([`/chats/${last}`, [`/chats/${last}`], 0]);
    // Two members: Pat's home becomes Pat's own main chat, never Sam's.
    const q = await pageAt(w, pat.email, "/");
    const patMain = ((await w.http(pat.email, "GET", "/app/chats")).body as { main: string }).main;
    expect([address(q), q.history.entries.length]).toEqual([`/chats/${patMain}`, 1]);
    expect(patMain).not.toBe(last);
  });

  it("switching chats pushes /chats/<other>, and back() reopens the first", async () => {
    const w = world([{ text: "One." }, { text: "Two." }]);
    const first = (await w.say(ada.email, "First chat")).chatId;
    const second = (await w.say(ada.email, "Second chat")).chatId;
    const p = await pageAt(w, ada.email, `/chats/${first}`);
    await rowOf(p, second).children[0]?.onclick?.();
    await settle();
    expect([address(p), p.history.entries, lastSocket(p).url]).toEqual([`/chats/${second}`, [`/chats/${first}`, `/chats/${second}`], wsOf(second)]);
    p.history.back();
    await settle();
    expect([address(p), p.history.index, lastSocket(p).url, view(p)]).toEqual([`/chats/${first}`, 0, wsOf(first), "chat"]);
    // A new chat is pushed at its own address.
    await p.byId("new-chat").onclick?.();
    await settle();
    const made = socketChat(p);
    expect([address(p), p.history.entries.length, made === first || made === second]).toEqual([`/chats/${made}`, 2, false]);
  });

  it("/feed, /goals and /library draw their views and a reload keeps them; a tab pushes its path and back() returns to the chat", async () => {
    const w = world([{ text: "One." }]);
    const chat = (await w.say(ada.email, "A chat")).chatId;
    for (const v of ["feed", "goals", "library"] as const) {
      const p = await pageAt(w, ada.email, `/${v}`);
      expect([v, view(p), p.byId(v).hidden, address(p), p.document.title]).toEqual([v, v, false, `/${v}`, `${TAB_TEXT[v]} · ${ROUTER_TEXT.app}`]);
      // Reload: the same address boots the same view.
      const again = await pageAt(w, ada.email, address(p));
      expect([view(again), address(again)]).toEqual([v, `/${v}`]);
    }
    const p = await pageAt(w, ada.email, `/chats/${chat}`);
    await p.byId("rail-goals").onclick?.();
    expect([address(p), view(p), p.history.entries.length]).toEqual(["/goals", "goals", 2]);
    await p.byId("to-chat").onclick?.();
    expect([address(p), view(p), p.history.entries.length]).toEqual([`/chats/${chat}`, "chat", 3]);
    p.history.back();
    expect([address(p), view(p)]).toEqual(["/goals", "goals"]);
    p.history.back();
    expect([address(p), view(p)]).toEqual([`/chats/${chat}`, "chat"]);
  });

  it("booted at /library while the chats load, the address is still /library after /app/chats answers", async () => {
    const w = world([{ text: "One." }]);
    await w.say(ada.email, "A chat");
    let answer: () => void = () => {};
    const held = new Promise<void>((r) => (answer = r));
    const hold = (url: string) => (url === "/app/chats" ? held : undefined);
    const p = await pageAt(w, ada.email, "/library", undefined, hold);
    expect([address(p), view(p), p.sockets.length]).toEqual(["/library", "library", 0]);
    answer();
    await settle();
    // The chat connected in the background, and the address stayed the page the person opened.
    expect([address(p), view(p), p.sockets.length, p.history.entries]).toEqual(["/library", "library", 1, ["/library"]]);
    // Planted: the old open() that wrote the open chat into the address takes /library away.
    const planted = (js: string) => {
      const at = 'chatId = id; log.replaceChildren();';
      expect(js).toContain(at);
      return js.replace(at, 'history.replaceState(null, "", "?chat=" + encodeURIComponent(id) + location.hash); ' + at);
    };
    const broken = await pageAt(w, ada.email, "/library", planted);
    expect(address(broken)).not.toBe("/library");
  });

  it("a found message from the Search dialog and from the drawer filter lands at /chats/<id>#<mid>", async () => {
    const w = world([{ text: "The kestrel nests up high." }, { text: "Noted." }]);
    const bird = (await w.say(ada.email, "Tell me about the kestrel")).chatId;
    const other = (await w.say(ada.email, "Something else")).chatId;
    const mid = midOf(w, bird, "kestrel nests") as string;
    const p = await pageAt(w, ada.email, `/chats/${other}`);
    // The Search dialog.
    await p.byId("rail-search").onclick?.();
    const q = p.byId("search-q") as unknown as { value: string; oninput: () => unknown };
    q.value = "nests";
    await q.oninput();
    await settle();
    await p.byId("search-list").children[0]?.onclick?.();
    await settle();
    expect([address(p), lastSocket(p).url, p.history.entries.length]).toEqual([`/chats/${bird}#${mid}`, wsOf(bird), 2]);
    drawHistory(w, p, bird);
    expect(scrolled.at(-1)?.dataset.mid).toBe(mid);
    // Back to the other chat, then the drawer filter's row.
    p.history.back();
    await settle();
    expect(address(p)).toBe(`/chats/${other}`);
    const f = p.byId("chats-q") as unknown as { value: string; oninput: () => unknown };
    f.value = "nests";
    await f.oninput();
    await settle();
    await p.byId("chats-found").children.find((r) => r.dataset.chat === bird)?.children[0]?.onclick?.();
    await settle();
    expect([address(p), lastSocket(p).url]).toEqual([`/chats/${bird}#${mid}`, wsOf(bird)]);
    scrolled.length = 0;
    drawHistory(w, p, bird);
    expect(scrolled.at(-1)?.dataset.mid).toBe(mid);
  });

  it("a path that is no page draws the not-found page, which names the path as text and links home", async () => {
    const w = world();
    const p = await pageAt(w, ada.email, "/nowhere/<b>x</b>");
    expect([view(p), p.byId("nowhere").hidden, p.byId("chat").hidden]).toEqual(["nowhere", false, true]);
    const words = p.byId("nowhere-path");
    expect([words.textContent, words.children.length]).toEqual([ROUTER_TEXT.missing.replace("{path}", p.location.pathname), 0]);
    expect(p.document.title).toBe(`${ROUTER_TEXT.notFound} · ${ROUTER_TEXT.app}`);
    // The chat list loading in the background does not move the address off the path the person asked for.
    expect(address(p)).toBe(p.location.pathname);
    await (p.byId("nowhere-home").onclick as unknown as (e: { preventDefault(): void }) => unknown)({ preventDefault() {} });
    const open = socketChat(p);
    expect([view(p), address(p), p.history.entries.length]).toEqual(["chat", `/chats/${open}`, 2]);
  });
});
