// Grants (A3, A4, B9): 50 seeded colleague and agent requests between Ada and Bo, half covered by an
// automatic grant the principal signed and half carrying a decoy grant that must not apply (another
// resource, ask, deny, expired, revoked, a closed window, a spent one-shot). Every executed action
// cites a covering grant, none runs outside one, and the journal's verifier finds nothing. The
// resolution table itself is the engine's fixture (`test/workers/m7-grants-engine.test.ts`).
import { describe, expect } from "vitest";
import { defineScenario } from "../../support/scenario.ts";
import { ada, authorityWorld, } from "../../workers/support/authority-world.ts";

describe("[M7.1] grants", () => {

  defineScenario({
    id: "S-B9-standing-grant-not-asked",
    clauses: ["B9"],
    seed: 9,
    async setup() {
      const w = authorityWorld({ script: [{ toolCall: { id: "post-1", name: "notes_post", arguments: { resource: "board" } } }, { text: "Posted, under your standing grant." }] });
      const g = await w.grant(ada.email, { grantee: { kind: "own-agent" }, subject: { kind: "action-kind", ref: "notes.*" }, mode: "auto" });
      return Object.assign(w, { g, chat: "", snapshot: async () => ({ journal: (await w.journal()).map((r) => r.id), vault: [], r2: [] }) });
    },
    async turns(w) {
      w.chat = (await w.say(ada.email, "Post the note to the board.")).chatId;
    },
    async endState(w) {
      expect(w.performed).toHaveLength(1);
      expect(await w.journal()).toMatchObject([{ decision: "auto", grantId: w.g.id, outcome: "DONE" }]);
    },
    minefields: [{ name: "a card for what a standing grant covers", happened: (w) => w.cardsOf(ada.email).length > 0 }],
    declared: (w) => ({ journal: [`${w.chat}:post-1`] }),
  });
});
