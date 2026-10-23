// F3: the Search dialog's rows on F2's answer, in the hermetic page harness of `m27-chat`. Every request goes through
// the authority world's real routes as Sam or Pat of solo-sam, so a row is the owning `Chat`'s answer for that
// person; the model is the scripted fake. A row is the chat's title, the matched line with the match in a mark (every
// part a text node) and when; choosing it opens the chat at that message; Enter opens the active row; one Clear is the
// field's only control and no field in the app is `type="search"`.
import { afterEach, describe, expect, it } from "vitest";
import { CHATS_TEXT } from "../../packages/agent/src/http/app/chats-list.ts";
import { SEARCH_TEXT } from "../../packages/agent/src/http/app/permission-words.ts";
import { SEARCH_DIALOG_TEXT } from "../../packages/agent/src/http/app/search.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
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

/** A person's page whose requests go to the world's real routes as that person, its first socket opened on an empty chat. */
async function pageOf(w: World, who: string, fetch?: (path: string) => Promise<Response | null>) {
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const fixed = await fetch?.(path);
        if (fixed) return fixed;
        const r = await w.http(who, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    { desktop: true },
  );
  await settle();
  const s = p.sockets.at(-1) as NonNullable<Page["sockets"][0]>;
  p.open(s);
  p.deliver(s, { type: "history", entries: [], running: null });
  return p;
}
const field = (p: Page, id = "search-q") => p.byId(id) as unknown as { value: string; oninput: () => unknown; onkeydown: (e: { key: string; preventDefault(): void; stopPropagation(): void }) => unknown };
async function query(p: Page, q: string) {
  field(p).value = q;
  await field(p).oninput();
  await settle();
}
const key = (p: Page, k: string, id = "search-q") => field(p, id).onkeydown({ key: k, preventDefault() {}, stopPropagation() {} });
const enter = async (p: Page) => {
  await p.byId("search-bar").onsubmit?.({ preventDefault() {} });
  await settle();
};
/** A drawn row: its title, its line as [tag, text] parts (a mark is `mark`, a text node ``) and its time. */
function rowOf(r: El) {
  const body = r.children[1] as El;
  const snip = body.children[1] as El;
  const line = snip.children[0] as El;
  return { title: body.children[0]?.textContent, line: line.children.map((c) => [c.tag, c.textContent, c.children.length]), when: snip.children[1]?.textContent };
}
const results = (p: Page) => p.byId("search-list").children;
/** Every element the page script scrolled into view, in order: `scrollIntoView` recorded on the harness's elements. */
const scrolled: El[] = [];
El.prototype.scrollIntoView = function (this: El) {
  scrolled.push(this);
};
afterEach(() => {
  scrolled.length = 0;
});

describe("[F3] the Search dialog's rows", () => {
  it("a row draws the title, the line with the match in a mark as a text node and the relative time; markup in a line comes back as text; Pat finds none of Sam's", async () => {
    const w = world([{ text: "Noted, the ferry it is." }]);
    const { chatId } = await w.say(ada.email, "Book the <b>harbour</b> ferry for us");
    const p = await pageOf(w, ada.email);
    await p.byId("rail-search").onclick?.();
    await query(p, "harbour");
    expect(results(p).map((r) => [r.dataset.chat, r.attrs.role])).toEqual([[chatId, "option"]]);
    const row = rowOf(results(p)[0] as El);
    // Each part is a node with text and no children: the mark holds "harbour", the angle brackets stay text around it.
    expect([row.title, row.line]).toEqual(["New chat", [["", "Book the <b>", 0], ["mark", "harbour", 0], ["", "</b> ferry for us", 0]]]);
    expect(row.when).toBeTruthy();
    // A title match alone draws the chat's kind as its line, as today.
    await w.http(ada.email, "POST", "/app/chats", { title: "Lisbon plans" });
    await query(p, "lisbon");
    expect(results(p).map((r) => rowOf(r)).map((r) => [r.title, r.line])).toEqual([["Lisbon plans", [["", SEARCH_DIALOG_TEXT.side, 0]]]]);
    // Two members: Pat's search never finds Sam's chats.
    const q = await pageOf(w, pat.email);
    await q.byId("rail-search").onclick?.();
    await query(q, "harbour");
    expect([results(q), q.byId("search-note").textContent]).toEqual([[], SEARCH_DIALOG_TEXT.noResults.replace("{q}", "harbour")]);
  });

  it("the time is minutes and hours within the last day, then the list's Yesterday, weekday and date labels, from one helper", async () => {
    const now = Date.now();
    const old = Date.UTC(2020, 0, 15, 12);
    const rows = [
      { chatId: "c1", title: "A", main: false, at: now - 20_000, line: "a", more: 0 },
      { chatId: "c2", title: "B", main: false, at: now - 5 * 60_000, line: "b", more: 0 },
      { chatId: "c3", title: "C", main: false, at: now - 3 * 3_600_000, line: "c", more: 0 },
      { chatId: "c4", title: "D", main: false, at: old, line: "d", more: 0 },
    ];
    const w = world();
    const p = await pageOf(w, ada.email, async (path) => (path.startsWith("/app/search?q=x") ? new Response(JSON.stringify({ ok: true, q: "x", results: rows, unsearched: [], memory: { ok: true, unplaced: 0 } })) : null));
    await p.byId("rail-search").onclick?.();
    await query(p, "x");
    const dated = new Date(old).toLocaleDateString([], { month: "short", day: "numeric" });
    expect(results(p).map((r) => rowOf(r).when)).toEqual([CHATS_TEXT.justNow, CHATS_TEXT.minutes.replace("{n}", "5"), CHATS_TEXT.hours.replace("{n}", "3"), dated]);
    // The drawer's filter draws the same times from the same helper.
    field(p, "chats-q").value = "x";
    await field(p, "chats-q").oninput();
    await settle();
    expect(p.byId("chats-found").children.map((r) => r.children[0]?.children[1]?.children[1]?.textContent)).toEqual(results(p).map((r) => rowOf(r).when));
  });

  it("choosing a result connects to that chat and, once its history is drawn, scrolls to the bubble with its mid and flashes it", async () => {
    const w = world([{ text: "The harbour opens at nine." }, { text: "Then lunch." }, { text: "Fine." }]);
    const { chatId } = await w.say(ada.email, "When does the harbour open?");
    await w.say(ada.email, "And after that?", chatId);
    await w.say(ada.email, "Thanks", chatId);
    const p = await pageOf(w, ada.email);
    await p.byId("rail-search").onclick?.();
    await query(p, "nine");
    const hit = w.chats.harness(chatId).instance.history().entries.find((e) => (e.kind === "agent" || e.kind === "you") && e.text.includes("nine"));
    const mid = hit && (hit.kind === "agent" || hit.kind === "you") ? hit.mid : undefined;
    expect(mid).toBeTruthy();
    await results(p)[0]?.onclick?.();
    await settle();
    const s = p.sockets.at(-1) as NonNullable<Page["sockets"][0]>;
    expect([p.byId("search").hidden, s.url]).toEqual([true, `wss://solo-sam.example/chats/${chatId}/ws`]);
    p.open(s);
    scrolled.length = 0;
    p.deliver(s, { type: "history", ...w.chats.harness(chatId).instance.history() });
    const last = scrolled.at(-1) as El;
    expect([last.dataset.mid, last.className.split(" ").includes("is-found")]).toEqual([mid, true]);
    // The newest messages are below it: the thread was not left at its end.
    expect(p.log.children.indexOf(last)).toBeLessThan(p.log.children.length - 1);
    // Contrast: the same chat drawn again (a reconnect) seeks nothing, so the thread is left at its end.
    scrolled.length = 0;
    p.deliver(s, { type: "history", ...w.chats.harness(chatId).instance.history() });
    expect(scrolled.at(-1)).toBe(p.log.children.at(-1));
    // A result chosen, then another chat opened before its history came: the later visit to the first seeks nothing.
    await p.byId("rail-search").onclick?.();
    await query(p, "nine");
    await results(p)[0]?.onclick?.();
    await settle();
    const mainRow = p.byId("chats").children.find((r) => r.dataset.chat && r.dataset.chat !== chatId) as El;
    await mainRow.children[0]?.onclick?.();
    const back = p.byId("chats").children.find((r) => r.dataset.chat === chatId) as El;
    await back.children[0]?.onclick?.();
    const s2 = p.sockets.at(-1) as NonNullable<Page["sockets"][0]>;
    expect(s2.url).toBe(`wss://solo-sam.example/chats/${chatId}/ws`);
    p.open(s2);
    p.deliver(s2, { type: "history", ...w.chats.harness(chatId).instance.history() });
    expect(p.log.children.filter((n) => n.className.split(" ").includes("is-found"))).toEqual([]);
  });

  it("Enter opens the first row; the arrow keys move the active row and Enter opens that one; an Enter before the answer opens its first row when it lands", async () => {
    const w = world([{ text: "Otter one." }, { text: "Otter two." }]);
    const older = await w.say(ada.email, "Otter question");
    w.clock.now += 60_000;
    const newer = await w.say(ada.email, "Otter again");
    const p = await pageOf(w, ada.email);
    await p.byId("rail-search").onclick?.();
    await query(p, "otter");
    expect(results(p).map((r) => [r.dataset.chat, r.attrs["aria-selected"]])).toEqual([[newer.chatId, "true"], [older.chatId, "false"]]);
    await enter(p);
    expect([p.byId("search").hidden, p.sockets.at(-1)?.url]).toEqual([true, `wss://solo-sam.example/chats/${newer.chatId}/ws`]);
    await p.byId("rail-search").onclick?.();
    await query(p, "otter");
    key(p, "ArrowDown");
    key(p, "ArrowDown");
    expect(results(p).map((r) => r.attrs["aria-selected"])).toEqual(["false", "true"]);
    expect(p.byId("search-q").attrs["aria-activedescendant"]).toBe(results(p)[1]?.id);
    key(p, "ArrowUp");
    key(p, "ArrowDown");
    await enter(p);
    expect(p.sockets.at(-1)?.url).toBe(`wss://solo-sam.example/chats/${older.chatId}/ws`);
    // Enter typed before the query's answer is drawn waits for it, and opens its first row, never a stale one.
    await p.byId("rail-search").onclick?.();
    await settle();
    field(p).value = "otter";
    const pending = field(p).oninput();
    await enter(p);
    await pending;
    await settle();
    expect([p.byId("search").hidden, p.sockets.at(-1)?.url]).toEqual([true, `wss://solo-sam.example/chats/${newer.chatId}/ws`]);
  });

  it("an empty query lists recents; Clear is hidden without a query and shown with one, and is the field's one control", async () => {
    const w = world();
    await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" });
    const p = await pageOf(w, ada.email);
    await p.byId("rail-search").onclick?.();
    await settle();
    expect([p.byId("search-heading").textContent, p.byId("search-clear").hidden, results(p).length]).toEqual([SEARCH_TEXT.recents, true, 2]);
    await query(p, "trip");
    expect([p.byId("search-heading").textContent, p.byId("search-clear").hidden]).toEqual([SEARCH_TEXT.results, false]);
    await p.byId("search-clear").onclick?.();
    await settle();
    expect([p.byId("search-q").value, p.byId("search-clear").hidden, p.byId("search-heading").textContent]).toEqual(["", true, SEARCH_TEXT.recents]);
    // The bar holds the field, Clear and the hidden Cancel: no other close control is drawn.
    expect(p.byId("search-bar").children.map((c) => c.id)).toEqual(["search-q", "search-clear", "search-cancel"]);
    expect(APP_PAGE).toContain('<button id="search-cancel" type="button" class="vh">');
  });

  it("no search field in the app page is type=search; each is type=text with enterkeyhint=search (planted: the old field fails it)", () => {
    const searchTyped = (html: string) => [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((t) => /type="search"/.test(t)).map((t) => /id="([^"]+)"/.exec(t)?.[1]);
    const fields = (html: string) => [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((t) => /enterkeyhint="search"/.test(t)).map((t) => [/id="([^"]+)"/.exec(t)?.[1], /type="([^"]+)"/.exec(t)?.[1]]);
    expect(searchTyped(APP_PAGE)).toEqual([]);
    expect(fields(APP_PAGE).sort()).toEqual([["chats-q", "text"], ["conn-search", "text"], ["search-q", "text"]]);
    const planted = APP_PAGE.replace('<input id="search-q" type="text"', '<input id="search-q" type="search"');
    expect(planted).not.toBe(APP_PAGE);
    expect(searchTyped(planted)).toEqual(["search-q"]);
  });

  it("a chat that could not be searched is named with its code under the rows that were found", async () => {
    const w = world([{ text: "The heron left." }, { text: "No heron here." }]);
    const good = await w.say(ada.email, "Where is the heron?");
    w.clock.now += 1000;
    const broken = await w.say(ada.email, "Heron again");
    await w.http(ada.email, "POST", `/app/chats/${broken.chatId}/rename`, { title: "Bird log" });
    const app = (w.dir as unknown as { app: { chatSearch(p: string, c: string, q: string): Promise<unknown> } }).app;
    const real = app.chatSearch;
    app.chatSearch = async (who, c, q) => (c === broken.chatId ? { ok: false, code: "CHAT_NOT_OWNER" } : real(who, c, q));
    const p = await pageOf(w, ada.email);
    await p.byId("rail-search").onclick?.();
    await query(p, "heron");
    expect(results(p).map((r) => r.dataset.chat)).toEqual([good.chatId]);
    expect(p.byId("search-unsearched").children.map((c) => [c.textContent, c.dataset.code])).toEqual([[SEARCH_DIALOG_TEXT.unsearched.replace("{title}", "Bird log"), "CHAT_NOT_OWNER"]]);
    // The next answer with every chat searched names none.
    app.chatSearch = real;
    await query(p, "heron");
    expect(p.byId("search-unsearched").children).toEqual([]);
  });
});
