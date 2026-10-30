// T-P14-13's slot world under the scripted fake (F40) through the tier-1 harness; on a slot `pnpm evals P14` plays it
// with the real model (F41, `scripts/evals/p14-slot.ts`). A `reload` (payload `width`) evicts the chat, as P3's does,
// and keeps the replies the thread then holds; `settings` (payload `route`, `width`) reads the route as served to Sam;
// no browser runs, so no page made a request and no mode was stored. (T-P14-04's Security pane is played in hermetic
// Chromium by `harness-security.ts` from F41.)
import { pageOf } from "../../../packages/agent/src/http/pages.ts";
import type { Turn } from "../../support/task.ts";
import { type P14HarnessOptions, P14Tier1World, sam } from "./harness.ts";
import type { P14SlotWorld } from "./world.ts";

const SLOT_ORIGIN = "https://slot.fletch.test";

export class P14FakeSlot extends P14Tier1World implements P14SlotWorld {
  private readonly afterReload: Array<{ width: "desktop" | "phone"; replies: string[] }> = [];
  private phone: { drawn: boolean; heading: string } = { drawn: false, heading: "" };
  readonly origin = SLOT_ORIGIN;
  readonly mode = { before: null, after: null };

  async play(turn: Turn): Promise<void> {
    const p = (turn.kind === "event" ? (turn.payload ?? {}) : {}) as Record<string, string>;
    if (turn.kind === "event" && turn.name === "reload") {
      await super.play(turn);
      this.afterReload.push({ width: p.width === "phone" ? "phone" : "desktop", replies: this.replies("c1") });
    } else if (turn.kind === "event" && turn.name === "settings") {
      const r = await this.w.http(sam.email, "GET", p.route ?? "/settings/general");
      const html = String(r.body.html ?? "");
      this.phone = { drawn: r.status === 200 && pageOf(p.route ?? "")?.row.view === "settings" && html.includes('id="settings"'), heading: /<h2[^>]*>([^<]*)<\/h2>/.exec(html)?.[1] ?? "" };
    } else await super.play(turn);
  }

  async reloads() {
    return this.afterReload;
  }

  async settingsAtPhone() {
    return this.phone;
  }

  /** No browser runs under the fake, so no page made a request. */
  origins(): string[] {
    return [];
  }
}

export const slot = (o: P14HarnessOptions) => new P14FakeSlot(o);
