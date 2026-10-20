// The person's uploads (M24.3): `POST /app/attachments` takes one file by multipart (field `file`, and
// `pasted=1` for an image pasted into the composer), `GET /app/attachments` lists the person's own, and
// `GET /app/attachments/<id>/link` makes a short-lived signed link with which `GET /app/attachments/<id>`
// serves one back to its owner (with the session as well; nothing is served without both). The person is the verified session's alone;
// nothing in the form names a person, a key or a type that is believed. The route checks the cap and the
// type (`attachments/caps.ts`), converts HEIC and AVIF to JPEG, stores the bytes under the person's own
// content address, and the person's `Person` keeps the row and decides every read. A refusal carries a
// stable code and the sentence the person reads.
import { type AttachmentBucket, type AttachmentCall, attachmentKey, type AttachmentView } from "../attachments/store.ts";
import type { AttachmentLinkCall } from "../attachments/links.ts";
import { CAPS, type Caps, checkAttachment, type ImageConverter, sha256Hex, toJpeg } from "../attachments/caps.ts";

export interface AttachmentDirectory {
  /** The person's own `Person`, which decides every call for the person named by the session. */
  call(person: string, call: AttachmentCall | AttachmentLinkCall): Promise<unknown>;
  bucket: AttachmentBucket;
  /** HEIC and AVIF to JPEG; null where no converter is reachable, and such a file is refused in words. */
  convert: ImageConverter | null;
  /** The caps by type; production leaves this out and takes `CAPS`. */
  caps?: Caps;
}

/** Room for the multipart framing around the largest file a person may send. */
export const FORM_OVERHEAD = 64 * 1024;
const ID = /^\/app\/attachments\/([0-9a-f-]{36})(\/link)?$/;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const refuse = (status: number, code: string, words: string) => json({ ok: false, code, words }, status);
const failed = (r: unknown): r is { ok: false; code: string; reason?: string } => (r as { ok?: boolean })?.ok === false;
const statusOf = (code: string) => (/NOT_FOUND/.test(code) ? 404 : /NOT_OWNER|NOT_DISCLOSED|LINK_INVALID|LINK_REQUIRED/.test(code) ? 403 : code === "LINK_EXPIRED" ? 410 : 400);

export async function attachmentRoutes(request: Request, url: URL, person: string, dir: AttachmentDirectory | undefined): Promise<Response | null> {
  if (url.pathname !== "/app/attachments" && !url.pathname.startsWith("/app/attachments/")) return null;
  if (!dir) return json({ ok: false, code: "NOT_FOUND" }, 404);
  if (url.pathname === "/app/attachments" && request.method === "POST") return upload(request, person, dir);
  if (url.pathname === "/app/attachments" && request.method === "GET") {
    const r = await dir.call(person, { op: "list" });
    return failed(r) ? json(r, statusOf(r.code)) : json(r);
  }
  const one = ID.exec(url.pathname);
  if (one?.[2] && request.method === "GET") {
    const r = await dir.call(person, { op: "link", id: one[1] as string, download: url.searchParams.get("download") === "1" });
    return failed(r) ? json(r, statusOf(r.code)) : json(r);
  }
  if (one && request.method === "GET") return serve(one[1] as string, url, person, dir);
  return json({ ok: false, code: "NOT_FOUND" }, 404);
}

async function upload(request: Request, person: string, dir: AttachmentDirectory): Promise<Response> {
  const caps = dir.caps ?? CAPS;
  const declared = Number(request.headers.get("content-length") ?? "");
  if (declared > Math.max(caps.video, caps.file) + FORM_OVERHEAD) return refuse(413, "ATTACHMENT_TOO_LARGE", "That upload is larger than anything you can attach: a video can be up to 100 MB and any other file up to 25 MB.");
  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    return refuse(400, "ATTACHMENT_UNREADABLE", `The upload could not be read (${String((e as Error)?.message ?? e).slice(0, 120)}). Try attaching the file again.`);
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return refuse(400, "ATTACHMENT_MISSING", "The upload carried no file. Try attaching it again.");
  const a = checkAttachment({ name: (file as File).name ?? "", mime: file.type, size: file.size, pasted: form.get("pasted") === "1" }, caps);
  if (!a.ok) return refuse(a.code.startsWith("ATTACHMENT_TOO_LARGE") ? 413 : a.code === "ATTACHMENT_TYPE_UNSUPPORTED" ? 415 : 400, a.code, a.words);
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  let name = a.name;
  if (a.convert) {
    const j = await toJpeg(dir.convert, a, bytes);
    if (!j.ok) return refuse(422, j.code, j.words);
    ({ bytes, name } = j);
  }
  const mime = a.convert ? "image/jpeg" : a.mime;
  const sha256 = await sha256Hex(bytes);
  try {
    await dir.bucket.put(attachmentKey(person, sha256), bytes, { httpMetadata: { contentType: mime }, customMetadata: { owner: person } });
  } catch (e) {
    return refuse(503, "ATTACHMENT_STORE_FAILED", `${name} could not be stored just now (${String((e as Error)?.message ?? e).slice(0, 120)}). Try again.`);
  }
  const r = await dir.call(person, { op: "record", sha256, name, mime, size: bytes.byteLength, cls: a.cls });
  if (failed(r)) return refuse(statusOf(r.code), r.code, `${name} was not attached (${r.reason ?? r.code}). Try again.`);
  const v = (r as { attachment: AttachmentView }).attachment;
  // A file kept but not read is attached and said so: the agent is told the same in its line.
  const words = v.status === "read" ? `${name} is attached.` : `${name} is attached, but your agent could not read it (${v.code}).`;
  return json({ ok: true, attachment: v, words }, 201);
}

/** One attachment back to the person it is disclosed to: never sniffed or run, and a download unless it is an image. */
async function serve(id: string, url: URL, person: string, dir: AttachmentDirectory): Promise<Response> {
  if (!url.searchParams.has("sig") && !url.searchParams.has("exp")) return json({ ok: false, code: "LINK_REQUIRED", reason: "ask for a link to the attachment first" }, 403);
  const r = await dir.call(person, { op: "linked", id, exp: url.searchParams.get("exp") ?? "", sig: url.searchParams.get("sig") ?? "" });
  if (failed(r)) return json(r, statusOf(r.code));
  const { attachment: v, key } = r as { attachment: AttachmentView; key: string };
  const obj = await dir.bucket.get(key);
  if (!obj) return json({ ok: false, code: "ATTACHMENT_NOT_STORED", reason: "the stored file is gone" }, 404);
  const inline = v.mime.startsWith("image/") && url.searchParams.get("download") !== "1";
  const headers: Record<string, string> = {
    "content-type": v.mime,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    "cache-control": "private, no-store",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${v.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
  };
  return new Response(obj.body ?? (await obj.arrayBuffer()), { headers });
}
