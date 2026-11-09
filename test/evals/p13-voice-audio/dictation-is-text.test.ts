// T-P13-04 under vitest, as its contract says: a browser test. The shipped chat page runs in hermetic Chromium as Sam of
// solo-sam; dictation is the browser's own (the page draws no recorder, M26.2), so the test fakes it as the words in
// the composer's box and presses Send. Every request the page makes is answered by the P13 world: its pages and JSON by
// the authority world's routes, an upload by the agent script's real upload route into Sam's real `PersonAttachments`,
// and the chat socket by the Chat's own `connectFrame` and `answerFrame` over the world's real `ChatEngine`, its
// attachments bound as `objects/chat.ts` binds them. The task's graders then read the world through the harness.
//
// Planted (`dictated_audio_kept`): a page that keeps the dictated audio, staging it through the composer's own attach
// control before the send. The production guard is the page itself (no recorder; a send is the box's text and only the
// files the person staged), so the plant is the page doing otherwise, and the minefield and the no-row grader must fire.
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectFrame } from "../../../packages/agent/src/chat/protocol.ts";
import { answerFrame } from "../../../packages/agent/src/chat/socket.ts";
import { executeTask } from "../../support/task.ts";
import { PAGE_ORIGIN, servePages } from "../../workers/support/page-routes.ts";
import task from "./dictation-is-text.task.ts";
import { graded, type P13Tier1World, p13Harness, played, sam } from "./harness.ts";
import { runs } from "./runs.ts";
import { probeNote } from "./world.ts";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chromium", headless: true });
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

/** Sam's browser on the chat page: the box filled with the dictated words and sent; `keepAudio` plants a page that also attaches the audio. */
const onPage =
  (o: { keepAudio?: boolean } = {}) =>
  async (world: P13Tier1World, text: string): Promise<void> => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", timezoneId: "UTC", locale: "en-US" });
    try {
      let answered: (v: unknown) => void = () => {};
      const sendAnswered = new Promise((r) => {
        answered = r;
      });
      await ctx.routeWebSocket(/.*/, (ws) => {
        const id = new URL(ws.url()).pathname.match(/^\/chats\/([^/]+)\/ws$/)?.[1];
        if (!id) return ws.close();
        const chat = world.w.chats.harness(id);
        const first = connectFrame(sam.email, chat.instance.owner(), () => chat.instance.history());
        if (!first.ok) return ws.close({ code: 4403, reason: first.code });
        let open = true;
        const held = chat.connect() as { send(d: string): void };
        held.send = (d) => {
          if (open) ws.send(d);
        };
        ws.onClose(() => {
          open = false;
        });
        ws.send(JSON.stringify(first.frame));
        // The send's attachments are bound in Sam's own store, as `objects/chat.ts` binds them through the Person.
        const attach = async (p: string, ids: string[], messageId: string) => (await world.a.store(p).call(p, { op: "bind", ids, chatId: id, messageId } as never)) as { ok: true; lines: string[] } | { ok: false; code: string };
        ws.onMessage(async (m) => {
          const reply = await answerFrame(sam.email, String(m), chat.instance, () => {}, attach);
          if (reply && open) ws.send(JSON.stringify(reply));
          if (String(m).includes('"type":"send"')) answered(reply);
        });
      });
      await servePages(ctx, (m, p, b) => world.w.http(sam.email, m, p, b));
      // The upload is multipart: the agent script's real route, as Sam (servePages answers JSON only).
      await ctx.route(`${PAGE_ORIGIN}/app/attachments`, async (r) => {
        const req = new Request(r.request().url(), { method: "POST", headers: { "content-type": (await r.request().headerValue("content-type")) ?? "" }, body: r.request().postDataBuffer() ?? new Uint8Array() });
        const res = await world.a.http(sam.email, "POST", "/app/attachments", await req.formData());
        const name = String((res.body as { attachment?: { name?: string } }).attachment?.name ?? "");
        world.uploads.push({ name, status: res.status, ...(typeof res.body.code === "string" ? { code: res.body.code } : {}), words: String(res.body.words ?? "") });
        return r.fulfill({ status: res.status, contentType: "application/json", body: JSON.stringify(res.body) });
      });
      const pg: Page = await ctx.newPage();
      await pg.clock.setFixedTime(new Date(world.w.clock.now));
      // The page leaves `/` for its open chat as soon as it loads: the URL wait starts before the navigation (gotcha 5).
      await Promise.all([pg.waitForURL(`${PAGE_ORIGIN}/chats/${world.chatId}`), pg.goto(`${PAGE_ORIGIN}/`)]);
      await pg.waitForFunction('!document.getElementById("t").disabled');
      if (o.keepAudio) {
        const uploaded = pg.waitForResponse((r) => r.url().endsWith("/app/attachments"));
        await pg.setInputFiles("#file", { name: "dictation.mp3", mimeType: "audio/mpeg", buffer: Buffer.from(probeNote()) });
        await uploaded;
        await pg.waitForFunction('!!document.querySelector("#attached .chip:not(.refused) button")');
      }
      // Dictation, faked: the browser's mic filled the box with the words; the person sends them.
      await pg.fill("#t", text);
      await pg.click("#send");
      await sendAnswered;
    } finally {
      await ctx.close();
    }
  };

describe("[F70] P13 voice and audio: T-P13-04 in Chromium", () => {
  it("task T-P13-04 (nice-to-have, tier 1): the dictated words are one text message, no attachment row, no audio object", async () => {
    await executeTask(task, p13Harness({ script: runs["T-P13-04"]!(), dictate: onPage() }));
  }, 120_000);

  it("planted: a page that keeps the dictated audio steps on dictated_audio_kept and the no-row grader fails", async () => {
    const w = await played(task, { script: runs["T-P13-04"]!(), dictate: onPage({ keepAudio: true }) });
    expect(w.rows().map((r) => r.cls)).toEqual(["audio"]);
    const g = await graded(task, w);
    expect([g.dictated_audio_kept, g["no attachment row"]]).toEqual([false, false]);
  }, 120_000);

  it("with no page, the dictate turn is refused by name rather than played as a typed message", async () => {
    await expect(played(task, { script: runs["T-P13-04"]!() })).rejects.toThrow(/P13_DICTATE_NEEDS_PAGE/);
  });
});
