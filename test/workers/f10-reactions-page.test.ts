// F10: reactions, full circuit, on the shipped page. The page under the page harness with frames delivered by hand:
// a bubble collects the agent's and the person's reaction in one pill, keyed by who put it there. No Chromium: the
// pill is DOM, and the M29.4 Chromium suite covers the picker's geometry.
import { describe, expect, it } from "vitest";
import { HOLD_MS, MESSAGE_TEXT } from "../../packages/agent/src/http/app/message-actions.ts";
import { type El, page } from "./support/page-harness.ts";

type Plant = Parameters<typeof page>[2];

/** A page on fixed answers (no world), its socket opened on an empty chat. */
async function threadPage(plant?: Plant) {
  const p = await page({ onSend() {} }, {}, plant);
  const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
  p.open(s);
  p.deliver(s, { type: "history", entries: [], running: null });
  return { ...p, s };
}
const pillOf = (n: El | undefined) => n?.children.find((c) => c.className === "reaction-pill")?.textContent ?? null;

/** Ada's message m1 with the agent's 👍, then her 🙏, then the agent's taken off: the pill after each. */
async function collected(plant?: Plant) {
  const p = await threadPage(plant);
  p.deliver(p.s, { type: "history", running: null, entries: [{ kind: "you", text: "Is the orchard walk on?", id: "a", mid: "m1", at: 1, reactions: [{ by: "agent", emoji: "👍" }] }] });
  const m1 = () => p.log.children[0];
  const pills = [pillOf(m1())];
  p.deliver(p.s, { type: "reaction", mid: "m1", by: "you", emoji: "🙏" });
  pills.push(pillOf(m1()));
  p.deliver(p.s, { type: "reaction", mid: "m1", by: "agent", emoji: null });
  pills.push(pillOf(m1()));
  return { p, m1: m1() as El, pills };
}

describe("[F10] reactions on the page", () => {
  it("a bubble collects the agent's and the person's reaction in one pill, the person's own marks the picker, and taking one off leaves the other", async () => {
    const { p, m1, pills } = await collected();
    expect(pills).toEqual(["👍", "👍🙏", "🙏"]);
    // The held-touch popover on m1 (all six; the phone sheet stops at five) marks Ada's own pick alone.
    (m1.children.find((c) => c.className.startsWith("qf-bubble")) as El & { onpointerdown: (e: unknown) => void }).onpointerdown({ pointerType: "touch", clientX: 0, clientY: 0 });
    p.t.fire(HOLD_MS);
    const pressed = p.byId("msg-emos").children.filter((b) => b.attrs["aria-pressed"] === "true").map((b) => b.attrs["aria-label"]);
    expect(pressed).toEqual([`${MESSAGE_TEXT.reactWith}folded hands`]);
  });

  it("planted: a page whose setReaction keeps one slot, ignoring who reacted, fails the collected pill", async () => {
    const oneSlot: Plant = (js) => {
      const at = js.indexOf("function setReaction(d, by, emoji) {");
      expect(at).toBeGreaterThan(-1);
      return js.replace("function setReaction(d, by, emoji) {", "function setReaction(d, by, emoji) { if (d.reactions) for (const k of Object.keys(d.reactions)) delete d.reactions[k];");
    };
    const { pills } = await collected(oneSlot);
    expect(pills).not.toEqual(["👍", "👍🙏", "🙏"]);
    expect(pills[1]).toBe("🙏");
  });
});
