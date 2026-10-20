// What a person may attach (M24.3): the kinds of file the agent can take, the cap on each, and the words
// a refusal is said in. The type is decided from the file's name, never from what the browser or a mail
// says the type is, so a file is always stored and served as what its extension makes it. Each refusal
// carries a stable code and a sentence the person reads; nothing over a cap is stored.

/** A file of any readable kind: 25 MiB. */
export const FILE_MAX = 25 * 1024 * 1024;
/** A video: 100 MiB. Kept for the person; the agent does not read it (Media beyond images is not in M24.3). */
export const VIDEO_MAX = 100 * 1024 * 1024;
/** An image pasted into the composer: 8 MiB. */
export const PASTED_IMAGE_MAX = 8 * 1024 * 1024;
/** Attachments on one message or one colleague's request. */
export const MAX_PER_MESSAGE = 10;

export type AttachmentClass = "image" | "video" | "file";
export type Caps = { file: number; video: number; pasted: number };
export const CAPS: Caps = { file: FILE_MAX, video: VIDEO_MAX, pasted: PASTED_IMAGE_MAX };

/** The types an attachment is stored and served as, by extension, with its class. */
export const ATTACHMENT_TYPES: Record<string, { mime: string; cls: AttachmentClass }> = {
  jpg: { mime: "image/jpeg", cls: "image" }, jpeg: { mime: "image/jpeg", cls: "image" }, png: { mime: "image/png", cls: "image" },
  gif: { mime: "image/gif", cls: "image" }, webp: { mime: "image/webp", cls: "image" },
  heic: { mime: "image/heic", cls: "image" }, heif: { mime: "image/heif", cls: "image" }, avif: { mime: "image/avif", cls: "image" },
  mp4: { mime: "video/mp4", cls: "video" }, m4v: { mime: "video/mp4", cls: "video" }, mov: { mime: "video/quicktime", cls: "video" }, webm: { mime: "video/webm", cls: "video" },
  pdf: { mime: "application/pdf", cls: "file" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", cls: "file" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", cls: "file" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", cls: "file" },
  odt: { mime: "application/vnd.oasis.opendocument.text", cls: "file" }, ods: { mime: "application/vnd.oasis.opendocument.spreadsheet", cls: "file" },
  odp: { mime: "application/vnd.oasis.opendocument.presentation", cls: "file" }, epub: { mime: "application/epub+zip", cls: "file" },
  rtf: { mime: "application/rtf", cls: "file" }, zip: { mime: "application/zip", cls: "file" },
  txt: { mime: "text/plain", cls: "file" }, md: { mime: "text/markdown", cls: "file" }, csv: { mime: "text/csv", cls: "file" },
  json: { mime: "application/json", cls: "file" }, html: { mime: "text/html", cls: "file" }, htm: { mime: "text/html", cls: "file" },
};

/** Image types the agent's readers do not take: converted to JPEG before anything is stored. */
export const CONVERTED_TO_JPEG = new Set(["image/heic", "image/heif", "image/avif"]);

/** A type for a file whose name has no extension we know, from the type it was sent with (a pasted image has no name). */
const BY_MIME: Record<string, string> = Object.fromEntries(Object.entries(ATTACHMENT_TYPES).map(([ext, t]) => [t.mime, ext]));

export type Refusal = { ok: false; code: string; words: string };
export type Accepted = { ok: true; name: string; mime: string; cls: AttachmentClass; convert: boolean };

const mb = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
/** A size over a cap, rounded up, so it never reads as equal to the cap it is over. */
const over = (n: number) => `${Math.ceil((n / 1024 / 1024) * 10) / 10} MB`;

/** A name safe to keep and show: no path, no control characters, at most 120 characters. */
export function cleanName(raw: string, fallback = "attachment"): string {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
  const name = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(-120);
  return name || fallback;
}

/** The kind, stored type and cap of one file; over its cap, of a kind not taken, or empty is refused in words. */
export function checkAttachment(input: { name: string; mime?: string; size: number; pasted?: boolean }, caps: Caps = CAPS): Accepted | Refusal {
  let name = cleanName(input.name, "pasted");
  let ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  if (!ATTACHMENT_TYPES[ext]) {
    const fromMime = BY_MIME[(input.mime ?? "").toLowerCase().split(";")[0]?.trim() ?? ""];
    if (!fromMime || ext) return { ok: false, code: "ATTACHMENT_TYPE_UNSUPPORTED", words: `${name} is a kind of file your agent cannot read, so it was not attached.` };
    ext = fromMime;
    name = `${name}.${ext}`;
  }
  const t = ATTACHMENT_TYPES[ext] as { mime: string; cls: AttachmentClass };
  if (!(input.size > 0)) return { ok: false, code: "ATTACHMENT_EMPTY", words: `${name} is empty, so it was not attached.` };
  if (input.pasted && t.cls === "image" && input.size > caps.pasted) {
    return { ok: false, code: "ATTACHMENT_TOO_LARGE_PASTED", words: `That pasted image is ${over(input.size)}; a pasted image can be up to ${mb(caps.pasted)}. Attach it as a file instead.` };
  }
  if (t.cls === "video" && input.size > caps.video) return { ok: false, code: "ATTACHMENT_TOO_LARGE_VIDEO", words: `${name} is ${over(input.size)}; a video can be up to ${mb(caps.video)}.` };
  if (t.cls !== "video" && input.size > caps.file) return { ok: false, code: "ATTACHMENT_TOO_LARGE_FILE", words: `${name} is ${over(input.size)}; a file can be up to ${mb(caps.file)}.` };
  return { ok: true, name, mime: t.mime, cls: t.cls, convert: CONVERTED_TO_JPEG.has(t.mime) };
}

/** The converter's answer: JPEG bytes, or a code and a reason; never the input passed through as converted. */
export type Converted = { ok: true; bytes: Uint8Array; mime: "image/jpeg" } | { ok: false; code: string; reason: string };
export type ImageConverter = (input: { bytes: Uint8Array; mime: string }) => Promise<Converted>;

/** HEIC and AVIF become JPEG through the converter; without one, or when it fails, the file is refused in words. */
export async function toJpeg(convert: ImageConverter | null, a: Accepted, bytes: Uint8Array): Promise<{ ok: true; name: string; bytes: Uint8Array } | Refusal> {
  const avif = a.mime === "image/avif";
  const unavailable: Refusal = avif
    ? { ok: false, code: "HOST_IMAGES_UNAVAILABLE", words: `${a.name} is an AVIF image, and converting AVIF to JPEG needs a Cloudflare Enterprise plan, so it was not attached. Save it as JPEG and attach it again.` }
    : { ok: false, code: "HOST_IMAGES_UNAVAILABLE", words: `${a.name} is a HEIC image, and converting it to JPEG needs the Images binding, which this deploy does not have, so it was not attached. Save it as JPEG and attach it again.` };
  if (!convert) return unavailable;
  let r: Converted;
  try {
    r = await convert({ bytes, mime: a.mime });
  } catch (e) {
    r = { ok: false, code: "IMAGE_CONVERT_FAILED", reason: String((e as Error)?.message ?? e).slice(0, 200) };
  }
  if (!r.ok && r.code === "HOST_IMAGES_UNAVAILABLE") return unavailable;
  if (!r.ok) return { ok: false, code: r.code || "IMAGE_CONVERT_FAILED", words: `${a.name} could not be converted to JPEG (${r.reason}), so it was not attached.` };
  if (r.mime !== "image/jpeg" || !isJpeg(r.bytes)) return { ok: false, code: "IMAGE_CONVERT_FAILED", words: `${a.name} could not be converted to JPEG (the converter did not answer with a JPEG), so it was not attached.` };
  return { ok: true, name: a.name.replace(/\.[A-Za-z0-9]+$/, ".jpg"), bytes: r.bytes };
}

/** A JPEG starts with the SOI marker and a marker segment. */
export const isJpeg = (b: Uint8Array) => b.byteLength > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
