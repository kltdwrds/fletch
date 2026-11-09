// The Renderer (D2, AD-8, F56): one object per tenant beside the agent script, holding the pandoc container its
// deploy's `containers` entry names. The host reaches it over RPC (`@qyvr/host-cloudflare`'s `containerRenderer`,
// through the `RENDERER` binding a `--paid` deploy adds); everything it does is in `render/container.ts`.
import { DurableObject } from "cloudflare:workers";
import { markdownIn, type RenderContainer, renderIn } from "../render/container.ts";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Renderer extends DurableObject<Env> {
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
