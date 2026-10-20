// M24.3 scope item 3, mail's attachments: the reader takes every attached file out of the mail at any
// depth up to its limit, base64 and quoted-printable, with RFC 2047 and RFC 2231 names; each lands in the
// person's attachments table pointing at the mail's notice, stored under their own content address and
// read; and every attachment that is dropped (cut off, unreadable, of a kind not taken, over its cap, too
// deep) is said in the mail chat's sentence, never silent. End to end through the
// MIME reader and the owner's `PersonMail` (fletch has no platform mail path); the sender is the owner.
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../packages/agent/src/attachments/caps.ts";
import { attachmentKey } from "../../packages/agent/src/attachments/store.ts";
import { MAX_PART_DEPTH, parseMime } from "../../packages/agent/src/mail/mime.ts";
import { attachmentWorld } from "./support/attachment-world.ts";
import { ada, mailWorld, message, TENANT } from "./support/mail-world.ts";

const adaAgent = `ada.agent.${TENANT}@mail.qyvr.ai`;
const PDF = new TextEncoder().encode("%PDF-1.7\nSolo Sam cider press schedule: Saturdays in October.\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
const part = (headers: string[], body: string) => [...headers, "", body].join("\r\n");
const multipart = (boundary: string, parts: string[], closed = true) => [...parts.map((p) => `--${boundary}\r\n${p}`), ...(closed ? [`--${boundary}--`] : [])].join("\r\n");
const raw = (extra: string, body: string) => new TextEncoder().encode(message({ from: ada.email, subject: "Press schedule", extra, body }));

describe("[M24.3] the mail reader takes attachments out at any depth", () => {
  it("finds base64 and quoted-printable files with encoded names three levels down, beside the text it already read", () => {
    const inner = multipart("b3", [part(["Content-Type: text/html", ""], "<p>see the photo</p>"), part(["Content-Type: image/png; name=\"=?utf-8?B?cHJlc3MucG5n?=\"", "Content-Transfer-Encoding: base64"], b64(PNG))]);
    const middle = multipart("b2", [part(['Content-Type: multipart/related; boundary="b3"'], inner)]);
    const body = multipart("b1", [
      part(["Content-Type: text/plain; charset=utf-8"], "The press schedule is attached."),
      part(["Content-Type: application/pdf", "Content-Disposition: attachment; filename*=utf-8''Press%20schedule.pdf", "Content-Transfer-Encoding: base64"], b64(PDF)),
      part(["Content-Type: text/plain; charset=utf-8", 'Content-Disposition: attachment; filename="rows.txt"', "Content-Transfer-Encoding: quoted-printable"], "Row 4: Caf=C3=A9 pears"),
      part(['Content-Type: multipart/mixed; boundary="b2"'], middle),
    ]);
    const m = parseMime(raw('Content-Type: multipart/mixed; boundary="b1"', body));
    expect(m.text).toBe("The press schedule is attached.");
    expect(m.dropped).toEqual([]);
    expect((m.attachments ?? []).map((a) => [a.name, a.mime, Buffer.from(a.bytes).toString("hex")])).toEqual([
      ["Press schedule.pdf", "application/pdf", Buffer.from(PDF).toString("hex")],
      ["rows.txt", "text/plain", Buffer.from("Row 4: Café pears").toString("hex")],
      ["press.png", "image/png", Buffer.from(PNG).toString("hex")],
    ]);
  });

  it("drops a part cut off mid-base64 or without its closing boundary, an unknown encoding, and parts past the depth limit, each with its code", () => {
    const cut = multipart("c1", [
      part(["Content-Type: text/plain"], "Two files."),
      part(['Content-Type: application/pdf; name="half.pdf"', "Content-Transfer-Encoding: base64"], b64(PDF).slice(0, -3)),
      part(['Content-Type: application/pdf; name="odd.pdf"', "Content-Transfer-Encoding: x-uuencode"], "begin 644 odd.pdf"),
      part(['Content-Type: application/pdf; name="last.pdf"', "Content-Transfer-Encoding: base64"], b64(PDF)),
    ], false);
    expect(parseMime(raw('Content-Type: multipart/mixed; boundary="c1"', cut)).dropped).toEqual([
      { name: "half.pdf", code: "MAIL_ATTACHMENT_TRUNCATED", words: "half.pdf arrived cut off, so it was not kept." },
      { name: "odd.pdf", code: "MAIL_ATTACHMENT_UNPARSEABLE", words: "odd.pdf could not be read out of the mail, so it was not kept." },
      { name: "last.pdf", code: "MAIL_ATTACHMENT_TRUNCATED", words: "last.pdf arrived cut off, so it was not kept." },
    ]);
    let deep = part(['Content-Type: application/pdf; name="deep.pdf"', "Content-Transfer-Encoding: base64"], b64(PDF));
    for (let i = MAX_PART_DEPTH; i >= 1; i--) deep = part([`Content-Type: multipart/mixed; boundary="d${i}"`], multipart(`d${i}`, [deep]));
    const m = parseMime(raw('Content-Type: multipart/mixed; boundary="d0"', multipart("d0", [part(["Content-Type: text/plain"], "Deep."), deep])));
    expect(m.attachments).toEqual([]);
    expect(m.dropped).toMatchObject([{ code: "MAIL_ATTACHMENT_TOO_DEEP" }]);
  });
});

describe("[M24.3] mail's attachments land in the same table, and a dropped one is said in the mail chat", () => {
  it("a kept file is stored under Ada's key, read, and pointed at the mail's notice; each dropped one is in the sentence with its code", async () => {
    const files = attachmentWorld({ caps: { file: 1024, video: 16, pasted: 8 } });
    const w = mailWorld({ attachments: (email) => (m) => files.store(email).fromMail(m) });
    const body = multipart("m1", [
      part(["Content-Type: text/plain"], "Schedule, a tool, a clip and half a photo."),
      part(['Content-Type: application/pdf; name="press.pdf"', "Content-Transfer-Encoding: base64"], b64(PDF)),
      part(['Content-Type: application/octet-stream; name="press-tool.exe"', "Content-Transfer-Encoding: base64"], b64(PDF)),
      part(['Content-Type: video/mp4; name="press.mp4"', "Content-Transfer-Encoding: base64"], b64(new Uint8Array(17))),
      part(['Content-Type: image/png; name="half.png"', "Content-Transfer-Encoding: base64"], "iVBORw0KGgoAAA"),
    ]);
    const mail = message({ from: `${ada.name} <${ada.email}>`, subject: "Press schedule", extra: 'Content-Type: multipart/mixed; boundary="m1"', body });
    expect(await w.receive(adaAgent, ada.email, mail)).toEqual({ ok: true, code: "MAIL_DELIVERED" });
    const notice = w.notices(ada.email)[0] as { chat: string; id: string; text: string };
    expect(notice.text).toContain("It carried 4 attachments: 1 kept, 3 not kept (MAIL_ATTACHMENT_TRUNCATED, ATTACHMENT_TYPE_UNSUPPORTED, ATTACHMENT_TOO_LARGE_VIDEO).");
    const row = files.rows(ada.email)[0] as { id: string };
    expect(notice.text).toContain(`Kept: [attachment ${row.id}] press.pdf (document, 1 page) is at work/uploads/press.pdf`);
    expect(notice.text).toContain("Not kept: half.png arrived cut off, so it was not kept. (MAIL_ATTACHMENT_TRUNCATED)");
    expect(notice.text).toContain("Not kept: press-tool.exe is a kind of file your agent cannot read, so it was not attached. (ATTACHMENT_TYPE_UNSUPPORTED)");
    expect(notice.text).toContain("Not kept: press.mp4 is 0.1 MB; a video can be up to 0 MB. (ATTACHMENT_TOO_LARGE_VIDEO)");
    // The file names are the sender's words: they stay inside a fence.
    expect(notice.text).toContain(`[BEGIN EXTERNAL CONTENT source="mail-attachments:${ada.email.split("@")[1]}"]\nKept: `);
    expect(files.rows(ada.email)).toMatchObject([{ owner: ada.email, source: "mail", chat_id: notice.chat, notice_id: notice.id, message_id: null, name: "press.pdf", mime: "application/pdf", status: "read" }]);
    expect(await files.r2.get(attachmentKey(ada.email, await sha256Hex(PDF)))).not.toBeNull();
    expect(files.ingested.map((i) => [i.owner, i.name])).toEqual([[ada.email, "press.pdf"]]);
    expect([w.notices(other.email), files.rows(other.email)]).toEqual([[], []]);
  });

  it("with no store to keep them, every attachment is still said, not kept, with ATTACHMENTS_UNAVAILABLE", async () => {
    const w = mailWorld();
    const body = multipart("m2", [part(["Content-Type: text/plain"], "The schedule."), part(['Content-Type: application/pdf; name="press.pdf"', "Content-Transfer-Encoding: base64"], b64(PDF))]);
    await w.receive(adaAgent, ada.email, message({ from: ada.email, subject: "Press schedule", extra: 'Content-Type: multipart/mixed; boundary="m2"', body }));
    const text = w.notices(ada.email)[0]?.text ?? "";
    expect(text).toContain("It carried 1 attachment: 0 kept, 1 not kept (ATTACHMENTS_UNAVAILABLE).");
    expect(text).toContain("Not kept: press.pdf was not kept: attachments cannot be kept here. (ATTACHMENTS_UNAVAILABLE)");
  });

  it("a HEIC in mail with no converter injected is dropped HOST_IMAGES_UNAVAILABLE and said; with one it is kept as JPEG", async () => {
    const heic = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99]);
    const body = multipart("m3", [part(["Content-Type: text/plain"], "A photo."), part(['Content-Type: image/heic; name="pears.heic"', "Content-Transfer-Encoding: base64"], b64(heic))]);
    const mail = message({ from: ada.email, subject: "Pears", extra: 'Content-Type: multipart/mixed; boundary="m3"', body });
    const without = attachmentWorld();
    const w1 = mailWorld({ attachments: (email) => (m) => without.store(email).fromMail(m) });
    await w1.receive(adaAgent, ada.email, mail);
    expect(w1.notices(ada.email)[0]?.text).toContain("1 not kept (HOST_IMAGES_UNAVAILABLE)");
    expect(without.rows(ada.email)).toEqual([]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    const withOne = attachmentWorld({ convert: async () => ({ ok: true, bytes: jpeg, mime: "image/jpeg" }) });
    const w2 = mailWorld({ attachments: (email) => (m) => withOne.store(email).fromMail(m) });
    await w2.receive(adaAgent, ada.email, mail);
    expect(withOne.rows(ada.email)).toMatchObject([{ name: "pears.jpg", mime: "image/jpeg", sha256: await sha256Hex(jpeg) }]);
    expect(withOne.converted).toEqual([{ mime: "image/heic", size: heic.byteLength }]);
  });
});

/** A former member's label: rows and files keyed by a person who is not on the roster (fletch's fixtures hold one person). */
const other = { ...ada, id: "former-member", email: "former-member", name: "Pat" };
