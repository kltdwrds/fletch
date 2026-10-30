// The P14 tasks that read more than a chat, played under the scripted fake (F40) through the tier-1 harness. A slot's
// pages (T-P14-13, `P14SlotWorld`) and the Security pane (T-P14-04, `P14SecurityWorld`) are F41's to grade on a slot;
// here each is read as shipped fletch serves it to the tier-1 world:
//   - the slot: a `reload` (payload `width`) evicts the chat, as P3's does, and keeps the replies the thread then
//     holds; `settings` (payload `route`, `width`) reads the route as served to Sam; no browser runs, so no page made a
//     request and no mode was stored;
//   - the Security pane: `security` (payload `as`, `width`) reads `/settings/security` as served to the reader (the
//     recovery session is Sam's); with no pane served there is no Remove or Add to press, so `remove` and `add` press
//     nothing; `reload` (payload `route`) reads whether the route is a page.
import { pageOf } from "../../../packages/agent/src/http/pages.ts";
import type { Turn } from "../../support/task.ts";
import { type P14HarnessOptions, P14Tier1World, pat, sam } from "./harness.ts";
import type { P14SecurityWorld, P14SlotWorld } from "./world.ts";

const SLOT_ORIGIN = "https://slot.fletch.test";
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

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

export class P14FakeSecurity extends P14Tier1World implements P14SecurityWorld {
  readonly pane: P14SecurityWorld["pane"] = [];
  readonly removed: P14SecurityWorld["removed"] = [];
  added: string | null = null;
  routeReload: P14SecurityWorld["routeReload"] = null;

  async play(turn: Turn): Promise<void> {
    if (turn.kind !== "event") return super.play(turn);
    const p = (turn.payload ?? {}) as Record<string, string>;
    if (turn.name === "security") {
      const as = (p.as ?? "sam") as "sam" | "sam-recovery" | "pat";
      const r = await this.w.http(as === "pat" ? pat.email : sam.email, "GET", "/settings/security");
      const html = r.status === 200 ? String(r.body.html ?? "") : "";
      this.pane.push({ as, width: p.width === "phone" ? "phone" : "desktop", rows: [], words: text(html.slice(html.indexOf('id="settings-security"') + 1 || html.length)), dom: "" });
    } else if (turn.name === "remove" || turn.name === "add") {
      // No pane is served, so nothing can be pressed.
    } else if (turn.name === "reload") this.routeReload = { route: p.route ?? "/settings/security", drawn: pageOf(p.route ?? "/settings/security") !== null };
    else await super.play(turn);
  }
}

export const slot = (o: P14HarnessOptions) => new P14FakeSlot(o);
export const securityPane = (o: P14HarnessOptions) => new P14FakeSecurity(o);
