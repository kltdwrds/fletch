// Downloads of a person's attachments (M24.3) are by a short-lived signed link, as the Library's files are
// (`files/links.ts`): the person's own `Person` decides the row first (theirs, or disclosed to them), then
// signs a link with its own key; the link is served only with the same person's session, so another
// member's object, whose key never signed it, refuses it. The other calls go to the attachments store.
import type { PersonLinks } from "../files/links.ts";
import type { AttachmentCall, PersonAttachments } from "./store.ts";

export type AttachmentLinkCall = { op: "link"; id: string; download?: boolean } | { op: "linked"; id: string; exp: string; sig: string };

export async function runAttachmentCall(store: Pick<PersonAttachments, "call">, links: Pick<PersonLinks, "attachmentLink" | "attachmentLinked">, by: string, c: AttachmentCall | AttachmentLinkCall): Promise<unknown> {
  if (c?.op === "link") {
    const r = (await store.call(by, { op: "get", id: c.id })) as { ok?: boolean };
    if (r?.ok !== true) return r;
    return links.attachmentLink(c.id, c.download === true, by);
  }
  if (c?.op === "linked") {
    const v = await links.attachmentLinked({ id: String(c.id ?? ""), exp: String(c.exp ?? ""), sig: String(c.sig ?? "") }, by);
    if (!v.ok) return v;
    return store.call(by, { op: "get", id: c.id });
  }
  return store.call(by, c);
}
