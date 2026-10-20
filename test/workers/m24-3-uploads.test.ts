// M24.3 scope item 3, uploads: one file by multipart through the owner-scoped route, content-addressed
// under the session person's own key with a row in their own `Person`'s table, read for the agent by the
// ingest; caps by type stated in words; HEIC and AVIF to JPEG through the converter, a failure said and
// never stored; the sent message carrying its attachments to the model. Two members throughout: Bo can
// neither read, list nor download Ada's attachments, and the R2 key is never one a request names.
import { describe, expect, it } from "vitest";
import { LINK_TTL_MS } from "../../packages/agent/src/files/links.ts";
import { CAPS, checkAttachment, FILE_MAX, PASTED_IMAGE_MAX, sha256Hex, VIDEO_MAX } from "../../packages/agent/src/attachments/caps.ts";
import { attachmentKey } from "../../packages/agent/src/attachments/store.ts";
import { answerFrame, type SocketChat } from "../../packages/agent/src/chat/socket.ts";
import { ada, attachmentWorld, HEIC, JPEG } from "./support/attachment-world.ts";
import { authorityWorld } from "./support/authority-world.ts";

const PDF = new TextEncoder().encode("%PDF-1.7\nSolo Sam orchard notes: the pear rows are pruned in March.\n%%EOF\n");
const keyOf = async (owner: string, bytes: Uint8Array) => attachmentKey(owner, await sha256Hex(bytes));

describe("[M24.3] uploads go to the person's own content address", () => {
  it("a file is stored under person/<id>/user/<sha256> of its bytes, with a row in the person's own table, and read by the ingest", async () => {
    const w = attachmentWorld();
    const r = await w.upload(ada.email, "orchard.pdf", PDF, { type: "application/pdf" });
    expect(r.status).toBe(201);
    const key = await keyOf(ada.email, PDF);
    expect(key).toBe(`person/${encodeURIComponent(ada.email)}/user/${await sha256Hex(PDF)}`);
    expect(new Uint8Array(await ((await w.r2.get(key)) as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer())).toEqual(PDF);
    const a = r.body.attachment as { id: string; name: string; mime: string; status: string };
    expect(a).toMatchObject({ name: "orchard.pdf", mime: "application/pdf", status: "read" });
    expect(r.body.words).toBe("orchard.pdf is attached.");
    expect(w.rows(ada.email)).toMatchObject([{ id: a.id, owner: ada.email, source: "chat", message_id: null, notice_id: null, tree_path: "work/uploads/orchard.pdf" }]);
    expect(w.ingested).toEqual([{ owner: ada.email, attachmentId: a.id, name: "orchard.pdf", mime: "application/pdf", size: PDF.byteLength }]);
  });

  it("the person is the session's alone: a form naming another person, a key or a type is ignored", async () => {
    const w = attachmentWorld();
    const r = await w.upload(ada.email, "orchard.pdf", PDF, { type: "text/html", fields: { mime: "text/html" } });
    expect(r.status).toBe(201);
    expect(r.body.attachment).toMatchObject({ mime: "application/pdf" });
    expect(w.r2.puts).toEqual([await keyOf(ada.email, PDF)]);
  });

  it("an upload must come from the app's own page: another origin is refused APP_ORIGIN and nothing is stored", async () => {
    const w = attachmentWorld();
    const r = await w.upload(ada.email, "orchard.pdf", PDF, { headers: { origin: "https://elsewhere.example" } });
    expect(r).toMatchObject({ status: 403, body: { code: "APP_ORIGIN" } });
    expect(w.r2.puts).toEqual([]);
    expect(w.rows(ada.email)).toEqual([]);
  });

  it("Ada's download is served from her row's key, never sniffed or run, as an attachment of its stored type", async () => {
    const w = attachmentWorld();
    const id = ((await w.upload(ada.email, "orchard.pdf", PDF, { type: "text/html" })).body.attachment as { id: string }).id;
    const r = await w.download(ada.email, id);
    expect(r.status).toBe(200);
    expect(r.bytes).toEqual(PDF);
    expect(Object.fromEntries(["content-type", "x-content-type-options", "content-disposition"].map((h) => [h, r.headers.get(h)]))).toEqual({
      "content-type": "application/pdf",
      "x-content-type-options": "nosniff",
      "content-disposition": 'attachment; filename="orchard.pdf"',
    });
    expect(r.headers.get("content-security-policy")).toMatch(/^sandbox;/);
  });
});

describe("[M24.3] attachment downloads are by signed link", () => {
  it("Ada's download needs a short-lived link from her own object: none, a changed one or an expired one serves nothing", async () => {
    const w = attachmentWorld();
    const id = ((await w.upload(ada.email, "orchard.pdf", PDF)).body.attachment as { id: string }).id;
    const bare = await w.http(ada.email, "GET", `/app/attachments/${id}`);
    expect(bare).toMatchObject({ status: 403, body: { code: "LINK_REQUIRED" } });
    expect(bare.bytes).not.toEqual(PDF);
    const url = String(await w.link(ada.email, id));
    expect(url).toMatch(new RegExp(`^/app/attachments/${id}\\?exp=\\d+&sig=[0-9a-f]{64}$`));
    expect((await w.http(ada.email, "GET", url)).bytes).toEqual(PDF);
    // A link is for the attachment it names alone, and for its few minutes.
    const other = ((await w.upload(ada.email, "rows.pdf", new TextEncoder().encode("%PDF rows"))).body.attachment as { id: string }).id;
    expect(await w.http(ada.email, "GET", url.replace(id, other))).toMatchObject({ status: 403, body: { code: "LINK_INVALID" } });
    expect(await w.http(ada.email, "GET", url.replace(/sig=([0-9a-f])/, (_m, c: string) => `sig=${c === "0" ? "1" : "0"}`))).toMatchObject({ status: 403, body: { code: "LINK_INVALID" } });
    w.clock.now += LINK_TTL_MS;
    expect(await w.http(ada.email, "GET", url)).toMatchObject({ status: 410, body: { code: "LINK_EXPIRED" } });
  });
});

describe("[M24.3] caps by type, stated in words", () => {
  it("the caps are 25 MiB for a file, 100 MiB for a video and 8 MiB for a pasted image, exactly", () => {
    expect([FILE_MAX, VIDEO_MAX, PASTED_IMAGE_MAX]).toEqual([26_214_400, 104_857_600, 8_388_608]);
    expect(checkAttachment({ name: "a.pdf", size: FILE_MAX })).toMatchObject({ ok: true });
    expect(checkAttachment({ name: "a.pdf", size: FILE_MAX + 1 })).toMatchObject({ ok: false, code: "ATTACHMENT_TOO_LARGE_FILE" });
    expect(checkAttachment({ name: "clip.mp4", size: VIDEO_MAX })).toMatchObject({ ok: true, cls: "video" });
    expect(checkAttachment({ name: "clip.mp4", size: VIDEO_MAX + 1 })).toMatchObject({ ok: false, code: "ATTACHMENT_TOO_LARGE_VIDEO" });
    expect(checkAttachment({ name: "image.png", size: PASTED_IMAGE_MAX, pasted: true })).toMatchObject({ ok: true });
    expect(checkAttachment({ name: "image.png", size: PASTED_IMAGE_MAX + 1, pasted: true })).toMatchObject({ ok: false, code: "ATTACHMENT_TOO_LARGE_PASTED" });
  });

  it("a file over 25 MB is refused ATTACHMENT_TOO_LARGE_FILE in words through the route, and nothing is stored", async () => {
    const w = attachmentWorld();
    const r = await w.upload(ada.email, "ledger.pdf", new Uint8Array(FILE_MAX + 1));
    expect(r).toMatchObject({ status: 413, body: { ok: false, code: "ATTACHMENT_TOO_LARGE_FILE", words: "ledger.pdf is 25.1 MB; a file can be up to 25 MB." } });
    expect(w.r2.puts).toEqual([]);
    expect(w.rows(ada.email)).toEqual([]);
  });

  it("a pasted image over 8 MB is refused ATTACHMENT_TOO_LARGE_PASTED in words; the same image attached as a file is taken", async () => {
    const w = attachmentWorld();
    const big = new Uint8Array(PASTED_IMAGE_MAX + 1);
    const pasted = await w.upload(ada.email, "image.png", big, { type: "image/png", pasted: true });
    expect(pasted).toMatchObject({ status: 413, body: { code: "ATTACHMENT_TOO_LARGE_PASTED", words: "That pasted image is 8.1 MB; a pasted image can be up to 8 MB. Attach it as a file instead." } });
    expect(w.r2.puts).toEqual([]);
    expect((await w.upload(ada.email, "image.png", big, { type: "image/png" })).status).toBe(201);
  });

  it("a video over its cap is refused ATTACHMENT_TOO_LARGE_VIDEO in words, and is kept unread under it", async () => {
    const w = attachmentWorld({ caps: { file: 40, video: 100, pasted: 8 } });
    expect(await w.upload(ada.email, "clip.mp4", new Uint8Array(101))).toMatchObject({ status: 413, body: { code: "ATTACHMENT_TOO_LARGE_VIDEO", words: expect.stringContaining("a video can be up to") } });
    const kept = await w.upload(ada.email, "clip.mp4", new Uint8Array(100).fill(7));
    expect(kept).toMatchObject({ status: 201, body: { attachment: { mime: "video/mp4", status: "unread", code: "ATTACHMENT_VIDEO_UNREAD" }, words: "clip.mp4 is attached, but your agent could not read it (ATTACHMENT_VIDEO_UNREAD)." } });
    expect(w.ingested).toEqual([]);
    expect(CAPS.video).toBe(VIDEO_MAX);
  });

  it("a kind the agent cannot read, or an empty file, is refused with its code in words", async () => {
    const w = attachmentWorld();
    expect(await w.upload(ada.email, "setup.exe", PDF)).toMatchObject({ status: 415, body: { code: "ATTACHMENT_TYPE_UNSUPPORTED", words: "setup.exe is a kind of file your agent cannot read, so it was not attached." } });
    expect(await w.upload(ada.email, "notes.txt", new Uint8Array(0))).toMatchObject({ status: 400, body: { code: "ATTACHMENT_EMPTY" } });
    expect(w.r2.puts).toEqual([]);
  });
});

describe("[M24.3] HEIC and AVIF become JPEG", () => {
  it("a HEIC and an AVIF go through the converter and the stored attachment is JPEG", async () => {
    const w = attachmentWorld({ convert: async () => ({ ok: true, bytes: JPEG, mime: "image/jpeg" }) });
    const heic = await w.upload(ada.email, "pears.heic", HEIC, { type: "image/heic" });
    const avif = await w.upload(ada.email, "rows.avif", HEIC.slice(1), { type: "image/avif" });
    expect([heic.status, avif.status]).toEqual([201, 201]);
    expect(w.converted).toEqual([{ mime: "image/heic", size: HEIC.byteLength }, { mime: "image/avif", size: HEIC.byteLength - 1 }]);
    expect([heic.body.attachment, avif.body.attachment]).toMatchObject([{ name: "pears.jpg", mime: "image/jpeg" }, { name: "rows.jpg", mime: "image/jpeg" }]);
    const key = await keyOf(ada.email, JPEG);
    expect(new Uint8Array(await ((await w.r2.get(key)) as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer())).toEqual(JPEG);
    expect(w.r2.puts).toEqual([key, key]);
    expect(w.ingested.map((i) => i.mime)).toEqual(["image/jpeg", "image/jpeg"]);
  });

  it("a conversion that fails, or answers something that is not a JPEG, is said in words with its code and never stored as success", async () => {
    const failing = attachmentWorld({ convert: async () => ({ ok: false, code: "IMAGE_CONVERT_FAILED", reason: "the image's header is damaged" }) });
    expect(await failing.upload(ada.email, "pears.heic", HEIC)).toMatchObject({ status: 422, body: { ok: false, code: "IMAGE_CONVERT_FAILED", words: "pears.heic could not be converted to JPEG (the image's header is damaged), so it was not attached." } });
    expect([failing.r2.puts, failing.rows(ada.email)]).toEqual([[], []]);
    // A converter that hands the HEIC back as if converted is caught by the JPEG check.
    const lying = attachmentWorld({ convert: async (i) => ({ ok: true, bytes: i.bytes, mime: "image/jpeg" }) });
    expect(await lying.upload(ada.email, "pears.heic", HEIC)).toMatchObject({ status: 422, body: { code: "IMAGE_CONVERT_FAILED" } });
    expect([lying.r2.puts, lying.rows(ada.email)]).toEqual([[], []]);
  });

  it("with no converter injected, HEIC is refused IMAGE_CONVERT_UNAVAILABLE in words", async () => {
    const w = attachmentWorld();
    const r = await w.upload(ada.email, "pears.heic", HEIC);
    expect(r).toMatchObject({ status: 422, body: { code: "IMAGE_CONVERT_UNAVAILABLE", words: expect.stringContaining("pears.heic is a HEIC image, and converting it to JPEG is not available here yet") } });
    expect(w.r2.puts).toEqual([]);
  });
});

/** A chat that only records what it was asked to send, for the frame's own checks. */
const recorder = (): SocketChat & { sent: Array<{ text: string; clientId?: string }> } => {
  const sent: Array<{ text: string; clientId?: string }> = [];
  return {
    sent,
    owner: () => ada.email,
    history: () => ({ entries: [], running: null }) as never,
    stop: async () => ({ ok: true, turn: "t" }) as never,
    react: () => ({ ok: false, code: "MESSAGE_NOT_FOUND" }),
    send: async (i) => {
      sent.push(i);
      return { status: "done", turnId: "t" } as never;
    },
  };
};

describe("[M24.3] the sent message carries its attachments", () => {
  it("Ada's send names her upload: the row is tied to the message and the model reads describeForModel's line for it", async () => {
    const files = attachmentWorld();
    const id = ((await files.upload(ada.email, "orchard.pdf", PDF)).body.attachment as { id: string }).id;
    const w = authorityWorld({ script: [{ text: "The pear rows are pruned in March." }] });
    const opened = (await w.host(ada.email).chats.open(w.clock.now)) as { chatId: string };
    const attach = async (p: string, ids: string[], messageId: string) => files.store(p).call(p, { op: "bind", ids, chatId: opened.chatId, messageId }) as never;
    const chat = w.chats.harness(opened.chatId).instance;
    expect(await answerFrame(ada.email, JSON.stringify({ type: "send", text: "When are the pears pruned?", id: "send-1", attachments: [id] }), chat, () => {}, attach)).toBeNull();
    const user = (w.fake.requests[0]?.inputs.messages ?? []).filter((m) => m.role === "user").map((m) => JSON.stringify(m.content)).join("\n");
    expect(user).toContain("When are the pears pruned?");
    expect(user).toContain(`[attachment ${id}] orchard.pdf (document, 1 page) is at work/uploads/orchard.pdf`);
    expect(files.rows(ada.email)).toMatchObject([{ id, chat_id: opened.chatId, message_id: "send-1", notice_id: null }]);
  });

  it("an empty message with an attachment is sent as the attachment's line alone", async () => {
    const files = attachmentWorld();
    const id = ((await files.upload(ada.email, "orchard.pdf", PDF)).body.attachment as { id: string }).id;
    const chat = recorder();
    await answerFrame(ada.email, JSON.stringify({ type: "send", text: "", id: "s1", attachments: [id] }), chat, () => {}, async (p, ids, m) => files.store(p).call(p, { op: "bind", ids, chatId: "c", messageId: m }) as never);
    expect(chat.sent).toEqual([{ person: ada.email, text: `[attachment ${id}] orchard.pdf (document, 1 page) is at work/uploads/orchard.pdf`, clientId: "s1" }]);
  });
});

