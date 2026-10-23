// F3: the drawer's search filters the chats list in place, in the hermetic page harness of `m27-chat`. Every request
// goes through the authority world's real routes as Sam or Pat of solo-sam, so the filtered list is the dialog's
// `/app/search` answer for that person, drawn a second way; the model is the scripted fake. The drawer stays open
// while it filters, clearing or Escape gives the list back with its headings, and the rail still opens the dialog.
import { describe, expect, it } from "vitest";
import { CHATS_FILTER_TEXT } from "../../packages/agent/src/http/app/chats-filter.ts";
import { CHATS_TEXT } from "../../packages/agent/src/http/app/chats-list.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld, person } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const pat = person("pat-solo");
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const world = (script: FakeStep[] = []) => authorityWorld({ script, seed: [ada, pat] });
type World = ReturnType<typeof world>;
type Page = Awaited<ReturnType<typeof page>>;

async function pageOf(w: World, who: string, layout: Parameters<typeof page>[1] = {}) {
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const r = await w.http(who, init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    layout,
  );
  await settle();
  const s = p.sockets.at(-1) as NonNullable<Page["sockets"][0]>;
  p.open(s);
  p.deliver(s, { type: "history", entries: [], running: null });
  return p;
}
const q = (p: Page) => p.byId("chats-q") as unknown as { value: string; oninput: () => unknown; onkeydown: (e: { key: string; stopPropagation(): void }) => unknown };
async function filter(p: Page, text: string) {
  q(p).value = text;
  await q(p).oninput();
  await settle();
}
/** Escape in the field, as a browser delivers it: to the field, then to the document's listener unless the field stopped it. */
function escapeInField(p: Page) {
  let stopped = false;
  q(p).onkeydown({ key: "Escape", stopPropagation: () => (stopped = true) });
  if (!stopped) p.key("Escape");
  return stopped;
}
/** The filtered list: each row's chat, title and line, then the words (and code) of each line under them. */
const found = (p: Page) =>
  p.byId("chats-found").children.map((n) =>
    n.dataset.chat ? { chat: n.dataset.chat, title: n.children[0]?.children[0]?.textContent, line: (n.children[0]?.children[1]?.children[0]?.children ?? []).map((c) => c.textContent).join("") } : { words: n.textContent, code: n.dataset.code || null },
  );
const drawerOpen = (p: Page) => p.byId("drawer").parent?.id === "scrim" && !p.byId("drawer").hidden;
const headings = (p: Page) => p.byId("chats").children.filter((c) => c.className === "qf-listhead").map((c) => c.textContent);

describe("[F3] the drawer filters the chats list in place", () => {
  it("typing in the drawer's field draws only the matching chats with their lines, the drawer open throughout; no match says so; Pat sees none of Sam's", async () => {
    const w = world([{ text: "The kestrel nests up high." }, { text: "Noted." }]);
    const bird = await w.say(ada.email, "Tell me about the kestrel");
    await w.say(ada.email, "Something else entirely");
    const p = await pageOf(w, ada.email);
    await p.byId("open-chats").onclick?.();
    expect(drawerOpen(p)).toBe(true);
    await filter(p, "kestrel");
    expect([p.byId("chats").hidden, p.byId("chats-found").hidden, drawerOpen(p), p.byId("chats-clear").hidden]).toEqual([true, false, true, false]);
    expect(found(p)).toEqual([{ chat: bird.chatId, title: "New chat", line: "The kestrel nests up high." }]);
    // The match is a mark in the line, its own text node.
    const line = p.byId("chats-found").children[0]?.children[0]?.children[1]?.children[0] as El;
    expect(line.children.map((c) => [c.tag, c.textContent])).toEqual([["", "The "], ["mark", "kestrel"], ["", " nests up high."]]);
    await filter(p, "zebu");
    expect([found(p), drawerOpen(p)]).toEqual([[{ words: CHATS_FILTER_TEXT.none.replace("{q}", "zebu"), code: null }], true]);
    // Two members: Pat's drawer filter never draws Sam's chats.
    const other = await pageOf(w, pat.email);
    await other.byId("open-chats").onclick?.();
    await filter(other, "kestrel");
    expect(found(other)).toEqual([{ words: CHATS_FILTER_TEXT.none.replace("{q}", "kestrel"), code: null }]);
  });

  it("a chat that could not be searched is named with its code; a search that could not run says so with its code", async () => {
    const w = world([{ text: "The heron left." }, { text: "No heron here." }]);
    const good = await w.say(ada.email, "Where is the heron?");
    const broken = await w.say(ada.email, "Heron again");
    await w.http(ada.email, "POST", `/app/chats/${broken.chatId}/rename`, { title: "Bird log" });
    const app = (w.dir as unknown as { app: { chatSearch(p: string, c: string, q: string): Promise<unknown>; chats(p: string, call: unknown): Promise<unknown> } }).app;
    const real = app.chatSearch;
    app.chatSearch = async (who, c, text) => {
      if (c === broken.chatId) throw new Error("chat unreachable");
      return real(who, c, text);
    };
    const p = await pageOf(w, ada.email);
    await p.byId("open-chats").onclick?.();
    await filter(p, "heron");
    expect(found(p)).toEqual([
      { chat: good.chatId, title: "New chat", line: "The heron left." },
      { words: CHATS_FILTER_TEXT.unsearched.replace("{title}", "Bird log"), code: "APP_READ_FAILED" },
    ]);
    const chats = app.chats;
    app.chats = async () => ({ ok: false, code: "PERSON_UNREACHABLE" });
    await filter(p, "heron!");
    expect([found(p), drawerOpen(p)]).toEqual([[{ words: CHATS_FILTER_TEXT.notRead, code: "PERSON_UNREACHABLE" }], true]);
    app.chats = chats;
  });

  it("clearing the field or Escape in it restores the list with its headings and the drawer stays open; Escape in the empty field closes the drawer", async () => {
    const w = world([{ text: "Puffins are small." }]);
    await w.say(ada.email, "Puffin facts");
    const p = await pageOf(w, ada.email);
    await p.byId("open-chats").onclick?.();
    const full = { rows: p.byId("chats").children.filter((c) => c.dataset.chat).map((c) => c.dataset.chat), headings: headings(p) };
    expect(full.headings).toEqual([CHATS_TEXT.side]);
    await filter(p, "puffin");
    await p.byId("chats-clear").onclick?.();
    expect([q(p).value, p.byId("chats").hidden, p.byId("chats-found").hidden, p.byId("chats-clear").hidden, drawerOpen(p)]).toEqual(["", false, true, true, true]);
    expect({ rows: p.byId("chats").children.filter((c) => c.dataset.chat).map((c) => c.dataset.chat), headings: headings(p) }).toEqual(full);
    await filter(p, "puffin");
    expect(escapeInField(p)).toBe(true);
    expect([q(p).value, p.byId("chats").hidden, p.byId("chats-found").hidden, drawerOpen(p)]).toEqual(["", false, true, true]);
    // Typing it all away restores the list too.
    await filter(p, "puffin");
    await filter(p, "");
    expect([p.byId("chats").hidden, p.byId("chats-found").hidden, drawerOpen(p)]).toEqual([false, true, true]);
    // With nothing to clear, Escape is the drawer's again.
    expect(escapeInField(p)).toBe(false);
    expect(drawerOpen(p)).toBe(false);
  });

  it("an answer that lands after the field was cleared is not drawn", async () => {
    const w = world([{ text: "Lynx tracks." }]);
    await w.say(ada.email, "Lynx");
    const p = await pageOf(w, ada.email);
    await p.byId("open-chats").onclick?.();
    q(p).value = "lynx";
    const late = q(p).oninput();
    await p.byId("chats-clear").onclick?.();
    await late;
    await settle();
    expect([p.byId("chats").hidden, p.byId("chats-found").hidden, p.byId("chats-found").children]).toEqual([false, true, []]);
  });

  it("a filtered row opens its chat at the matched message; the rail's Search still opens the dialog over the drawer on a tablet", async () => {
    const w = world([{ text: "Otters hold hands." }, { text: "Sure." }]);
    const { chatId } = await w.say(ada.email, "Otter trivia please");
    await w.say(ada.email, "More", chatId);
    const p = await pageOf(w, ada.email, { tablet: true });
    await p.byId("chats-pill").onclick?.();
    expect(drawerOpen(p)).toBe(true);
    // The rail's Search opens the dialog over the drawer, and Escape closes only the dialog.
    await p.byId("rail-search").onclick?.();
    expect([p.byId("search").hidden, p.byId("search").parent?.className, drawerOpen(p)]).toEqual([false, "qf-scrim2 qf-scrim2--center", true]);
    p.key("Escape");
    expect([p.byId("search").hidden, drawerOpen(p)]).toEqual([true, true]);
    await filter(p, "hands");
    await p.byId("chats-found").children[0]?.children[0]?.onclick?.();
    await settle();
    const s = p.sockets.at(-1) as NonNullable<Page["sockets"][0]>;
    expect(s.url).toBe(`wss://solo-sam.example/chats/${chatId}/ws`);
    p.open(s);
    p.deliver(s, { type: "history", ...w.chats.harness(chatId).instance.history() });
    const flashed = p.log.children.filter((n) => n.className.split(" ").includes("is-found"));
    expect(flashed.map((n) => n.text())).toEqual([expect.stringContaining("Otters hold hands.")]);
  });
});
