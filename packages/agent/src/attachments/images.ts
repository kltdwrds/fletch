// The production image converter (M24.4): an uploaded or mailed HEIC becomes JPEG through the Images
// binding, in-process, from the upload's own bytes. No URL is built and nothing is fetched, so the
// private object never leaves the Worker. AVIF input is Enterprise-only on Images (platform-facts.md), so it
// stays refused in words with `IMAGE_CONVERT_UNAVAILABLE` until it is on the plan.
import type { Converted, ImageConverter } from "./caps.ts";

const HEIC = new Set(["image/heic", "image/heif"]);

/** The Images binding's code for "input is not an image", the one failure worth naming apart. */
const NOT_AN_IMAGE = 9412;

export function imagesConverter(images: ImagesBinding): ImageConverter {
  return async ({ bytes, mime }): Promise<Converted> => {
    if (!HEIC.has(mime)) {
      return { ok: false, code: "IMAGE_CONVERT_UNAVAILABLE", reason: "only HEIC converts here; AVIF input needs a Cloudflare plan this platform is not on" };
    }
    try {
      const result = await images.input(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream()).output({ format: "image/jpeg" });
      const jpeg = new Uint8Array(await new Response(result.image()).arrayBuffer());
      return { ok: true, bytes: jpeg, mime: "image/jpeg" };
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      const reason = code === NOT_AN_IMAGE ? "the file is not a readable image" : String((e as Error)?.message ?? e).slice(0, 200);
      return { ok: false, code: "IMAGE_CONVERT_FAILED", reason };
    }
  };
}
