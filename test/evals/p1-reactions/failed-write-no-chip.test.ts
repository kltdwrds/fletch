// D14's planted failing write (contract P1-reactions, Fresh-session check; F21): Sam's reaction is drawn only once the
// store has it. The shipped page script runs under the page harness's DOM at 1440, its socket answered by
// `answerFrame` over Sam's real `ChatEngine` chat (the authority world, the scripted fake model). The write is made to
// fail on the production path, the chat's `reactions` table taken away, so the store throws and nothing answers, as
// the Chat object's `onMessage` would: no chip is drawn. With the table back, the chip appears only when the chat's
// `reaction` frame reaches the page, never on the click; a page that draws on the click fails the check.
import { describe, expect, it } from "vitest";
import { connectFrame } from "../../../packages/agent/src/chat/protocol.ts";
import { answerFrame } from "../../../packages/agent/src/chat/socket.ts";
import { MESSAGE_TEXT } from "../../../packages/agent/src/http/app/message-actions.ts";
import { authorityWorld } from "../../workers/support/authority-world.ts";
import { type El, page } from "../../workers/support/page-harness.ts";
import { P1Tier1World, sam } from "./harness.ts";

const ASK = "Is the orchard walk on?";
const ANSWER = "Yes, Saturday at ten. Bring boots.";

const label = (b: El) => b.attrs["aria-label"] ?? "";

async function check(plant?: (js: string) => string) {
  const world = new P1Tier1World(authorityWorld({ script: [{ text: ANSWER }] }));
  await world.open("c1");
  await world.say(ASK);
  const chat = world.chat();
  const sent: string[] = [];
  const p = await page({ onSend: (d) => void sent.push(d) }, { desktop: true }, plant);
  const s = p.sockets[0] as NonNullable<(typeof p.sockets)[0]>;
  p.open(s);
  const first = connectFrame(sam.email, chat.owner(), () => chat.history());
  if (!first.ok) throw new Error(`P1_CONNECT_REFUSED: ${first.code}`);
  p.deliver(s, first.frame);
  const agent = p.log.children.find((c) => c.msg?.who === "agent");
  if (!agent) throw new Error("P1_NO_AGENT_MESSAGE");
  const mid = agent.dataset.mid as string;
  const chip = () => agent.children.find((c) => c.className === "reaction-pill")?.textContent ?? null;
  const rows = () => world.harness().db.prepare("SELECT message_id, person, emoji FROM reactions").all();

  // Sam picks 👍 from the hover row's picker; the page sends its `react` frame and the chat answers it.
  const pick = () => {
    const row = agent.children.find((c) => c.className.startsWith("acts"))?.children[0];
    row?.children.find((b) => label(b) === MESSAGE_TEXT.react)?.onclick?.();
    const box = agent.children.find((c) => c.className.startsWith("acts"))?.children.find((c) => c.className === "qf-react");
    box?.children.find((b) => label(b) === `${MESSAGE_TEXT.reactWith}thumbs up`)?.onclick?.();
    const frame = sent.pop();
    if (!frame || JSON.parse(frame).type !== "react") throw new Error("P1_NO_REACT_FRAME");
    return frame;
  };
  /** The chat's answer: its reply to this socket, if any, and what it broadcast since `from`, held until `deliver`. */
  const answer = async (frame: string) => {
    const from = world.frames().length;
    let reply: unknown = null;
    let threw: unknown = null;
    try {
      reply = await answerFrame(sam.email, frame, chat);
    } catch (e) {
      threw = e;
    }
    const deliver = () => {
      for (const f of [reply, ...world.frames().slice(from)]) if (f) p.deliver(s, f);
    };
    return { threw, deliver };
  };

  // The planted failing write: the store throws, nothing is kept and nothing is drawn.
  const db = world.harness().db;
  db.exec("ALTER TABLE reactions RENAME TO reactions_away");
  const failed = await answer(pick());
  failed.deliver();
  db.exec("ALTER TABLE reactions_away RENAME TO reactions");
  expect(failed.threw).toBeInstanceOf(Error);
  expect(rows()).toEqual([]);
  expect(chip()).toBeNull();

  // The write goes through: no chip on the click, the chip once the store's frame carries the row.
  const kept = await answer(pick());
  expect(kept.threw).toBeNull();
  expect(rows()).toEqual([{ message_id: mid, person: sam.email, emoji: "👍" }]);
  expect(chip()).toBeNull();
  kept.deliver();
  expect(chip()).toBe("👍");
}

const CLICK = "b.onclick = () => { after(); react(m.mid, ch); };";

describe("[F21] P1 reactions: a reaction whose write fails draws no chip (D14)", () => {
  it("the chip is drawn from the store's frame alone: none when the write fails, none on the click, one when the frame lands", async () => {
    await check();
  });

  it("planted: a page that draws the chip on the click fails the check", async () => {
    const plant = (js: string) => {
      expect(js).toContain(CLICK);
      return js.replace(CLICK, 'b.onclick = () => { after(); setReaction(byMid(m.mid), "you", ch); react(m.mid, ch); };');
    };
    await expect(check(plant)).rejects.toThrow();
  });
});
