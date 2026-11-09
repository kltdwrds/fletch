// The Renderer's container (F56): the pure half of `objects/renderer.ts`. The object's container is the one its
// deploy's `containers` entry names (`RENDER_IMAGE`, added only by `--render`, D-0031); this starts pandoc's server in
// it once, with no internet, keeps it up for `RENDER_SLEEP_AFTER_MS` after the last request, and hands back the port
// `render` and `renderToMarkdown` ask. An object with no container (a config that bound the class without the image),
// or a container that would not start, is refused with `RENDER_UNAVAILABLE`, never answered empty.
import { RENDER_ENTRYPOINT, RENDER_PORT, type RenderResult, render } from "./render.ts";
import { type MarkdownResult, renderToMarkdown } from "./reverse.ts";

/** The part of `ctx.container` this uses. */
export interface RenderContainer {
  readonly running: boolean;
  start(options: { entrypoint: string[]; enableInternet: boolean }): void;
  setInactivityTimeout(ms: number): Promise<void>;
  getTcpPort(port: number): { fetch(req: Request): Promise<Response> };
}

/**
 * Five minutes after the last request the container stops. The deploy runs one lite instance, so pandoc's cold start
 * (up to 20 s) is paid once per idle gap, not per document; without a timeout Cloudflare stops the container shortly
 * after the object goes idle.
 */
export const RENDER_SLEEP_AFTER_MS = 5 * 60_000;

export const NO_CONTAINER = "the Renderer object has no container: the deploy bound it without its image";

type Port = { fetch(req: Request): Promise<Response> };
type Refusal = { ok: false; code: "RENDER_UNAVAILABLE"; reason: string };

const unavailable = (reason: string): Refusal => ({ ok: false, code: "RENDER_UNAVAILABLE", reason });

/**
 * pandoc's port in the object's container, started on first use and kept up for `RENDER_SLEEP_AFTER_MS`; a refusal
 * when the object has no container or the container would not start.
 */
export async function pandocPort(container: RenderContainer | undefined): Promise<{ port: Port } | Refusal> {
  if (!container) return unavailable(NO_CONTAINER);
  try {
    if (!container.running) container.start({ entrypoint: RENDER_ENTRYPOINT, enableInternet: false });
    await container.setInactivityTimeout(RENDER_SLEEP_AFTER_MS);
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    return unavailable(`the Renderer's container did not start: ${message}`);
  }
  return { port: container.getTcpPort(RENDER_PORT) };
}

export async function renderIn(container: RenderContainer | undefined, input: unknown, pause: (ms: number) => Promise<void>): Promise<RenderResult> {
  const p = await pandocPort(container);
  return "port" in p ? render(input, p.port, pause) : p;
}

export async function markdownIn(container: RenderContainer | undefined, input: unknown, pause: (ms: number) => Promise<void>): Promise<MarkdownResult> {
  const p = await pandocPort(container);
  return "port" in p ? renderToMarkdown(input, p.port, pause) : p;
}
