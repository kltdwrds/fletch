// How the `Person` object builds its attachments store (M24.3): the tenant bucket, workstream A's reader
// (`files/ingest.ts`) that takes each file into the person's own working tree, and the image converter.
// The converter is the Images binding (M24.4; AD-20 lets the agent script bind it): HEIC becomes JPEG from
// the upload's bytes, and AVIF is refused in words until it is on the plan.
import { getAgentByName } from "agents";
import type { AttachmentDirectory } from "../http/attachment-routes.ts";
import { describeForModel, ingestAttachment } from "../files/ingest.ts";
import { captionImage } from "../model/caption.ts";
import { acceptsImages } from "../model/routes.ts";
import { treeOf } from "../tree/rpc.ts";
import type { ImageConverter } from "./caps.ts";
import { imagesConverter } from "./images.ts";
import type { AttachmentBucket, AttachmentDeps } from "./store.ts";

/** The one converter a tenant script has: its own Images binding. */
export const converterFor = (env: Pick<Env, "IMAGES">): ImageConverter => imagesConverter(env.IMAGES);

/** The app's upload seam (`POST /app/attachments`): the bytes go to the bucket, the owner's `Person` keeps the row, and a HEIC is converted on the way. */
export function appAttachments(env: Env): AttachmentDirectory {
  return {
    call: async (person, call) => (await getAgentByName(env.PERSON, person)).attachmentCall(person, call),
    bucket: env.AGENT_BUCKET as never,
    convert: converterFor(env),
  };
}

export function attachmentDeps(env: Env, storage: DurableObjectStorage, person: string): AttachmentDeps {
  const ledger = env.LEDGER.get(env.LEDGER.idFromName(env.TENANT_ID)) as never;
  const model = { ai: env.AI, ledger, now: () => Date.now(), wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };
  return {
    person,
    bucket: env.AGENT_BUCKET as unknown as AttachmentBucket,
    ingest: (input) =>
      ingestAttachment(
        {
          tree: treeOf(storage, person),
          renderer: { toMarkdown: (i) => env.RENDERER.getByName("render").toMarkdown(i) },
          caption: (image) => captionImage(model, { tenant: env.TENANT_ID, person: image.owner, attachmentId: image.attachmentId }, { bytes: image.bytes, mimeType: image.mimeType }),
          imageInput: acceptsImages("chat"),
        },
        input,
      ),
    describe: describeForModel,
    convert: converterFor(env),
    now: () => Date.now(),
  };
}
