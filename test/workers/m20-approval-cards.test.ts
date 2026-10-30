// M20.1: approval cards in the chat pipe (Muse's QYVR-158 findings, QYVR-172 to 175). One decision on a
// card runs its action at most once, whoever clicks, how often and from which surface: the chat claims
// the card before anything is awaited, a second decision is answered with the first one's outcome, and
// the Person's grant store refuses a second commit of the same effect. A decided card says its outcome in
// words, live and after a reload, in the chat and on the Approvals page, and the turn that paused on it
// goes on by itself. No code is drawn as words. A link card is drawn once per id. Every run is the real
// chat engine, gate, card store, grants and route over the fake workspace and the scripted fake model;
// the page is the shipped script under the page harness. Ada and Bo of solo-sam throughout.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DECIDE_WORDS, decideText } from "../../packages/agent/src/chat/decide-words.ts";
import { connectFrame } from "../../packages/agent/src/chat/protocol.ts";
import { answerFrame } from "../../packages/agent/src/chat/socket.ts";
import { appRoutes } from "../../packages/agent/src/http/app-routes.ts";
import { APP_PAGE, NO_CHOICES_TEXT, NOT_DECIDED_TEXT, NOT_DONE_TEXT } from "../../packages/agent/src/http/page.ts";
import { statusWords } from "../../packages/agent/src/jobs/status-words.ts";
import { FakeWorkspaceAdapter } from "../../packages/agent/src/workspace/fake.ts";
import type { FakeStep } from "../support/fake-model.ts";
import { ada, authorityWorld } from "./support/authority-world.ts";
import { type El, page, type ScriptedSocket } from "./support/page-harness.ts";

const root = join(import.meta.dirname, "../..");
const load: FakeStep = { toolCall: { id: "l1", name: "tool_search", arguments: { load: ["workspace"] } } };
const create = (id = "c1", name = "Board"): FakeStep => ({ toolCall: { id, name: "workspace_create", arguments: { name } } });
const app = (workspace: string, id = "a1"): FakeStep => ({ toolCall: { id, name: "workspace_app", arguments: { workspace, name: "Planner" } } });
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};
const ADA = { person: ada.email, agent: false };

function world(script: FakeStep[]) {
  const ws = new FakeWorkspaceAdapter("solo-sam", [ada.email]);
  const w = authorityWorld({ workspace: ws, script });
  /** The workspaces a person's agent can see: what was really created. */
  const spaces = async (p: string) => ((await ws.listWorkspaces({ tenant: "solo-sam", person: p, agent: true })) as { value: Array<{ id: string }> }).value;
  return { w, ws, spaces };
}
type World = ReturnType<typeof world>["w"];

/** Rows of one card in the journal, by their id after the chat's. */
const rowsOf = async (w: World, chatId: string, card: string) => (await w.journal()).filter((r) => r.id.startsWith(`${chatId}:${card}`)).map((r) => [r.id.slice(chatId.length + 1), r.outcome]);

/**
 * Ada's page on her chat: sends through the socket's production answer, frames from the chat's socket,
 * and the page's requests (decisions, the Approvals page) through the agent script's real route as Ada.
 */
/** The panel's Approvals tab, as a person reaches it: the avatar, then the tab. */
const openApprovals = async (p: { byId: (id: string) => El }) => {
  await p.byId("open-agent").onclick?.();
  await p.byId("panel-tab-approvals").onclick?.();
};

async function adaPage(w: World, chatId: string, fetch?: (path: string, init?: { method?: string; body?: string }) => Promise<Response | null>) {
  const box: { p?: Awaited<ReturnType<typeof page>> } = {};
  const chat = () => w.chats.harness(chatId).instance;
  const p = await page({
    onSend(data: string, s: ScriptedSocket) {
      void answerFrame(ada.email, data, chat()).then((reply) => reply && box.p?.deliver(s, reply));
    },
    fetch:
      fetch ??
      (async (path, init) => {
        if (!path.startsWith("/chats/") && path !== "/app/approvals") return null;
        const r = await w.http(ada.email, init?.method ?? "GET", path.replace("/chats/chat-ada/", `/chats/${chatId}/`), init?.body ? JSON.parse(init.body) : undefined);
        return new Response(JSON.stringify(r.body), { status: r.status });
      }),
  });
  box.p = p;
  const s0 = p.sockets[0] as ScriptedSocket;
  p.open(s0);
  const socket = w.chats.harness(chatId).connect();
  socket.send = (d: string) => {
    socket.frames.push(JSON.parse(d));
    p.deliver(s0, d);
  };
  const resync = () => p.deliver(s0, (connectFrame(ada.email, chat().owner(), () => chat().history()) as { frame: unknown }).frame);
  resync();
  return { p, s0, socket, resync };
}

const find = (root: El, pred: (e: El) => boolean): El[] => [...(pred(root) ? [root] : []), ...root.children.flatMap((c) => find(c, pred))];
const cardNodes = (root: El, id: string) => find(root, (e) => e.dataset.card === id);
const statusOf = (card: El) => card.children.find((c) => c.className === "status")?.textContent;
const buttons = (card: El) => card.children.find((c) => c.className === "choices")?.children ?? [];
const click = (card: El, label: string) => (buttons(card).find((b) => b.textContent === label)?.onclick?.() as Promise<void>) ?? Promise.reject(new Error(`no ${label} button`));

async function adaChat(w: World): Promise<string> {
  return ((await w.host(ada.email).chats.open(w.clock.now)) as { chatId: string }).chatId;
}

describe("[M20.1] one decision runs one action (QYVR-172)", () => {
  it("two Allow once decisions at the same moment on Ada's workspace_create card create one workspace, spend one grant and write one decision; the second is told the first's outcome", async () => {
    const { w, spaces } = world([load, create(), { text: "Made your board." }]);
    const { chatId, result } = await w.say(ada.email, "Make a board.");
    expect(result).toMatchObject({ status: "done", awaiting: true });
    const chat = w.chats.harness(chatId).instance;
    const [one, two] = await Promise.all([chat.decide(["c1"], ADA, "once"), chat.decide(["c1"], ADA, "once")]);
    expect(one).toEqual([expect.objectContaining({ ok: true, state: "approved", outcome: "DONE" })]);
    expect(two).toEqual([{ ...one[0], again: true }]);
    expect(await spaces(ada.email)).toHaveLength(1);
    expect(await w.grantsNow()).toEqual([expect.objectContaining({ one_shot: true, used_at: expect.any(Number), created_from: "approval-card" })]);
    expect(await rowsOf(w, chatId, "c1")).toEqual([["c1", "PENDING"], ["c1:decision", "DONE"]]);
    // One continuation, not two: the chat holds the paused turn and one more.
    expect(w.chats.harness(chatId).rows("SELECT code FROM turns ORDER BY started_at").map((r) => r.code)).toEqual(["AWAITING_DECISION", null]);
  });

  it("a retry from the Approvals page after the chat card's decision, even with another choice, is answered with the first outcome and runs nothing", async () => {
    const { w, spaces } = world([load, create(), { text: "Made your board." }]);
    const { chatId } = await w.say(ada.email, "Make a board.");
    const first = await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: ["c1"], choice: "once" });
    for (const choice of ["once", "deny", "always"]) {
      const again = await w.http(ada.email, "POST", `/chats/${chatId}/cards/decide`, { ids: ["c1"], choice });
      expect(again.status).toBe(200);
      expect(again.body.results).toEqual([{ ...(first.body.results as object[])[0], again: true }]);
    }
    expect((first.body.results as Array<{ card: { status: string } }>)[0]?.card.status).toBe("Allowed once; it ran.");
    expect(await spaces(ada.email)).toHaveLength(1);
    expect(await w.grantsNow()).toHaveLength(1);
    expect(await rowsOf(w, chatId, "c1")).toEqual([["c1", "PENDING"], ["c1:decision", "DONE"]]);
  });

  it("the Person's grant store commits an effect once: the same effect id again is refused, another id is not", async () => {
    const { w } = world([load, create()]);
    const { chatId } = await w.say(ada.email, "Make a board.");
    const card = w.chats.harness(chatId).instance.cardsFor(ada.email)?.[0];
    expect(card).toBeDefined();
    await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "workspace.create" }, mode: "auto" });
    const d = { ...JSON.parse(String(w.chats.harness(chatId).rows("SELECT descriptor FROM cards")[0]?.descriptor)), at: w.clock.now };
    const authority = w.host(ada.email).authority;
    expect(await authority.commit(d, `${chatId}:x1`)).toMatchObject({ decision: "auto" });
    expect(await authority.commit(d, `${chatId}:x1`)).toMatchObject({ decision: "deny", code: "EFFECT_ALREADY_COMMITTED" });
    expect(await authority.commit(d, `${chatId}:x2`)).toMatchObject({ decision: "auto" });
  });

  it("a decision cut off after its action ran (the chat object restarted) and taken up again does not run it a second time, and says so", async () => {
    const { w, ws, spaces } = world([load, create(), { text: "Done." }]);
    const { chatId } = await w.say(ada.email, "Make a board.");
    const harness = w.chats.harness(chatId);
    // The instance dies once the workshop has made the workspace, before the chat records the outcome:
    // Muse's case, a first click whose answer never came back while the action had run.
    const made = ws.createWorkspace.bind(ws);
    let cut = false;
    ws.createWorkspace = async (as, name) => {
      const r = await made(as, name);
      if (!cut) harness.evict();
      cut = true;
      return r;
    };
    const first = await harness.instance.decide(["c1"], ADA, "once").catch((e: Error) => e.message);
    expect(first).toMatch(/EVICTED/);
    expect(await spaces(ada.email)).toHaveLength(1);
    expect(harness.rows("SELECT state FROM cards").map((r) => r.state)).toEqual(["deciding"]);
    const again = await harness.instance.decide(["c1"], ADA, "once");
    expect(again).toEqual([expect.objectContaining({ ok: true, state: "failed", outcome: "EFFECT_ALREADY_COMMITTED", card: expect.objectContaining({ status: "Allowed once; it had already been started once, so it was not run again." }) })]);
    expect(await spaces(ada.email)).toHaveLength(1);
    // The grant made before the cut is the one reused: no second approval grant exists.
    expect(await w.grantsNow()).toHaveLength(1);
  });

  it("a hostile model that proposes the created workspace again after Allow once gets a new card waiting for Ada, never a second run", async () => {
    const { w, spaces } = world([load, create(), create("c2")]);
    const { chatId } = await w.say(ada.email, "Make a board.");
    await w.chats.harness(chatId).instance.decide(["c1"], ADA, "once");
    expect(await spaces(ada.email)).toHaveLength(1);
    expect(w.cardsOf(ada.email).map((c) => [c.id, c.state])).toEqual([["c1", "approved"], ["c2", "pending"]]);
  });
});

describe("[M20.1] the card says what happened and the turn goes on (QYVR-173)", () => {
  it("Allow once clicked twice in the chat: one workspace, the card reads Allowed once live and after a reload, and the agent's next words arrive with no send", async () => {
    const { w, spaces } = world([load, create(), { text: "Made your board." }]);
    const chatId = await adaChat(w);
    const { p, socket, resync } = await adaPage(w, chatId);
    await p.type("Make a board.");
    await settle();
    const [card] = cardNodes(p.log, "c1");
    expect(statusOf(card as El)).toBe("Waiting for your decision.");
    expect(buttons(card as El).map((b) => b.textContent)).toEqual(["Decline", "Always allow this", "Allow your agent for 30 days", "Allow once"]);
    await Promise.all([click(card as El, "Allow once"), click(card as El, "Allow once")]);
    await settle();
    expect(await spaces(ada.email)).toHaveLength(1);
    const drawn = () => {
      const nodes = cardNodes(p.log, "c1");
      expect(nodes).toHaveLength(1);
      expect(statusOf(nodes[0] as El)).toBe("Allowed once; it ran.");
      expect(buttons(nodes[0] as El)).toEqual([]);
    };
    drawn();
    // The paused turn went on by itself: started with no words of Ada's, its reply drawn, and it ended.
    expect(socket.frames.filter((f) => f.type === "turn_started").map((f) => "text" in f)).toEqual([true, false]);
    expect(p.bubbles().filter(([c]) => c === "m you")).toEqual([["m you", "Make a board."]]);
    expect(p.bubbles().at(-1)).toEqual(["m agent", "Made your board."]);
    expect(p.busy()).toBe(false);
    resync();
    drawn();
    // The paused step had no words of the model's, so code said what waited (F26, `pauseWords`), then the reply.
    expect(p.bubbles().filter(([c]) => c === "m agent")).toEqual([
      ["m agent", "Waiting for your decision: workspace create. It has not run yet."],
      ["m agent", "Made your board."],
    ]);
  });

  it("the workspace_app card shows its choices on the Approvals page; decided there, it reads its outcome on both surfaces and the chat's turn goes on", async () => {
    const { w, spaces } = world([load, create(), { text: "Made your board." }]);
    const chatId = await adaChat(w);
    const { p, resync } = await adaPage(w, chatId);
    await p.type("Make a board.");
    await settle();
    await click(cardNodes(p.log, "c1")[0] as El, "Allow once");
    await settle();
    const board = (await spaces(ada.email))[0]?.id as string;
    w.clock.now += 60_000;
    w.fake.enqueue(app(board), { text: "Added the planner." });
    await p.type("Add a planner app to it.");
    await settle();
    expect(buttons(cardNodes(p.log, "a1")[0] as El).map((b) => b.textContent)).toContain("Allow once");
    await openApprovals(p);
    await settle();
    const list = p.byId("approval-list");
    const waiting = cardNodes(list, "a1")[0] as El;
    expect(buttons(waiting).map((b) => b.textContent)).toEqual(["Decline", "Always allow this", "Allow your agent for 30 days", "Allow once"]);
    // The decided card is a row of the history (M23.3): its title, and what happened in words.
    expect(cardNodes(list, "c1")).toHaveLength(0);
    expect(p.byId("approval-history").text()).toContain("Allowed once; it ran.");
    await click(waiting, "Allow once");
    await settle();
    expect(cardNodes(list, "a1")).toHaveLength(1);
    expect(statusOf(cardNodes(list, "a1")[0] as El)).toBe("Allowed once; it ran.");
    // The chat's card changed live from the decision's frame, and its turn went on.
    expect(statusOf(cardNodes(p.log, "a1")[0] as El)).toBe("Allowed once; it ran.");
    expect(p.bubbles().at(-1)).toEqual(["m agent", "Added the planner."]);
    resync();
    expect(statusOf(cardNodes(p.log, "a1")[0] as El)).toBe("Allowed once; it ran.");
    await openApprovals(p);
    await settle();
    // Nothing waits any more: both decided cards are history rows, each saying what happened.
    expect(find(p.byId("approval-list"), (e) => e.dataset.card !== undefined)).toHaveLength(0);
    expect(p.byId("approval-history").children).toHaveLength(2);
    for (const row of p.byId("approval-history").children) expect(row.text()).toContain("Allowed once; it ran.");
  });

  it("Decline reads Declined, and the turn goes on to say so; a pending card with no choices says why it has none", async () => {
    const { w, spaces } = world([load, create(), { text: "I left it." }]);
    const chatId = await adaChat(w);
    const { p, s0 } = await adaPage(w, chatId);
    await p.type("Make a board.");
    await settle();
    await click(cardNodes(p.log, "c1")[0] as El, "Decline");
    await settle();
    expect(statusOf(cardNodes(p.log, "c1")[0] as El)).toBe("Declined.");
    expect(p.bubbles().at(-1)).toEqual(["m agent", "I left it."]);
    expect(await spaces(ada.email)).toEqual([]);
    p.deliver(s0, { type: "card", turn: "t", card: { id: "x9", state: "pending", title: "Your agent asks to: x", lines: [], proposed: {}, choices: [], flag: null, status: "Waiting for your decision." } });
    expect(find(cardNodes(p.log, "x9")[0] as El, (e) => e.textContent === NO_CHOICES_TEXT)).toHaveLength(1);
  });
});

/** Every code the decide route can answer, read from the code that answers it. */
function decideCodes(): string[] {
  const src = (f: string) => readFileSync(join(root, "packages/agent/src", f), "utf8");
  const routes = src("http/authority-routes.ts");
  const block = routes.slice(routes.indexOf("const cards = url.pathname.match"), routes.indexOf("const latch ="));
  const all = [
    ...[...src("chat/approvals.ts").matchAll(/"((?:CARD|APPROVAL|CHOICE|PURCHASE|GRANTS)_[A-Z_]+)"/g)].map((m) => m[1]),
    ...[...src("grants/validate.ts").matchAll(/bad\("([A-Z_]+)"/g)].map((m) => m[1]),
    ...[...((/ {2}create\(by[\s\S]*?\n {2}\}/.exec(src("grants/authority.ts")) ?? [""])[0]).matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]),
    ...[...block.matchAll(/code: "([A-Z_]+)"/g)].map((m) => m[1]),
    ...[...src("http/routes.ts").slice(0, src("http/routes.ts").indexOf("authorityRoutes(request")).matchAll(/json\(\{ code: "(NO_SESSION|TENANT_MISMATCH)" \}/g)].map((m) => m[1]),
    "NOT_AN_ADMIN",
  ];
  return [...new Set(all as string[])].sort();
}

describe("[M20.1] no code is shown as words (QYVR-174)", () => {
  it("every code the decide route can answer has its sentence, with no code in it", () => {
    const codes = decideCodes();
    expect(codes).toEqual(expect.arrayContaining(["CARD_UNKNOWN", "APPROVAL_NOT_PRINCIPAL", "DECISION_INVALID", "GRANT_SUBJECT_INVALID", "NO_SESSION"]));
    expect(codes).not.toContain("CARD_DECIDED");
    for (const code of codes) {
      expect(DECIDE_WORDS[code], code).toBeDefined();
      expect(decideText(code), code).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    }
    expect(decideText("SOMETHING_NEW")).not.toContain("SOMETHING_NEW");
  });

  it("the route answers its real refusals with the sentence beside the code", async () => {
    const { w } = world([load, create(), { toolCall: { id: "s1", name: "shop_buy", arguments: { item: "chair", amount: 90 } } }]);
    const { chatId } = await w.say(ada.email, "Make a board.");
    const ask = (as: string, body: unknown, chat = chatId) => w.http(as, "POST", `/chats/${chat}/cards/decide`, body);
    const seen = [
      await ask(ada.email, { ids: [], choice: "once" }),
      await ask(ada.email, { ids: ["c1"], choice: "once" }, "not-a-chat"),
      await ask(ada.email, { ids: ["nope"], choice: "once" }),
      await ask(other.email, { ids: ["c1"], choice: "once" }),
    ];
    const codes = seen.map((r) => (r.body.results as Array<{ code: string }> | undefined)?.[0]?.code ?? (r.body.code as string));
    expect(codes).toEqual(["DECISION_INVALID", "CHAT_NOT_FOUND", "CARD_UNKNOWN", "APPROVAL_NOT_PRINCIPAL"]);
    for (const [i, r] of seen.entries()) expect((r.body.results as Array<{ text: string }> | undefined)?.[0]?.text ?? r.body.text).toBe(decideText(codes[i] as string));
  });

  it("the page draws each decide refusal in its words and keeps the code on the line; no answer at all is said in words too", async () => {
    const { w } = world([load, create()]);
    const chatId = await adaChat(w);
    let answer: () => Response = () => new Response("{}");
    const { p } = await adaPage(w, chatId, async (path, init) => {
      if (init?.method === "POST" && path.endsWith("/cards/decide")) return answer();
      return null;
    });
    await p.type("Make a board.");
    await settle();
    const card = () => cardNodes(p.log, "c1")[0] as El;
    for (const code of decideCodes()) {
      answer = () => new Response(JSON.stringify({ results: [{ id: "c1", ok: false, code, text: decideText(code) }] }), { status: 400 });
      await click(card(), "Allow once");
      expect(statusOf(card()), code).toBe(decideText(code));
      expect(card().text()).not.toContain(code);
      expect(card().children.find((c) => c.className === "status")?.dataset.code).toBe(code);
      expect(buttons(card()).every((b) => !b.disabled)).toBe(true);
    }
    answer = () => new Response(JSON.stringify({ code: "DECISION_INVALID", text: decideText("DECISION_INVALID") }), { status: 400 });
    await click(card(), "Decline");
    expect(statusOf(card())).toBe(decideText("DECISION_INVALID"));
    answer = () => new Response("not json", { status: 502 });
    await click(card(), "Decline");
    expect(statusOf(card())).toBe(NOT_DECIDED_TEXT);
  });

  it("a refused or failed frame, an unknown unsent code and an unreadable Approvals chat are said in words, never the code", async () => {
    const { w } = world([]);
    const chatId = await adaChat(w);
    const { p, s0 } = await adaPage(w, chatId, async (path) =>
      path === "/app/approvals" ? new Response(JSON.stringify({ ok: true, cards: [], decided: [], unread: [{ chatId: "c", code: "APP_READ_FAILED" }] })) : null,
    );
    p.deliver(s0, { type: "refused", code: "RATE_LIMITED" });
    p.deliver(s0, { type: "error", code: "FRAME_INVALID", reason: "bad json" });
    expect(p.bubbles().slice(-2)).toEqual([["m note", NOT_DONE_TEXT], ["m note", NOT_DONE_TEXT]]);
    await openApprovals(p);
    await settle();
    expect(p.byId("approvals-note").textContent).not.toMatch(/APP_READ_FAILED/);
    expect(p.byId("approvals-note").dataset.code).toBe("APP_READ_FAILED");
    // Nowhere in the page script is a code joined into what the person reads.
    const script = APP_PAGE.split("<script>")[1] as string;
    expect(script.match(/\+\s*[\w.()[\]]*\.code\b|\.code\s*\+/g)).toBeNull();
  });
});

describe("[M20.1] a link card is drawn once per id (QYVR-175)", () => {
  it("a link frame arriving twice, a re-sync replaying it and a card frame repeated each leave one drawing", async () => {
    const { w } = world([]);
    const chatId = await adaChat(w);
    const { p, s0 } = await adaPage(w, chatId);
    const link = { id: "connection:ws-1:cr-41", kind: "connection_request", title: "The build agent asks for a connection to Google (Google Calendar)", text: "Open the workspace's chat to decide.", href: "/workshop/workspace/ws-1?chat=41&showChat=true" };
    const frame = { type: "link", turn: "t1", card: link };
    p.deliver(s0, frame);
    p.deliver(s0, frame);
    expect(find(p.log, (e) => e.dataset.link === link.id)).toHaveLength(1);
    p.deliver(s0, { type: "history", entries: [{ kind: "link", text: link.title, at: 1, card: link }], running: null });
    p.deliver(s0, frame);
    expect(find(p.log, (e) => e.dataset.link === link.id)).toHaveLength(1);
    const card = { id: "c7", state: "pending", title: "Your agent asks to: x", lines: [], proposed: {}, choices: [{ choice: "once", label: "Allow once" }], flag: null, status: "Waiting for your decision." };
    p.deliver(s0, { type: "card", turn: "t1", card });
    p.deliver(s0, { type: "card", turn: "t1", card });
    expect(cardNodes(p.log, "c7")).toHaveLength(1);
  });

  it("the chat keeps a link card once however often the action that shows it is performed, and its history holds it once", async () => {
    const { w, ws } = world([]);
    const board = ws.seedWorkspace(ada.email, "Board");
    const request = { id: "cr-41", chat: "41", vendor: "google", vendorName: "Google", resource: "Google Calendar" };
    ws.scriptBuildReply({ reply: "I need a Google connection.", chat: "41", connectionRequests: [request] });
    ws.scriptBuildReply({ reply: "Still need it.", chat: "41", connectionRequests: [request] });
    await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "workspace.build" }, mode: "auto" });
    const build = (id: string): FakeStep => ({ toolCall: { id, name: "workspace_build", arguments: { workspace: board, message: "Use my calendar" } } });
    w.fake.enqueue(load, build("b1"), { text: "Asked." }, build("b2"), { text: "Asked again." });
    const { chatId } = await w.say(ada.email, "Build it on Google.");
    await w.say(ada.email, "Try once more.", chatId);
    const history = w.chats.harness(chatId).instance.history().entries.filter((e) => e.kind === "link");
    expect(history.map((e) => (e as { card: { id: string } }).card.id)).toEqual([`connection:${board}:cr-41`]);
  });
});

describe("[M20.1] the Jobs page says a status in the one table's words", () => {
  it("the route sends on and ran from jobs/status-words.ts and the page draws exactly those", async () => {
    for (const [status, words] of [["active", "on"], ["finished", "ran"], ["needs_enable", "off until you turn it on"]] as const) {
      const dir = { jobIds: async () => ["j-1"], job: () => ({ inspect: async () => ({ ok: true, job: { status, cadence: "daily at 08:30 (UTC)" }, runs: [] }) }) };
      const url = new URL("https://solo-sam.example/app/jobs");
      const body = (await ((await appRoutes(new Request(url), url, ada.email, dir as never)) as Response).json()) as { jobs: Array<{ words: string }> };
      expect(body.jobs[0]?.words).toBe(words);
      expect(statusWords(status)).toBe(words);
    }
    // The job dialog's chip draws the route's words, and its line the cadence (M23.3, M27.4).
    expect(APP_PAGE).toContain('$("job-state").textContent = (job.words || "").replace(/^./, (c) => c.toUpperCase());');
    expect(APP_PAGE).toContain('const jobLine = (job) => (job.job ? job.job.cadence : "")');
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
