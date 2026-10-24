// M27.3: chat and search on the Fletch system (the canvas's `Main`: MessageBubble, Composer, ListRow, SearchDialog),
// the BUILD-ONLY thread objects on the system's nearest component, and Compact in the chat's More menu. The page is
// the shipped script under the page harness; its requests go to the agent script's real `route` as Ada or Bo of
// solo-sam, so a list, a rename, an archive or a search is the owning store's answer for that person. The model is
// the scripted fake. A hermetic DOM cannot see layout: what it holds is which class each entry and control takes,
// which node a menu or an overlay holds and what each says. The pixels are `pnpm screens` against the boards
// (`pnpm design-diff --only chat,drawer,archived,search`), run on staging and recorded in DECISIONS-LOG.
import { describe, expect, it } from "vitest";
import { ATTACH_TEXT, CHAT_MARKUP, JOB_BUTTON_TEXT, NOT_SENT_TEXT, NOTICE_CHIPS, STOP_TEXT, WORKING_TEXT } from "../../packages/agent/src/http/app/chat.ts";
import { CHATS_TEXT } from "../../packages/agent/src/http/app/chats-list.ts";
import { MESSAGE_TEXT } from "../../packages/agent/src/http/app/message-actions.ts";
import { SEARCH_TEXT } from "../../packages/agent/src/http/app/permission-words.ts";
import { SEARCH_DIALOG_TEXT } from "../../packages/agent/src/http/app/search.ts";
import { APP_PAGE } from "../../packages/agent/src/http/page.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { type El, page } from "./support/page-harness.ts";

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
type Layout = Parameters<typeof page>[1];
type World = ReturnType<typeof authorityWorld>;

/** A person's page whose requests go to the world's real routes as that person; its socket opened on an empty chat. */
async function pageOf(w: World, person: string, layout: Layout = {}) {
  const posted: Array<{ path: string; body: unknown }> = [];
  const p = await page(
    {
      onSend() {},
      fetch: async (path, init) => {
        const body = init?.body ? JSON.parse(init.body) : undefined;
        if (init?.method === "POST") posted.push({ path, body });
        const r = await w.http(person, init?.method ?? "GET", path, body);
        return new Response(JSON.stringify(r.body), { status: r.status });
      },
    },
    layout,
  );
  await settle();
  const s = p.sockets.at(-1) as NonNullable<(typeof p.sockets)[0]>;
  p.open(s);
  p.deliver(s, { type: "history", entries: [], running: null });
  return { ...p, s, posted };
}
/** A page on fixed answers (no world): the thread's drawing alone. */
async function threadPage(layout: Layout = {}) {
  const p = await page({ onSend() {} }, layout);
  const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
  p.open(s);
  p.deliver(s, { type: "history", entries: [], running: null });
  return { ...p, s };
}
const bubbleOf = (n: El | undefined) => n?.children.find((c) => c.className.startsWith("qf-bubble"));
const corners = (p: { log: El }) => p.log.children.map((n) => [n.className, bubbleOf(n)?.className ?? null]);
/** The chats list's rows: the label, the kind and the dot each wears, and whether it has options. */
const rows = (host: El) =>
  host.children
    .filter((r) => r.dataset.chat)
    .map((r) => {
      const b = r.children[0] as El;
      const kind = b.children.find((c) => c.className === "kind");
      const dot = b.children.find((c) => c.className === "unread");
      return { title: b.children[0]?.textContent, kind: kind?.textContent ?? null, unread: dot ? !dot.hidden : null, options: !!kebabOf(r), current: b.attrs["aria-current"] ?? null };
    });
/** A row's kebab: the button in its end (ListRow's `.qf-row-end`, after the time), or undefined for the main chat. */
const kebabOf = (r: El) => r.children[1]?.children.find((c) => c.tag === "button") as El | undefined;
const rowOf = (host: El, title: string) => host.children.find((r) => r.dataset.chat && r.children[0]?.children[0]?.textContent === title) as El;
const menuItems = (p: { byId(id: string): El }) => p.byId("menu").children.map((c) => c.id || c.text());

describe("[M27.3] the thread on MessageBubble", () => {
  it("each message is the canvas's .msg holding the bubble; a run from one side groups its corners, and anything else breaks the run", async () => {
    const p = await threadPage();
    p.deliver(p.s, {
      type: "history",
      running: null,
      entries: [
        { kind: "you", text: "Is the orchard walk on?", id: "a" },
        { kind: "you", text: "And who leads it?", id: "b" },
        { kind: "you", text: "Bring boots?", id: "c" },
        { kind: "agent", text: "Yes, at nine." },
        { kind: "agent", text: "Lee leads it." },
        { kind: "note", text: "Not sent: the message was empty." },
        { kind: "agent", text: "Boots, yes." },
      ],
    });
    expect(corners(p)).toEqual([
      ["m you", "qf-bubble qf-bubble--user qf-bubble--first"],
      ["m you", "qf-bubble qf-bubble--user qf-bubble--mid"],
      ["m you", "qf-bubble qf-bubble--user qf-bubble--last"],
      ["m agent", "qf-bubble qf-bubble--agent qf-bubble--first"],
      ["m agent", "qf-bubble qf-bubble--agent qf-bubble--last"],
      ["m note", null],
      ["m agent", "qf-bubble qf-bubble--agent"],
    ]);
    // A live message joins the run before it: the single agent bubble becomes the first of two. It alone fades in
    // (MessageBubble, .qf-msg-new, M29.6); the ones drawn from history do not.
    p.deliver(p.s, { type: "message", text: "Gloves too." });
    expect(corners(p).slice(-2)).toEqual([
      ["m agent", "qf-bubble qf-bubble--agent qf-bubble--first"],
      ["m agent", "qf-bubble qf-bubble--agent qf-bubble--last qf-msg-new"],
    ]);
    // Message content is data: markup in a message is drawn as its text.
    p.deliver(p.s, { type: "message", text: "<img src=x onerror=alert(1)>" });
    expect(bubbleOf(p.log.children.at(-1))?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("the date divider sits between entries a day or an hour apart: the day across a day, the time inside one", async () => {
    const p = await threadPage();
    const day = new Date(2026, 9, 14, 9, 0).getTime();
    p.deliver(p.s, {
      type: "history",
      running: null,
      entries: [
        { kind: "you", text: "Morning.", at: day },
        { kind: "agent", text: "Morning, Ada.", at: day + 60_000 },
        { kind: "you", text: "Lunch?", at: day + 3 * 3_600_000 },
        { kind: "you", text: "Next day.", at: day + 26 * 3_600_000 },
      ],
    });
    const dividers = p.log.children.filter((n) => n.className === "m when");
    expect(dividers.map((d) => [d.children[0]?.className, d.dataset.at])).toEqual([
      ["qf-stamp", String(day + 3 * 3_600_000)],
      ["qf-stamp", String(day + 26 * 3_600_000)],
    ]);
    expect(dividers[0]?.text()).toBe(new Date(day + 3 * 3_600_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    expect(dividers[1]?.text()).toBe(new Date(day + 26 * 3_600_000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }));
    // A divider breaks a run: the two sends either side of the hour's gap are single bubbles.
    expect(corners(p).map(([, b]) => b)).toEqual(["qf-bubble qf-bubble--user", "qf-bubble qf-bubble--agent", null, "qf-bubble qf-bubble--user", null, "qf-bubble qf-bubble--user"]);
    // Today's and yesterday's dividers say so.
    const q = await threadPage();
    const now = Date.now();
    q.deliver(q.s, { type: "history", running: null, entries: [{ kind: "you", text: "a", at: now - 86_400_000 }, { kind: "you", text: "b", at: now }] });
    expect(q.log.children.find((n) => n.className === "m when")?.text()).toBe(CHATS_TEXT.today);
  });

  it("the thinking line is the streaming dots and its words; streamed text fades in a span at a time and reads as one reply", async () => {
    const p = await threadPage();
    p.deliver(p.s, { type: "turn_started", turn: "t1", id: null, text: "" });
    p.deliver(p.s, { type: "reasoning", turn: "t1", text: "private reasoning" });
    const line = p.log.children.at(-1) as El;
    expect([line.className, line.children.map((c) => c.className), line.text()]).toEqual(["m shimmer", ["qf-dots", "t-foot t-2"], WORKING_TEXT.thinking]);
    expect(line.children[0]?.children.map((c) => c.tag)).toEqual(["b", "b", "b"]);
    expect(p.log.text()).not.toContain("private reasoning");
    // The status line over the composer wears the dots too, with Stop as a Button.
    expect([p.byId("status-row").hidden, p.byId("stop").hidden]).toEqual([false, false]);
    expect(CHAT_MARKUP).toContain(`<button id="stop" class="qf-btn qf-btn--secondary" hidden>${STOP_TEXT.button}</button>`);
    for (const text of ["The walk ", "starts at ", "nine."]) p.deliver(p.s, { type: "delta", turn: "t1", text });
    expect(p.log.children.some((n) => n.className === "m shimmer")).toBe(false);
    const reply = bubbleOf(p.log.children.at(-1)) as El;
    expect([reply.dataset.flow, reply.children.map((c) => [c.tag, c.className, c.textContent])]).toEqual([
      "1",
      [
        ["span", "w qf-stream-chunk", "The walk "],
        ["span", "w qf-stream-chunk", "starts at "],
        ["span", "w qf-stream-chunk", "nine."],
      ],
    ]);
    expect(p.bubbles().at(-1)).toEqual(["m agent", "The walk starts at nine."]);
    // The fade is the system's (M29.6): the bundle's stream-chunk rule, off under reduced motion.
    expect(APP_PAGE).toContain(".qf-msg-new,.qf-stream-chunk{animation:qf-fade-a var(--qf-dur-fast) var(--qf-ease-css)}");
    expect(APP_PAGE).toMatch(/prefers-reduced-motion: ?reduce\)[^@]*\.qf-msg-new,\.qf-stream-chunk[^{]*\{animation:none!important\}/);
    expect(APP_PAGE).not.toContain("chat-word");
  });
});

describe("[M27.3] the composer on Composer", () => {
  it("attach + opens the row, the chips sit in the pill above the message, Send shows only with something to send, and no dictate is drawn", async () => {
    expect(CHAT_MARKUP).toMatch(/<form id="f" class="qf-composer qf-composer--stack"[^>]*><div id="reply-chip" class="qf-quote" hidden>.*?<\/div><\/div><div id="attached" hidden><\/div><div class="composer-row"><button type="button" id="attach" class="qf-ibtn qf-ibtn--32"/);
    expect(CHAT_MARKUP).not.toMatch(/[Dd]ictate|<path d="M12 2a3/);
    const p = await threadPage();
    expect([p.byId("t").disabled, p.byId("t").placeholder, p.byId("send").hidden]).toEqual([false, "Message", true]);
    p.byId("t").value = "Is the walk on?";
    await (p.byId("t") as unknown as { oninput: () => unknown }).oninput();
    expect(p.byId("send").hidden).toBe(false);
    p.byId("t").value = "  ";
    await (p.byId("t") as unknown as { oninput: () => unknown }).oninput();
    expect(p.byId("send").hidden).toBe(true);
    // A sent message clears the draft and Send goes with it.
    await p.type("Is the walk on?");
    expect([p.byId("t").value, p.byId("send").hidden, p.bubbles().at(-1)]).toEqual(["", true, ["m you pending", "Is the walk on?"]]);
  });

  it("a staged file is a Chip in the pill and shows Send; a refused upload is a refused Chip in the route's words, with its code", async () => {
    let answer: Response = new Response(JSON.stringify({ ok: true, attachment: { id: "att-1", name: "orchard.pdf" } }), { status: 200 });
    const p = await page({ onSend() {}, fetch: async (path) => (path === "/app/attachments" ? answer : null) });
    const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
    p.open(s);
    p.deliver(s, { type: "history", entries: [], running: null });
    Object.assign(p.byId("file"), { files: [new File(["x"], "orchard.pdf")] });
    await (p.byId("file") as unknown as { onchange: () => unknown }).onchange();
    await settle();
    const chip = p.byId("attached").children[0] as El;
    expect([chip.className, chip.text(), p.byId("send").hidden]).toEqual(["qf-chip chip", "orchard.pdf ×", false]);
    answer = new Response(JSON.stringify({ ok: false, code: "ATTACHMENT_TYPE_REFUSED", words: "That kind of file cannot be attached." }), { status: 415 });
    Object.assign(p.byId("file"), { files: [new File(["x"], "tool.exe")] });
    await (p.byId("file") as unknown as { onchange: () => unknown }).onchange();
    await settle();
    const refused = p.byId("attached").children[1] as El;
    expect([refused.className, refused.dataset.code, refused.text()]).toEqual(["qf-chip chip refused", "ATTACHMENT_TYPE_REFUSED", "That kind of file cannot be attached. ×"]);
    expect(ATTACH_TEXT.attach).toBe("Attach");
  });
});

describe("[M27.3] the chats list on ListRow", () => {

  it("a chat with a card waiting wears the unread dot as meta for Ada, whose card it is, and for Bo nothing", async () => {
    const w = authorityWorld({ script: [{ toolCall: { id: "m1", name: "mail_send", arguments: { to: other.email, body: "Notes." } } }] });
    await w.say(ada.email, "Mail Bo the notes.");
    const pa = await pageOf(w, ada.email, { desktop: true });
    const pb = await pageOf(w, other.email, { desktop: true });
    // The turn ran in a new side chat; its row carries the dot, the main row does not.
    const ra = rows(pa.byId("chats"));
    expect(ra.map((r) => r.unread)).toEqual([false, true]);
    expect(rowOf(pa.byId("chats"), ra[1]?.title as string).children[0]?.className).toBe("qf-listrow qf-listrow--unread");
    expect(rows(pb.byId("chats")).map((r) => [r.title, r.unread])).toEqual([[CHATS_TEXT.main, false]]);
  });

  it("a side chat's options open Rename and Archive through openMenu, a popover from 768 and an action sheet on a phone", async () => {
    const w = authorityWorld();
    await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" });
    const p = await pageOf(w, ada.email, { desktop: true });
    const opts = kebabOf(rowOf(p.byId("chats"), "Trip planning")) as El;
    expect([opts.className, opts.attrs["aria-label"], opts.attrs["aria-haspopup"]]).toEqual(["qf-ibtn qf-ibtn--28", CHATS_TEXT.options, "menu"]);
    await opts.onclick?.();
    expect([menuItems(p), p.byId("menu").dataset.form, opts.attrs["aria-expanded"]]).toEqual([["rename", "archive"], "popover", "true"]);
    p.key("Escape");
    expect([p.byId("menu").hidden, p.byId("rename").parent?.id, p.byId("archive").parent?.id]).toEqual([true, "menu-home", "menu-home"]);
    const phone = await pageOf(w, ada.email);
    await (kebabOf(rowOf(phone.byId("chats"), "Trip planning")) as El).onclick?.();
    expect([menuItems(phone), phone.byId("menu").dataset.form]).toEqual([["rename", "archive"], "sheet"]);
    // The main chat has no options to open: archiving it is the Person's refusal, and the page never offers it.
    expect(kebabOf(rowOf(p.byId("chats"), CHATS_TEXT.main))).toBeUndefined();
    expect(await w.http(ada.email, "POST", `/app/chats/${(await w.http(ada.email, "GET", "/app/chats")).body.main}/archive`, { archived: true })).toMatchObject({ status: 409, body: { code: "CHAT_MAIN_REFUSED" } });
  });

  it("Rename is inline on TextField: the row's place takes the field with the name, Save renames at the Person and Cancel puts the row back", async () => {
    const w = authorityWorld();
    await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" });
    const p = await pageOf(w, ada.email, { desktop: true });
    const row = rowOf(p.byId("chats"), "Trip planning");
    await (kebabOf(row) as El).onclick?.();
    await p.byId("rename").onclick?.();
    expect([p.byId("menu").hidden, row.children[0]?.id, p.byId("rename-form").hidden, p.byId("rename-title").value, p.byId("rename-form").tag]).toEqual([true, "rename-form", false, "Trip planning", "form"]);
    expect(APP_PAGE).toMatch(/<form id="rename-form" class="qf-listrow" hidden><input id="rename-title" aria-label="Chat name"/);
    // Cancel: the row's button is back and the form goes home.
    await p.byId("rename-cancel").onclick?.();
    expect([row.children[0]?.className, p.byId("rename-form").parent?.id, p.byId("rename-form").hidden]).toEqual(["qf-listrow", "menu-home", true]);
    // Save: the Person renames it and the list is drawn from its answer.
    await (kebabOf(row) as El).onclick?.();
    await p.byId("rename").onclick?.();
    p.byId("rename-title").value = "Harbor trip";
    await p.byId("rename-form").onsubmit?.({ preventDefault() {} });
    await settle();
    expect(rows(p.byId("chats")).map((r) => r.title)).toEqual([CHATS_TEXT.main, "Harbor trip"]);
    expect(w.host(ada.email).chats.entries().map((c) => c.title)).toContain("Harbor trip");
    expect(p.byId("rename-form").parent?.id).toBe("menu-home");
  });

  it("a rename the Person refuses is said in words with its code, never drawn as renamed; Bo cannot rename Ada's chat", async () => {
    const w = authorityWorld();
    const side = ((await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" })).body as { chatId: string }).chatId;
    const p = await pageOf(w, ada.email, { desktop: true });
    await (kebabOf(rowOf(p.byId("chats"), "Trip planning")) as El).onclick?.();
    await p.byId("rename").onclick?.();
    p.byId("rename-title").value = "";
    await p.byId("rename-form").onsubmit?.({ preventDefault() {} });
    await settle();
    const said = (await w.http(ada.email, "POST", `/app/chats/${side}/rename`, { title: "" })).body as { code?: string };
    expect([p.byId("conn").hidden, p.byId("conn").textContent, p.byId("conn").dataset.code]).toEqual([false, "Rename: that did not go through. Try again; if it keeps happening, tell an admin.", said.code]);
    expect(w.host(ada.email).chats.entries().find((c) => c.id === side)?.title).toBe("Trip planning");
    expect(await w.http(other.email, "POST", `/app/chats/${side}/rename`, { title: "Mine now" })).toMatchObject({ status: 404, body: { code: "CHAT_NOT_FOUND" } });
  });

  it("Archive moves a side chat to the archived view, which the list's options show with Back, its heading and Restore; Restore brings it back", async () => {
    const w = authorityWorld();
    await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" });
    const p = await pageOf(w, ada.email, { desktop: true });
    // With nothing archived the view says so.
    await p.byId("archived-btn").onclick?.();
    expect(menuItems(p)).toEqual([CHATS_TEXT.showArchived]);
    await p.byId("menu").children[0]?.onclick?.();
    expect([p.byId("archived").hidden, p.byId("chats").hidden, p.byId("archived").text()]).toEqual([false, true, `${CHATS_TEXT.archivedTitle} ${CHATS_TEXT.noArchived}`]);
    const back = p.byId("archived").children[0] as El;
    expect([back.className, back.attrs["aria-label"]]).toEqual(["qf-ibtn qf-ibtn--filled", CHATS_TEXT.back]);
    await back.onclick?.();
    expect([p.byId("archived").hidden, p.byId("chats").hidden]).toEqual([true, false]);
    // Archive from the row's options.
    await (kebabOf(rowOf(p.byId("chats"), "Trip planning")) as El).onclick?.();
    await p.byId("archive").onclick?.();
    await settle();
    expect(rows(p.byId("chats")).map((r) => r.title)).toEqual([CHATS_TEXT.main]);
    expect(rows(p.byId("archived")).map((r) => [r.title, r.options])).toEqual([["Trip planning", true]]);
    expect(w.host(ada.email).chats.entries().find((c) => c.title === "Trip planning")?.archived).toBe(true);
    // Its options are Restore alone; Restore asks the Person and the list draws its answer.
    await (kebabOf(rowOf(p.byId("archived"), "Trip planning")) as El).onclick?.();
    expect(menuItems(p)).toEqual([CHATS_TEXT.restore]);
    await p.byId("menu").children[0]?.onclick?.();
    await settle();
    expect([rows(p.byId("chats")).map((r) => r.title), rows(p.byId("archived")), p.byId("archived").hidden]).toEqual([[CHATS_TEXT.main, "Trip planning"], [], true]);
    expect(w.host(ada.email).chats.entries().find((c) => c.title === "Trip planning")?.archived).toBe(false);
    // Bo's page never lists it.
    const q = await pageOf(w, other.email, { desktop: true });
    expect([...rows(q.byId("chats")), ...rows(q.byId("archived"))].map((r) => r.title)).toEqual([CHATS_TEXT.main]);
  });

  it("New side chat opens the placeholder (F8): nothing at the Person and no row current until its first send; the button stays in the head", async () => {
    const w = authorityWorld();
    const p = await pageOf(w, ada.email, { desktop: true });
    await p.byId("new-chat").onclick?.();
    await settle();
    expect(w.host(ada.email).chats.entries().filter((c) => c.kind === "side")).toHaveLength(0);
    expect([p.location.pathname, p.sockets.length, p.sockets.at(-1)?.closed?.reason]).toEqual(["/chats/new", 1, "switched"]);
    expect(rows(p.byId("chats")).map((r) => r.current)).toEqual([null]);
    expect(p.byId("new-chat").parent).toBe(p.byId("chats").children[1]);
  });
});

describe("[M27.3] the Search dialog on SearchDialog", () => {
  it("opens on the helper's scrim with Recents, the person's chats newest first; a row opens its chat and closes the dialog", async () => {
    const w = authorityWorld();
    await w.http(ada.email, "GET", "/app/chats");
    w.clock.now += 1000;
    await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" });
    const p = await pageOf(w, ada.email, { desktop: true });
    await p.byId("rail-search").onclick?.();
    await settle();
    expect([p.byId("search").parent?.id, p.byId("search").hidden, p.byId("scrim").dataset.form]).toEqual(["scrim", false, "center"]);
    expect(APP_PAGE).toContain('<div id="search-card" class="qf-dialog">');
    expect([p.byId("search-heading").textContent, p.byId("search-clear").hidden]).toEqual([SEARCH_TEXT.recents, true]);
    const results = p.byId("search-list").children;
    expect(results.map((r) => [r.className, r.attrs.role, r.children[0]?.className, r.children[1]?.children[0]?.textContent])).toEqual([
      // F3: the first row is the active one, which Enter opens.
      ["qf-result is-active", "option", "tile", "Trip planning"],
      ["qf-result", "option", "tile", SEARCH_TEXT.main],
    ]);
    expect(results[0]?.children[1]?.children[1]?.className).toBe("qf-snip");
    await results[0]?.onclick?.();
    await settle();
    expect([p.byId("search").hidden, p.byId("scrim").hidden, p.sockets.at(-1)?.url]).toEqual([true, true, `wss://solo-sam.example/chats/${p.byId("chats").children[2]?.dataset.chat}/ws`]);
  });

  it("a query lists the matches as Results with Clear; Clear goes back to Recents; nothing found is the no-results line with the query as text", async () => {
    const w = authorityWorld();
    await w.http(ada.email, "POST", "/app/chats", { title: "Trip planning" });
    const p = await pageOf(w, ada.email, { desktop: true });
    await p.byId("rail-search").onclick?.();
    const query = async (q: string) => {
      p.byId("search-q").value = q;
      await (p.byId("search-q") as unknown as { oninput: () => unknown }).oninput();
      await settle();
    };
    await query("trip");
    expect([p.byId("search-heading").textContent, p.byId("search-clear").hidden, p.byId("search-list").children.map((r) => r.children[1]?.children[0]?.textContent)]).toEqual([SEARCH_TEXT.results, false, ["Trip planning"]]);
    await p.byId("search-clear").onclick?.();
    await settle();
    expect([p.byId("search-q").value, p.byId("search-heading").textContent, p.byId("search-clear").hidden, p.byId("search-list").children.length]).toEqual(["", SEARCH_TEXT.recents, true, 2]);
    await query("<b>zzz</b>");
    expect([p.byId("search-list").children, p.byId("search-note").textContent]).toEqual([[], SEARCH_DIALOG_TEXT.noResults.replace("{q}", "<b>zzz</b>")]);
    // Two members: Bo's search never finds Ada's chat.
    const q = await pageOf(w, other.email, { desktop: true });
    await q.byId("rail-search").onclick?.();
    q.byId("search-q").value = "trip";
    await (q.byId("search-q") as unknown as { oninput: () => unknown }).oninput();
    await settle();
    expect(q.byId("search-list").children).toEqual([]);
  });

  it("a search that could not run says so with its code, never as nothing found; an answer after the dialog closed is not drawn", async () => {
    let held: (r: Response) => void = () => {};
    const p = await page({
      onSend() {},
      fetch: (path) =>
        path.startsWith("/app/search?q=boom")
          ? Promise.resolve(new Response(JSON.stringify({ ok: false, code: "APP_READ_FAILED" }), { status: 500 }))
          : path.startsWith("/app/search?q=late")
            ? new Promise<Response>((r) => {
                held = r;
              })
            : Promise.resolve(path.startsWith("/app/search") ? new Response(JSON.stringify({ ok: true, recents: [] })) : null),
    }, { desktop: true });
    await p.byId("rail-search").onclick?.();
    await settle();
    expect(p.byId("search-note").textContent).toBe(SEARCH_TEXT.emptyRecents);
    p.byId("search-q").value = "boom";
    await (p.byId("search-q") as unknown as { oninput: () => unknown }).oninput();
    await settle();
    expect([p.byId("search-note").textContent, p.byId("search-note").dataset.code]).toEqual([SEARCH_TEXT.notRead, "APP_READ_FAILED"]);
    p.byId("search-q").value = "late";
    await (p.byId("search-q") as unknown as { oninput: () => unknown }).oninput();
    p.key("Escape");
    expect(p.byId("search").hidden).toBe(true);
    held(new Response(JSON.stringify({ ok: true, results: [{ chatId: "chat-ada", title: "Late", at: 0 }], memory: { ok: true } })));
    await settle();
    expect(p.byId("search-list").children).toEqual([]);
  });

  it("the drawer's head is its own search field (F3), not a launcher; the More sheet's Search and the rail's open the dialog", async () => {
    const w = authorityWorld();
    const p = await pageOf(w, ada.email);
    await p.byId("open-chats").onclick?.();
    expect([APP_PAGE.includes('id="chats-search"'), p.byId("chats-q").parent?.parent?.id, p.byId("drawer").parent?.id]).toEqual([false, "drawer", "scrim"]);
    p.key("Escape");
    await p.byId("to-more").onclick?.();
    await p.byId("more-search").onclick?.();
    expect([p.byId("search").parent?.className, p.byId("search").hidden, p.byId("more-sheet").hidden]).toEqual(["qf-scrim2 qf-scrim2--center", false, true]);
    p.key("Escape");
    expect(p.byId("search").hidden).toBe(true);
    expect(APP_PAGE).toContain(".qf-scrim2:has(> #search) { align-items: flex-start; padding-top: 96px; }");
  });
});

describe("[M27.3] the BUILD-ONLY thread objects on the system's components", () => {
  it("an approval card is the agent bubble as a card with Button rows; a link card and the job line are Cards; notice chips are Chips; Stop's note is a t-foot line", async () => {
    const p = await threadPage();
    p.deliver(p.s, {
      type: "card",
      card: { id: "card-1", state: "pending", title: "Send mail to Lee", lines: ["Recipients: Lee"], choices: [{ choice: "once", label: "Allow once" }, { choice: "deny", label: "Decline" }], flag: null, status: "Waiting for your decision." },
    });
    const card = p.log.children.find((c) => c.dataset.card === "card-1") as El;
    expect(card.className).toBe("card bubble-agent-card");
    expect(card.children.find((c) => c.className === "choices")?.children.map((b) => [b.tag, b.className, b.textContent])).toEqual([
      ["button", "qf-btn qf-btn--secondary", "Decline"],
      ["button", "qf-btn qf-btn--primary", "Allow once"],
    ]);
    p.deliver(p.s, { type: "link", card: { id: "link-1", title: "Connect your calendar", text: "Your agent needs it for Sunday.", href: "/connect/calendar" } });
    const link = p.log.children.find((c) => c.dataset.link === "link-1") as El;
    expect([link.className, link.children.at(-1)?.className, link.children.at(-1)?.children[0]?.className, link.children.at(-1)?.children[0]?.textContent]).toEqual(["card link qf-prompt-card", "act", "qf-btn qf-btn--secondary", "Open"]);
    p.deliver(p.s, { type: "message", text: "Set for Sunday at 9:00. Say so to change it." });
    const job = p.log.children.at(-1) as El;
    expect([job.className, job.children[0]?.className, job.children[0]?.children[0]?.className, job.children[0]?.children[0]?.textContent]).toEqual(["m job-line", "qf-prompt-card", "qf-btn qf-btn--secondary", JOB_BUTTON_TEXT]);
    p.deliver(p.s, { type: "notice", id: "n1", text: "The orchard report is in." });
    const chips = p.log.children.at(-1)?.children.find((c) => c.className === "chips");
    expect(chips?.children.map((b) => [b.className, b.textContent])).toEqual(NOTICE_CHIPS.map(([, label]) => ["qf-chip", label]));
    p.deliver(p.s, { type: "turn_stopped", turn: "t1", text: "Stopped.", effects: ['sent you: "Step one is done."'] });
    const stopped = p.log.children.at(-1) as El;
    expect([stopped.className, stopped.children.map((c) => c.className)]).toEqual(["m note stopped", ["effect"]]);
    expect(APP_PAGE).toContain("#log > .m.note .effect { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-secondary); }");
    // The card's look is the bubble's: the agent fill and radius, the MessageBubble padding.
    expect(APP_PAGE).toMatch(/\.bubble-agent-card \{[^}]*padding: 11px 15px; border-radius: 22px; background: var\(--bubble-agent\)/);
  });
});

describe("[M29.4] the message actions on the thread's objects", () => {
  const buttons = (n: El): El[] => n.children.flatMap((c) => (c.tag === "button" ? [c] : buttons(c)));
  const actsOf = (n: El | undefined) => {
    const row = n?.children.find((c) => c.className.startsWith("acts"));
    return row ? buttons(row).map((b) => b.attrs["aria-label"]) : null;
  };
  const pillOf = (n: El | undefined) => n?.children.find((c) => c.className === "reaction-pill")?.textContent ?? null;
  it("a message the history names has the ⋯ and the row (React on the agent's alone); a reaction frame draws its pill; a turn's named frame gives live bubbles theirs; Reply's quote rides the next send", async () => {
    const p = await threadPage();
    p.deliver(p.s, {
      type: "history",
      running: null,
      entries: [
        { kind: "you", text: "Is the orchard walk on?", id: "a", mid: "m1", at: 1 },
        { kind: "agent", text: "Yes, at nine.", mid: "m2", at: 2, reaction: "👍" },
        { kind: "note", text: "Not sent: the message was empty." },
      ],
    });
    const [you, agent, note] = p.log.children;
    expect([you?.dataset.mid, agent?.dataset.mid, note?.dataset.mid]).toEqual(["m1", "m2", undefined]);
    expect(actsOf(you)).toEqual([MESSAGE_TEXT.reply, MESSAGE_TEXT.copyResponse, MESSAGE_TEXT.moreOptions]);
    expect(actsOf(agent)).toEqual([MESSAGE_TEXT.react, MESSAGE_TEXT.reply, MESSAGE_TEXT.copyResponse, MESSAGE_TEXT.moreOptions]);
    expect([actsOf(note), pillOf(agent), pillOf(you)]).toEqual([null, "👍", null]);
    expect(buttons(you as El).find((b) => b.attrs["aria-label"] === MESSAGE_TEXT.more)).toBeTruthy();
    p.deliver(p.s, { type: "reaction", mid: "m2", emoji: null });
    p.deliver(p.s, { type: "reaction", mid: "m1", emoji: "😮" });
    expect([pillOf(p.log.children[0]), pillOf(p.log.children[1])]).toEqual(["😮", null]);
    // Live words have no id until the turn names them; then they take the row like history's.
    p.deliver(p.s, { type: "message", text: "Boots, yes." });
    expect(actsOf(p.log.children.at(-1))).toBeNull();
    p.deliver(p.s, { type: "named", turn: "t1", messages: [{ mid: "m3", who: "agent", text: "Boots, yes.", at: 3 }] });
    expect([p.log.children.at(-1)?.dataset.mid, actsOf(p.log.children.at(-1))?.[0]]).toEqual(["m3", MESSAGE_TEXT.react]);
    // Reply puts the quote on the composer, and the send carries its id.
    (buttons(agent as El).find((b) => b.attrs["aria-label"] === MESSAGE_TEXT.reply) as El).onclick?.();
    expect([p.byId("reply-chip").hidden, p.byId("reply-who").textContent, p.byId("reply-text").textContent]).toEqual([false, MESSAGE_TEXT.replyingTo + MESSAGE_TEXT.agent, "Yes, at nine."]);
    await p.type("Good.");
    expect(JSON.parse(p.s.sent.at(-1) as string)).toMatchObject({ type: "send", text: "Good.", quote: "m2" });
    expect(p.byId("reply-chip").hidden).toBe(true);
    // A quote the Chat could not find is refused with its code, said in words on the unsent message.
    const sent = JSON.parse(p.s.sent.at(-1) as string) as { id: string };
    p.deliver(p.s, { type: "refused", code: "QUOTE_NOT_FOUND", id: sent.id });
    expect([p.log.children.at(-1)?.text(), p.log.children.at(-1)?.dataset.code]).toEqual([NOT_SENT_TEXT.QUOTE_NOT_FOUND, "QUOTE_NOT_FOUND"]);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
