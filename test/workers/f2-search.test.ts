// F2: message-content search. `/app/search` goes through the agent script's real `route` as Sam or Pat of
// solo-sam; the person's real `PersonChats` says which chats are theirs and each real `ChatEngine` searches its own
// thread for its owner (`searchChat`, which the `Chat` object's `search` calls). The model is the scripted fake.
import { describe, expect, it } from "vitest";
import { lineAround, SEARCH_LINE_MAX, searchChat } from "../../packages/agent/src/chat/search.ts";
import { SEARCH_ROWS } from "../../packages/agent/src/http/search-route.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, person } from "./support/authority-world.ts";

const pat = person("pat-solo");
type Row = { chatId: string; title: string; main: boolean; at: number; line?: string; mid?: string; match?: { start: number; end: number }; more: number };
type Answer = { ok: boolean; q: string; results: Row[]; unsearched: Array<{ chatId: string; title: string; code: string }>; memory: { ok: boolean }; recents?: Row[] };

const world = (script: FakeStep[] = [], extra: Parameters<typeof authorityWorld>[0] = {}) => authorityWorld({ script, seed: [ada, pat], ...extra });
type World = ReturnType<typeof world>;
const search = async (w: World, as: string, q: string) => {
  const r = await w.http(as, "GET", `/app/search?q=${encodeURIComponent(q)}`);
  expect(r.status).toBe(200);
  return r.body as unknown as Answer;
};
/** The drawn entry of a chat whose text holds `word`: what a hit must name. */
const drawn = (w: World, chatId: string, word: string) => {
  const e = w.chats.harness(chatId).instance.history().entries.find((x) => (x.kind === "you" || x.kind === "agent") && x.text.includes(word));
  if (!e || (e.kind !== "you" && e.kind !== "agent")) throw new Error(`nothing drawn holds ${word}`);
  return e;
};

describe("[F2] message-content search", () => {
  it("a word in the owner's own message and a word in the agent's reply each find the chat with the line, offsets, mid and time, in either case", async () => {
    const w = world([{ text: "Spring is the best season for Lisbon." }]);
    const { chatId } = await w.say(ada.email, "Let me think about a trip");
    const mine = drawn(w, chatId, "think");
    const theirs = drawn(w, chatId, "Spring");
    expect([mine.kind, theirs.kind]).toEqual(["you", "agent"]);
    const byMe = await search(w, ada.email, "THINK");
    expect(byMe.results).toEqual([{ chatId, title: "New chat", main: false, at: mine.at, line: "Let me think about a trip", mid: mine.mid, match: { start: 7, end: 12 }, more: 0 }]);
    expect(byMe.unsearched).toEqual([]);
    const byAgent = await search(w, ada.email, "lisbon");
    expect(byAgent.results).toEqual([{ chatId, title: "New chat", main: false, at: theirs.at, line: "Spring is the best season for Lisbon.", mid: theirs.mid, match: { start: 30, end: 36 }, more: 0 }]);
    expect(mine.at).toBe(w.clock.now);
  });

  it("a word only in a thinking block, a tool result or an injected input is not found", async () => {
    const w = world([{ toolCall: { id: "read-1", name: "page_fetch", arguments: { page: "p1" } }, reasoning: "Pondering the quokka question." }, { text: "Read it." }, { text: "Noted." }], { pages: { p1: "The page says marmot twice: marmot." } });
    const { chatId } = await w.say(ada.email, "Read page p1 please");
    const rows = w.chats.harness(chatId).rows("SELECT body FROM messages").map((r) => String(r.body)).join("\n");
    // Each word is in the chat's own transcript, so only what the thread draws keeps it out.
    expect([rows.includes("quokka"), rows.includes("marmot")]).toEqual([true, true]);
    expect(w.chats.harness(chatId).instance.history().entries.some((e) => e.kind === "thinking" && e.text.includes("quokka"))).toBe(true);
    expect((await search(w, ada.email, "quokka")).results).toEqual([]);
    expect((await search(w, ada.email, "marmot")).results).toEqual([]);
    // A colleague's request is an input the harness wrote into Pat's request chat, never typed by Pat.
    await w.request({ from: ada.email, to: pat.email, text: "Please look at the wombat budget", origin: ada.email, hops: 0, viaAgent: false });
    const patChats = w.chatsOf(pat.email);
    expect(patChats.some((id) => w.chats.harness(id).rows("SELECT body FROM messages").some((r) => String(r.body).includes("wombat")))).toBe(true);
    const answer = await search(w, pat.email, "wombat");
    expect([answer.results, answer.unsearched]).toEqual([[], []]);
    // The same search finds a word the thread does draw.
    expect((await search(w, ada.email, "read page")).results.map((r) => r.chatId)).toEqual([chatId]);
  });

  it("two matches in one chat are one row with more, the newest as its line", async () => {
    const w = world([{ text: "Sure, the harbour walk." }, { text: "Then the harbour ferry." }]);
    const { chatId } = await w.say(ada.email, "Plan the harbour day");
    w.clock.now += 60_000;
    await w.say(ada.email, "And after that?", chatId);
    const newest = drawn(w, chatId, "ferry");
    const r = (await search(w, ada.email, "harbour")).results;
    expect(r).toEqual([{ chatId, title: "New chat", main: false, at: newest.at, line: "Then the harbour ferry.", mid: newest.mid, match: { start: 9, end: 16 }, more: 2 }]);
  });

  it("a title match alone carries no line and the chat's time; a chat matched by title and by message carries the message's", async () => {
    const w = world([{ text: "Lisbon in April then." }]);
    const titled = (await w.http(ada.email, "POST", "/app/chats", { title: "Lisbon trip" })).body.chatId as string;
    const openedAt = w.clock.now;
    w.clock.now += 60_000;
    const r = (await search(w, ada.email, "lisbon")).results;
    expect(r).toEqual([{ chatId: titled, title: "Lisbon trip", main: false, at: openedAt, more: 0 }]);
    await w.say(ada.email, "When should we go?", titled);
    const said = drawn(w, titled, "April");
    expect((await search(w, ada.email, "lisbon")).results).toEqual([{ chatId: titled, title: "Lisbon trip", main: false, at: said.at, line: "Lisbon in April then.", mid: said.mid, match: { start: 0, end: 6 }, more: 0 }]);
  });

  it("the rows come newest first and stop at the row cap", async () => {
    const w = world(Array.from({ length: SEARCH_ROWS + 2 }, (_, i) => ({ text: `Reply ${i}.` })));
    const ids: string[] = [];
    for (let i = 0; i < SEARCH_ROWS + 2; i++) {
      w.clock.now += 1000;
      ids.push((await w.say(ada.email, `Note ${i} about otters`)).chatId);
    }
    const r = (await search(w, ada.email, "otters")).results;
    expect(r.map((x) => x.chatId)).toEqual([...ids].reverse().slice(0, SEARCH_ROWS));
    expect(r.map((x) => x.at)).toEqual([...r.map((x) => x.at)].sort((a, b) => b - a));
  });

  it("a second member's search never finds the owner's chat, and a Chat asked by anyone but its owner refuses with a code", async () => {
    const w = world([{ text: "Noted the pelican." }, { text: "Your own pelican." }]);
    const { chatId } = await w.say(ada.email, "Remember the pelican");
    expect((await search(w, ada.email, "pelican")).results.map((r) => r.chatId)).toEqual([chatId]);
    expect((await search(w, pat.email, "pelican")).results).toEqual([]);
    const own = await w.say(pat.email, "My pelican too");
    expect((await search(w, pat.email, "pelican")).results.map((r) => r.chatId)).toEqual([own.chatId]);
    // The Chat itself decides: Pat naming Sam's chat is refused on the directory's path and the object's.
    const dir = (w.dir as unknown as { app: { chatSearch(p: string, c: string, q: string): Promise<unknown> } }).app;
    expect(await dir.chatSearch(pat.email, chatId, "pelican")).toMatchObject({ ok: false, code: "CHAT_NOT_OWNER" });
    expect(searchChat(w.chats.harness(chatId).instance, pat.email, "pelican")).toMatchObject({ ok: false, code: "CHAT_NOT_OWNER" });
    expect(searchChat(w.chats.harness(chatId).instance, ada.email, "")).toMatchObject({ ok: false, code: "CHAT_SEARCH_QUERY_INVALID" });
    expect(searchChat(w.chats.harness(chatId).instance, ada.email, "x".repeat(81))).toMatchObject({ ok: false, code: "CHAT_SEARCH_QUERY_INVALID" });
  });

  it("a chat whose search throws or refuses is named with its code while the other chats' rows are still answered", async () => {
    const w = world([{ text: "The heron left." }, { text: "The heron came back." }, { text: "No heron here." }]);
    const good = await w.say(ada.email, "Where is the heron?");
    w.clock.now += 1000;
    const broken = await w.say(ada.email, "Heron again");
    w.clock.now += 1000;
    const refusing = await w.say(ada.email, "Heron once more");
    const app = (w.dir as unknown as { app: { chatSearch(p: string, c: string, q: string): Promise<unknown> } }).app;
    const real = app.chatSearch;
    app.chatSearch = async (p, c, q) => {
      if (c === broken.chatId) throw new Error("chat unreachable");
      if (c === refusing.chatId) return { ok: false, code: "CHAT_NOT_OWNER" };
      return real(p, c, q);
    };
    const r = await search(w, ada.email, "heron");
    expect(r.ok).toBe(true);
    expect(r.results.map((x) => x.chatId)).toEqual([good.chatId]);
    expect(r.unsearched).toEqual([
      { chatId: broken.chatId, title: "New chat", code: "APP_READ_FAILED" },
      { chatId: refusing.chatId, title: "New chat", code: "CHAT_NOT_OWNER" },
    ]);
    // A failed chat that matches by title still has its row, and is still named.
    await w.http(ada.email, "POST", `/app/chats/${broken.chatId}/rename`, { title: "Heron watch" });
    const t = await search(w, ada.email, "heron");
    // Its time is its opening, the newer of the two: a title row with no line. The good chat's newest is the reply, stored on the same tick as the question.
    expect([t.results.map((x) => [x.chatId, x.line ?? null]), t.unsearched.map((u) => u.chatId)]).toEqual([[[broken.chatId, null], [good.chatId, "The heron left."]], [broken.chatId, refusing.chatId]]);
  });

  it("a compacted message is not found; the messages kept after it still are", async () => {
    const w = world([{ text: "Old reply." }, { text: "New reply." }, { text: "Sam asked about the narwhal and the walrus." }]);
    const { chatId } = await w.say(ada.email, "Tell me about the narwhal");
    w.clock.now += 60_000;
    await w.say(ada.email, "And the walrus?", chatId);
    expect((await search(w, ada.email, "narwhal")).results.map((r) => r.chatId)).toEqual([chatId]);
    expect(await w.chats.harness(chatId).instance.compactNow(ada.email)).toMatchObject({ ok: true, record: { status: "done" } });
    const folded = w.chats.harness(chatId).rows("SELECT body FROM messages WHERE compacted = 1").map((r) => String(r.body));
    expect(folded.some((b) => b.includes("narwhal"))).toBe(true);
    expect(w.chats.harness(chatId).rows("SELECT body FROM messages WHERE compacted = 0").some((r) => String(r.body).includes("walrus"))).toBe(true);
    expect((await search(w, ada.email, "narwhal")).results).toEqual([]);
    expect((await search(w, ada.email, "walrus")).results.map((r) => r.chatId)).toEqual([chatId]);
  });

  it("recents are the person's live chats by last connection, newest first", async () => {
    const w = world();
    const main = ((await w.http(ada.email, "GET", "/app/chats")).body.main) as string;
    w.clock.now += 1000;
    const a = (await w.http(ada.email, "POST", "/app/chats", { title: "Alpha" })).body.chatId as string;
    w.clock.now += 1000;
    const b = (await w.http(ada.email, "POST", "/app/chats", { title: "Beta" })).body.chatId as string;
    w.clock.now += 1000;
    const archived = (await w.http(ada.email, "POST", "/app/chats", { title: "Gone" })).body.chatId as string;
    await w.http(ada.email, "POST", `/app/chats/${archived}/archive`, {});
    // Opened Alpha then Beta; the person was last in Alpha, then in the main chat.
    w.clock.now += 1000;
    expect(w.host(ada.email).chats.connected(a, w.clock.now)).toBe(true);
    w.clock.now += 1000;
    expect(w.host(ada.email).chats.connected(main, w.clock.now)).toBe(true);
    const r = (await w.http(ada.email, "GET", "/app/search?q=")).body as unknown as Answer;
    expect((r.recents ?? []).map((x) => [x.chatId, x.at])).toEqual([[main, w.clock.now], [a, w.clock.now - 1000], [b, w.clock.now - 3000]]);
  });

  it("the answer keeps the fields the [M27.3] dialog draws; marked text in a message and in a query comes back as text, never markup", async () => {
    const w = world([{ text: "I <i>see</i>." }]);
    const { chatId } = await w.say(ada.email, "Make it <b>bold</b> & clear");
    const r = await search(w, ada.email, "<b>bold</b>");
    expect(r.q).toBe("<b>bold</b>");
    expect(r.results).toHaveLength(1);
    const row = r.results[0] as Row;
    expect([row.chatId, typeof row.title, typeof row.at, row.main, row.line, row.line?.slice(row.match?.start, row.match?.end)]).toEqual([chatId, "string", "number", false, "Make it <b>bold</b> & clear", "<b>bold</b>"]);
    expect(r.memory).toMatchObject({ ok: true });
    expect((await search(w, ada.email, "<i>")).results.map((x) => x.line)).toEqual(["I <i>see</i>."]);
  });

  it("a line is at most 120 characters around the first match, cut with an ellipsis, its offsets on the match", async () => {
    const w = world([{ text: "ok" }]);
    const long = `${"a".repeat(200)} the kestrel ${"b".repeat(50)} kestrel ${"c".repeat(200)}`;
    const { chatId } = await w.say(ada.email, long);
    const row = (await search(w, ada.email, "KESTREL")).results[0] as Row;
    expect(row.chatId).toBe(chatId);
    expect((row.line as string).length).toBeLessThanOrEqual(SEARCH_LINE_MAX);
    expect([row.line?.startsWith("…"), row.line?.endsWith("…"), row.line?.slice(row.match?.start, row.match?.end)]).toEqual([true, true, "kestrel"]);
    // The first of the two matches is the one the line is around.
    expect(row.line?.indexOf("kestrel")).toBe(row.match?.start);
    // A match at the very start or end of a long text keeps one ellipsis, on the far side.
    const head = lineAround(`kestrel${"x".repeat(300)}`, 0, 7);
    const tail = lineAround(`${"x".repeat(300)}kestrel`, 300, 307);
    expect([head.line.length <= SEARCH_LINE_MAX, head.line.startsWith("kestrel"), head.line.endsWith("…"), head.match]).toEqual([true, true, true, { start: 0, end: 7 }]);
    expect([tail.line.length <= SEARCH_LINE_MAX, tail.line.endsWith("kestrel"), tail.line.slice(tail.match.start, tail.match.end)]).toEqual([true, true, "kestrel"]);
  });
});
