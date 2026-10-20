// M24.3 scope item 3, the composer's attach control: the shipped page script under the page harness, its
// uploads going through the agent script's real route into the session person's own store. The canvas's
// round "+" sits at the composer's start and opens the file picker; a pasted image is attached too; each file
// is a chip above the composer; a send carries the uploaded ids; a refusal is the route's sentence on the
// chip with its code kept, and the refused file is not sent.
import { describe, expect, it } from "vitest";
import { PASTED_IMAGE_MAX } from "../../packages/agent/src/attachments/caps.ts";
import { ATTACH_TEXT, CHAT_MARKUP } from "../../packages/agent/src/http/app/chat.ts";
import { ada, attachmentWorld } from "./support/attachment-world.ts";
import { page } from "./support/page-harness.ts";

const PDF = new TextEncoder().encode("%PDF-1.7\nSolo Sam orchard notes.\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ticks = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
/**
 * The page's uploads in flight. An upload hashes its bytes (`crypto.subtle`, on Node's thread pool) and parses a
 * multipart body, so how many event-loop turns it takes depends on the machine's load: a wait counted in turns
 * passed alone and failed beside the full suite. The harness's fetch records each one and `settle` waits for them.
 */
const inflight = new Set<Promise<unknown>>();
const track = <T>(work: Promise<T>): Promise<T> => {
  inflight.add(work);
  void work.finally(() => inflight.delete(work)).catch(() => {});
  return work;
};
const settle = async () => {
  await ticks();
  while (inflight.size) {
    await Promise.allSettled([...inflight]);
    await ticks();
  }
};

/** Ada's page: its uploads go to the real route as the session's person; its socket frames are recorded. */
async function adaPage(as = ada.email) {
  const files = attachmentWorld();
  const frames: Array<Record<string, unknown>> = [];
  const posted: FormData[] = [];
  const p = await page({
    onSend: (d) => frames.push(JSON.parse(d)),
    fetch: (path, init) => {
      if (path !== "/app/attachments") return Promise.resolve(null);
      posted.push(init?.body as unknown as FormData);
      return track(files.http(as, init?.method ?? "GET", path, init?.body as unknown as FormData).then((r) => new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } })));
    },
  });
  const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
  p.open(s);
  p.deliver(s, { type: "history", entries: [], running: null });
  const sends = () => frames.filter((f) => f.type === "send");
  return { p, files, sends, posted };
}

describe("[M24.3] the composer's attach control, in the canvas's shape", () => {
  it("a round + labelled Attach opens the picker from the composer's start, and is closed while the socket is not live", async () => {
    // The round + is the Composer's attach (M27.3: the canvas's 28px icon button with Ico's plus, first in the pill's row,
    // after the staged chips).
    expect(CHAT_MARKUP).toMatch(/<form id="f" class="qf-composer qf-composer--stack"[^>]*><div id="reply-chip" class="qf-quote" hidden>.*?<\/div><\/div><div id="attached" hidden><\/div><div class="composer-row"><button type="button" id="attach" class="qf-ibtn qf-ibtn--32" aria-label="Attach" disabled><svg class="ico ico-sm"[^>]* data-glyph="plus:r"><path d="[^"]+"\/><\/svg><\/button><input type="file" id="file" multiple hidden><input id="t"/);
    const { p } = await adaPage();
    expect(p.byId("attach").disabled).toBe(false);
    let picked = 0;
    Object.assign(p.byId("file"), { click: () => picked++ });
    await p.byId("attach").onclick?.();
    expect(picked).toBe(1);
  });

  it("a chosen file is uploaded at once, shown as a chip, and sent by id with the message", async () => {
    const { p, files, sends, posted } = await adaPage();
    Object.assign(p.byId("file"), { files: [new File([PDF], "orchard.pdf", { type: "application/pdf" })] });
    await (p.byId("file") as unknown as { onchange: () => unknown }).onchange();
    await settle();
    expect(posted[0]?.get("pasted")).toBeNull();
    expect(p.byId("attached").hidden).toBe(false);
    expect(p.byId("attached").text()).toBe("orchard.pdf ×");
    const id = (files.rows(ada.email)[0] as { id: string }).id;
    await p.type("When are the pears pruned?");
    expect(sends()).toMatchObject([{ type: "send", text: "When are the pears pruned?", attachments: [id] }]);
    expect(p.byId("attached").hidden).toBe(true);
    expect(p.bubbles().at(-1)).toEqual(["m you pending", "When are the pears pruned? · + orchard.pdf"]);
  });

  it("a pasted image is uploaded as pasted; one over 8 MB is said in the route's words on its chip, with its code, and not sent", async () => {
    const { p, files, sends, posted } = await adaPage();
    const paste = (bytes: Uint8Array) =>
      (p.byId("t") as unknown as { onpaste: (e: unknown) => unknown }).onpaste({
        preventDefault() {},
        clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => new File([bytes], "image.png", { type: "image/png" }) }] },
      });
    paste(PNG);
    await settle();
    expect(posted[0]?.get("pasted")).toBe("1");
    expect(files.rows(ada.email)).toMatchObject([{ name: "image.png", mime: "image/png" }]);
    paste(new Uint8Array(PASTED_IMAGE_MAX + 1));
    await settle();
    const refused = p.byId("attached").children[1];
    expect(refused?.className).toBe("qf-chip chip refused");
    expect(refused?.dataset.code).toBe("ATTACHMENT_TOO_LARGE_PASTED");
    expect(refused?.text()).toBe("That pasted image is 8.1 MB; a pasted image can be up to 8 MB. Attach it as a file instead. ×");
    await p.type("the rows");
    expect(sends()).toMatchObject([{ attachments: [(files.rows(ada.email)[0] as { id: string }).id] }]);
    expect(sends()[0]?.attachments).toHaveLength(1);
  });

  it("a send waits for an upload still running, and says so", async () => {
    const files = attachmentWorld();
    let release: () => void = () => {};
    const frames: Array<Record<string, unknown>> = [];
    const p = await page({
      onSend: (d) => frames.push(JSON.parse(d)),
      fetch: (path, init) => {
        if (path !== "/app/attachments") return Promise.resolve(null);
        const held = new Promise<void>((r) => {
          release = r;
        });
        return held.then(() => track(files.http(ada.email, "POST", path, init?.body as unknown as FormData).then((r) => new Response(JSON.stringify(r.body), { status: r.status }))));
      },
    });
    const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
    p.open(s);
    p.deliver(s, { type: "history", entries: [], running: null });
    Object.assign(p.byId("file"), { files: [new File([PDF], "orchard.pdf")] });
    await (p.byId("file") as unknown as { onchange: () => unknown }).onchange();
    await p.type("see this");
    expect(frames.filter((f) => f.type === "send")).toEqual([]);
    expect(p.bubbles().at(-1)).toEqual(["m note", ATTACH_TEXT.wait]);
    release();
    await settle();
    await p.type("see this");
    expect(frames.filter((f) => f.type === "send")).toMatchObject([{ attachments: [(files.rows(ada.email)[0] as { id: string }).id] }]);
  });
});
