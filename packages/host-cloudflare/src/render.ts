// The document renderer one account has (F56): the `RENDERER` Durable Object namespace, whose object runs pandoc in a
// container, reached over RPC and never imported. A deploy has it only when its config binds it, which only a deploy
// made with `--render` does (D-0031); without it `render` is refused by name with the binding it lacks (D-0001). What
// the object answers is checked before it is passed on: a render that claims success without a document is refused
// with `RENDER_OUTPUT_INVALID`, never shown as made.
import { type HostFailure, type RenderService, unavailable } from "@qyvr/host";

/** The binding a deploy's config adds for render; its name is in the refusal, so the owner knows what is missing. */
export const RENDERER_BINDING = "RENDERER";

/** Why render is refused on a deploy without the binding: the binding by name and the deploy that adds it. */
export const RENDERER_MISSING = `this deploy has no document renderer: the ${RENDERER_BINDING} container binding is missing, and only a deploy made with --render (pnpm self-host --render, pnpm preview up --render) adds it`;

/** The Renderer object's RPC, as its stub exposes it. */
export interface RendererStub {
  render(input: unknown): Promise<unknown>;
  toMarkdown(input: unknown): Promise<unknown>;
}

/** The namespace as this module uses it: one object per tenant. */
export interface RendererNamespace {
  idFromName(name: string): unknown;
  get(id: never): unknown;
}

type Refusal = { ok: false; code: string; reason: string };
const invalid = (reason: string): Refusal => ({ ok: false, code: "RENDER_OUTPUT_INVALID", reason });
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** A refusal passes as it is when it carries a code and a reason; anything else is not called one. */
function refusalOf(r: Record<string, unknown>): Refusal {
  return str(r.code) && typeof r.reason === "string" ? { ok: false, code: r.code, reason: r.reason } : invalid("the renderer refused without a code");
}

/** A render the object answered: a document has its format, its bytes in base64, their count and their media type. */
export function checkRender(raw: unknown): { ok: boolean; code?: string } {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || typeof r.ok !== "boolean") return invalid("the renderer's answer has no outcome");
  if (!r.ok) return refusalOf(r);
  if (!str(r.to) || !str(r.base64) || !str(r.mediaType) || typeof r.bytes !== "number" || r.bytes <= 0) return invalid("the renderer said it made a document but sent none");
  return { ok: true, to: r.to, base64: r.base64, mediaType: r.mediaType, bytes: r.bytes } as { ok: boolean };
}

/** Markdown the object answered from a document: the text itself, never an empty success. */
export function checkMarkdown(raw: unknown): unknown {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || typeof r.ok !== "boolean") return invalid("the renderer's answer has no outcome");
  if (!r.ok) return refusalOf(r);
  if (typeof r.markdown !== "string" || typeof r.chars !== "number" || r.markdown.length !== r.chars) return invalid("the renderer said it read the document but sent no Markdown");
  return r;
}

/** `render` from the deploy's binding, or refused by name where the deploy has none. */
export function containerRenderer(ns: RendererNamespace | undefined, tenant: string): RenderService | HostFailure {
  if (!ns) return unavailable("render", RENDERER_MISSING);
  const stub = () => ns.get(ns.idFromName(`${tenant}:renderer`) as never) as RendererStub;
  return {
    render: async (input) => checkRender(await stub().render(input)),
    toMarkdown: async (input) => checkMarkdown(await stub().toMarkdown(input)),
  };
}
