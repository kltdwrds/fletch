// The Renderer's container (F56): the pure half of `objects/renderer.ts`. The object's container is the one its
// deploy's `containers` entry names (`RENDER_IMAGE`, added only by `--paid`, D-0021); this starts pandoc's server in it
// once, with no internet, and hands back the port `render` and `renderToMarkdown` ask. An object with no container
// (a config that bound the class without the image) is refused with `RENDER_UNAVAILABLE`, never answered empty.
import { RENDER_ENTRYPOINT, RENDER_PORT, type RenderResult, render } from "./render.ts";
import { type MarkdownResult, renderToMarkdown } from "./reverse.ts";

/** The part of `ctx.container` this uses. */
export interface RenderContainer {
  readonly running: boolean;
  start(options: { entrypoint: string[]; enableInternet: boolean }): void;
  getTcpPort(port: number): { fetch(req: Request): Promise<Response> };
}

export const NO_CONTAINER = "the Renderer object has no container: the deploy bound it without its image";

/** pandoc's port in the object's container, started on first use; null when the object has none. */
export function pandocPort(container: RenderContainer | undefined): { fetch(req: Request): Promise<Response> } | null {
  if (!container) return null;
  if (!container.running) container.start({ entrypoint: RENDER_ENTRYPOINT, enableInternet: false });
  return container.getTcpPort(RENDER_PORT);
}

export async function renderIn(container: RenderContainer | undefined, input: unknown, pause: (ms: number) => Promise<void>): Promise<RenderResult> {
  const port = pandocPort(container);
  return port ? render(input, port, pause) : { ok: false, code: "RENDER_UNAVAILABLE", reason: NO_CONTAINER };
}

export async function markdownIn(container: RenderContainer | undefined, input: unknown, pause: (ms: number) => Promise<void>): Promise<MarkdownResult> {
  const port = pandocPort(container);
  return port ? renderToMarkdown(input, port, pause) : { ok: false, code: "RENDER_UNAVAILABLE", reason: NO_CONTAINER };
}
