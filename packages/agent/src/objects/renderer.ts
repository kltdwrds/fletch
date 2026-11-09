// The Renderer (D2, AD-8, F56): one object per tenant beside the agent script, holding the pandoc container its
// deploy's `containers` entry names. The host reaches it over RPC (`@qyvr/host-cloudflare`'s `containerRenderer`,
// through the `RENDERER` binding a `--render` deploy adds, D-0031); everything it does is in `render/container.ts`.
// An object restarted by a deploy finds its container running without an inactivity timeout, so the constructor
// sets it again before the first request.
import { DurableObject } from "cloudflare:workers";
import { markdownIn, RENDER_SLEEP_AFTER_MS, type RenderContainer, renderIn } from "../render/container.ts";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Renderer extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const c = this.container;
    if (c?.running) void (this.ctx as DurableObjectState).blockConcurrencyWhile(() => c.setInactivityTimeout(RENDER_SLEEP_AFTER_MS));
  }

  private get container(): RenderContainer | undefined {
    return (this.ctx as DurableObjectState).container as RenderContainer | undefined;
  }

  render(input: unknown) {
    return renderIn(this.container, input, pause);
  }

  toMarkdown(input: unknown) {
    return markdownIn(this.container, input, pause);
  }
}
